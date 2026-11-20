"""Configuracao via ambiente (passo 1). Falha no boot se faltar algo em producao."""
import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    api_base_url: str
    demo_mode: bool
    session_secret: str
    rate_limit_max: int
    rate_limit_window_s: int
    ollama_url: str = "http://localhost:11434"
    ollama_model: str = "llama3.2"
    ollama_timeout_s: float = 60.0
    ollama_embed_model: str = "nomic-embed-text"
    # Login de teste para exposicao: so no modo demo (dados ficticios). Desligado por padrao.
    expo_login: bool = False
    expo_email: str = "equipe.teste@exemplo.test"
    expo_senha: str = "kronos-expo-2026"
    # Token opcional (Bearer) para clientes MCP remotos em POST /mcp. Vazio = so sessao/ demo aberto.
    mcp_token: str = ""


def load_settings(env: dict[str, str] | None = None) -> Settings:
    e = os.environ if env is None else env
    demo = e.get("DEMO_MODE", "true").lower() == "true"
    secret = e.get("SESSION_SECRET", "")
    if not demo and len(secret) < 32:
        raise RuntimeError("SESSION_SECRET precisa ter 32+ caracteres fora do modo demo")
    api = e.get("API_BASE_URL", "")
    if not demo and not api:
        raise RuntimeError("API_BASE_URL e obrigatoria fora do modo demo")
    mcp_token = e.get("MCP_TOKEN", "").strip()
    if mcp_token and len(mcp_token) < 24:
        raise RuntimeError("MCP_TOKEN precisa ter 24+ caracteres")
    return Settings(
        api_base_url=api,
        demo_mode=demo,
        session_secret=secret,
        rate_limit_max=int(e.get("RATE_LIMIT_MAX", "10")),
        rate_limit_window_s=int(e.get("RATE_LIMIT_WINDOW_S", "60")),
        ollama_url=e.get("OLLAMA_URL", "http://localhost:11434").rstrip("/"),
        ollama_model=e.get("OLLAMA_MODEL", "llama3.2"),
        ollama_timeout_s=float(e.get("OLLAMA_TIMEOUT_S", "60")),
        ollama_embed_model=e.get("OLLAMA_EMBED_MODEL", "nomic-embed-text"),
        expo_login=demo and e.get("EXPO_LOGIN", "false").lower() == "true",
        expo_email=e.get("EXPO_EMAIL", "equipe.teste@exemplo.test").strip(),
        expo_senha=e.get("EXPO_SENHA", "kronos-expo-2026"),
        mcp_token=mcp_token,
    )
