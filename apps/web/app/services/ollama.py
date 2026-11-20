"""Cliente do Ollama (IA local e gratuita, API REST em http://localhost:11434).

Custo zero: roda na maquina, sem chave nem provedor externo. O texto enviado e conteudo nao confiavel
(curriculos, documentos): vai sempre como mensagem de usuario, nunca concatenado ao prompt de sistema, e a
decisao final continua humana (LGPD art. 20). Nunca registra prompt nem resposta nos logs.
"""
from dataclasses import dataclass

import httpx


class OllamaIndisponivel(Exception):
    """O Ollama nao respondeu ou respondeu algo inesperado (o chamador cai para a conferencia manual)."""


@dataclass(frozen=True)
class OllamaClient:
    base_url: str = "http://localhost:11434"
    model: str = "llama3.2"
    timeout_s: float = 60.0
    embed_model: str = "nomic-embed-text"
    transport: httpx.BaseTransport | None = None  # injetavel nos testes

    def _post(self, caminho: str, corpo: dict) -> dict:
        try:
            with httpx.Client(base_url=self.base_url, timeout=self.timeout_s, transport=self.transport) as c:
                r = c.post(caminho, json=corpo)
                r.raise_for_status()
                return r.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise OllamaIndisponivel("Ollama indisponível") from exc

    def chat(self, mensagens: list[dict[str, str]], sistema: str | None = None) -> str:
        """POST /api/chat. `mensagens` = [{"role": "user", "content": "..."}]; `sistema` e o prompt fixo."""
        msgs = ([{"role": "system", "content": sistema}] if sistema else []) + mensagens
        dados = self._post("/api/chat", {"model": self.model, "messages": msgs, "stream": False})
        try:
            return dados["message"]["content"]
        except (KeyError, TypeError) as exc:
            raise OllamaIndisponivel("Resposta inesperada do Ollama") from exc

    def gerar(self, prompt: str) -> str:
        """POST /api/generate (uma pergunta, uma resposta)."""
        dados = self._post("/api/generate", {"model": self.model, "prompt": prompt, "stream": False})
        if not isinstance(dados.get("response"), str):
            raise OllamaIndisponivel("Resposta inesperada do Ollama")
        return dados["response"]

    def embed(self, textos: list[str]) -> list[list[float]]:
        """POST /api/embed: um vetor por texto, na mesma ordem. Usado pelo RAG (modelo `embed_model`)."""
        dados = self._post("/api/embed", {"model": self.embed_model, "input": textos})
        vetores = dados.get("embeddings")
        if (not isinstance(vetores, list) or len(vetores) != len(textos)
                or not all(isinstance(v, list) and v and all(isinstance(x, (int, float)) for x in v) for v in vetores)):
            raise OllamaIndisponivel("Resposta inesperada do Ollama")
        return vetores

    def disponivel(self) -> bool:
        """GET /api/tags: True se o servidor responde (usado em health check)."""
        try:
            with httpx.Client(base_url=self.base_url, timeout=3.0, transport=self.transport) as c:
                return c.get("/api/tags").status_code == 200
        except httpx.HTTPError:
            return False


def cliente_de(settings) -> OllamaClient:
    return OllamaClient(settings.ollama_url, settings.ollama_model, settings.ollama_timeout_s,
                        embed_model=settings.ollama_embed_model)
