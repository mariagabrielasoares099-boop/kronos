"""Cliente HTTP da API NestJS para o portal do candidato (fora do modo demo).

O portal nao decide nada de negocio nem de acesso: repassa o token que a API emitiu em /portal/sessao no
cabecalho Authorization e confia na resposta (RLS no banco). Nunca registra CPF, token nem conteudo de arquivo.
"""
from dataclasses import dataclass
from datetime import datetime

import httpx

from .arquivos import ArquivoInvalido


class ApiIndisponivel(Exception):
    """A API nao respondeu ou respondeu algo inesperado (o portal mostra 502, sem detalhe)."""


@dataclass(frozen=True)
class Sessao:
    token: str
    expira_em: int  # epoch em segundos


@dataclass(frozen=True)
class SessaoEquipe:
    token: str
    expira_em: int
    papel: str


class LoginRecusado(Exception):
    """A API recusou o login. `motivo` e um de: credenciais, codigo_2fa, bloqueado, sem_2fa."""

    def __init__(self, motivo: str) -> None:
        super().__init__(motivo)
        self.motivo = motivo


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


class ApiClient:
    def __init__(self, base_url: str, client: httpx.Client | None = None, timeout: float = 10.0) -> None:
        self._http = client or httpx.Client(base_url=base_url.rstrip("/"), timeout=timeout)

    def _chamar(self, metodo: str, caminho: str, **kw) -> httpx.Response:
        try:
            return self._http.request(metodo, caminho, **kw)
        except httpx.HTTPError as e:
            raise ApiIndisponivel() from e  # a mensagem do httpx pode conter a URL; nao propaga

    def solicitar_link(self, protocolo: str, cpf: str) -> None:
        """Pede o link de acesso por e-mail. Protocolo + CPF so servem para PEDIR: a API responde 202 igual em
        qualquer caso, entao aqui tambem nao ha como saber se o e-mail foi enviado."""
        r = self._chamar("POST", "/portal/link", json={"protocolo": protocolo, "cpf": cpf})
        if r.status_code == 429:
            raise ArquivoInvalido("Muitas tentativas. Aguarde um minuto.", 429)
        if r.status_code != 202:
            raise ApiIndisponivel()

    def entrar(self, codigo: str) -> Sessao | None:
        """Codigo do link (uso unico) -> token. None quando a API recusa (401): invalido, vencido ou ja usado."""
        r = self._chamar("POST", "/portal/sessao", json={"codigo": codigo})
        if r.status_code in (400, 401):
            return None
        if r.status_code == 429:
            raise ArquivoInvalido("Muitas tentativas. Aguarde um minuto.", 429)
        if r.status_code != 200:
            raise ApiIndisponivel()
        corpo = r.json()
        return Sessao(corpo["token"], int(corpo["expiraEm"]))

    def login_equipe(self, email: str, senha: str, codigo: str = "") -> SessaoEquipe:
        """Senha + 2FA na API. Levanta LoginRecusado; a tela nunca distingue e-mail inexistente de senha errada."""
        corpo = {"email": email, "senha": senha, **({"codigo": codigo} if codigo else {})}
        r = self._chamar("POST", "/auth/login", json=corpo)
        if r.status_code == 200:
            j = r.json()
            expira = datetime.fromisoformat(str(j["expiraEm"]).replace("Z", "+00:00"))  # a API manda ISO-8601
            return SessaoEquipe(j["token"], int(expira.timestamp()), j["papel"])
        if r.status_code == 401:
            try:
                pede_2fa = bool(r.json().get("codigo2fa"))
            except ValueError:
                pede_2fa = False
            raise LoginRecusado("codigo_2fa" if pede_2fa else "credenciais")
        if r.status_code == 429:
            raise LoginRecusado("bloqueado")
        if r.status_code == 403:
            raise LoginRecusado("sem_2fa")
        raise ApiIndisponivel()

    def obter_chamado(self, protocolo: str, token: str) -> dict | None:
        """None quando o token expirou/invalido (401) ou o chamado nao e deste candidato (404)."""
        r = self._chamar("GET", f"/chamados/{protocolo}", headers=_bearer(token))
        if r.status_code in (401, 404):
            return None
        if r.status_code != 200:
            raise ApiIndisponivel()
        return r.json()

    def listar_documentos(self, chamado_id: str, token: str) -> dict | None:
        r = self._chamar("GET", f"/chamados/{chamado_id}/documentos", headers=_bearer(token))
        if r.status_code in (401, 404):
            return None
        if r.status_code != 200:
            raise ApiIndisponivel()
        return r.json()

    def enviar_documento(self, chamado_id: str, tipo: str, conteudo: bytes, mime: str, token: str) -> bool:
        """True quando gravado. False se o token/chamado nao vale mais. O nome do arquivo enviado e fixo."""
        r = self._chamar(
            "POST",
            f"/chamados/{chamado_id}/documentos",
            headers=_bearer(token),
            data={"tipo": tipo},
            files={"arquivo": ("documento", conteudo, mime)},
        )
        if r.status_code == 201:
            return True
        if r.status_code in (401, 404):
            return False
        if r.status_code == 413:
            raise ArquivoInvalido("Arquivo acima de 5 MB.", 413)
        if r.status_code == 400:
            raise ArquivoInvalido("A API recusou o arquivo. Envie JPG, PNG ou PDF.")
        raise ApiIndisponivel()
