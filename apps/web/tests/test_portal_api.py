"""Portal fora do demo: link de acesso por e-mail + upload para a API real (simulada com httpx.MockTransport)."""
import json

import httpx
from fastapi.testclient import TestClient

from app.api_client import ApiClient
from app.config import Settings
from app.main import create_app

PROTOCOLO = "ADM-2026-000001"
CPF = "529.982.247-25"
CHAMADO_ID = "0190d2a0-0000-7000-8000-000000000001"
CODIGO = "A" * 43  # codigo do link enviado por e-mail (43 caracteres base64url)
TOKEN = "token.da.api"
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 32
ACESSO = f"/chamado/{PROTOCOLO}/acesso/{CODIGO}"


class FakeApi:
    """Imita as rotas da API NestJS usadas pelo portal e registra o que recebeu."""

    def __init__(self):
        self.chamadas: list[httpx.Request] = []
        self.documentos: list[dict] = []
        self.codigos_usados: set[str] = set()
        self.fora_do_ar = False

    def __call__(self, req: httpx.Request) -> httpx.Response:
        self.chamadas.append(req)
        if self.fora_do_ar:
            raise httpx.ConnectError("sem rede", request=req)
        path = req.url.path
        if path == "/portal/link":
            return httpx.Response(202, json={"mensagem": "Se os dados conferem..."})  # igual acertando ou errando
        if path == "/portal/sessao":
            codigo = json.loads(req.content).get("codigo")
            if codigo != CODIGO or codigo in self.codigos_usados:
                return httpx.Response(401)
            self.codigos_usados.add(codigo)  # uso unico
            return httpx.Response(200, json={"token": TOKEN, "expiraEm": 4_102_444_800})
        if req.headers.get("authorization") != f"Bearer {TOKEN}":
            return httpx.Response(401)
        if path == f"/chamados/{PROTOCOLO}":
            return httpx.Response(200, json={"id": CHAMADO_ID, "protocolo": PROTOCOLO, "status": "TRIAGEM",
                                             "jobId": "j", "erpRef": None})
        if path == f"/chamados/{CHAMADO_ID}/documentos" and req.method == "GET":
            return httpx.Response(200, json={"documentos": self.documentos, "checklist": []})
        if path == f"/chamados/{CHAMADO_ID}/documentos" and req.method == "POST":
            self.documentos.append({"id": "d1", "tipo": "RG", "status": "PENDENTE", "motivo": None,
                                    "mime": "image/png", "tamanhoBytes": 40})
            return httpx.Response(201, json={})
        return httpx.Response(404)

    def chamou(self, path: str) -> list[httpx.Request]:
        return [x for x in self.chamadas if x.url.path == path]


def make(fake: FakeApi | None = None, max_calls=10):
    fake = fake or FakeApi()
    api = ApiClient("http://api", client=httpx.Client(base_url="http://api", transport=httpx.MockTransport(fake)))
    settings = Settings("http://api", False, "s" * 32, max_calls, 60)
    return TestClient(create_app(settings, api=api), follow_redirects=False), fake


def pedir_link(c):
    return c.post(f"/chamado/{PROTOCOLO}/link", data={"cpf": CPF})


def abrir_sessao(c):
    """Candidato clica no link do e-mail e confirma."""
    return c.post(ACESSO)


def test_sem_sessao_pede_cpf_e_nao_chama_a_api():
    c, fake = make()
    r = c.get(f"/chamado/{PROTOCOLO}")
    assert r.status_code == 200 and "confirme o CPF" in r.text and "Enviar link por e-mail" in r.text
    assert fake.chamadas == []


def test_pedir_link_manda_so_digitos_a_api_e_nao_cria_sessao():
    c, fake = make()
    r = pedir_link(c)
    assert r.status_code == 200 and "enviamos um link" in r.text
    assert "set-cookie" not in r.headers  # protocolo + CPF nao abrem sessao
    corpo = json.loads(fake.chamou("/portal/link")[0].content)
    assert corpo == {"protocolo": PROTOCOLO, "cpf": "52998224725"}
    assert "confirme o CPF" in c.get(f"/chamado/{PROTOCOLO}").text  # continua sem acesso ao chamado
    assert fake.chamou(f"/chamados/{PROTOCOLO}") == []


def test_pedir_link_com_cpf_invalido_nem_chega_a_api():
    c, fake = make()
    r = c.post(f"/chamado/{PROTOCOLO}/link", data={"cpf": "111.111.111-11"})
    assert r.status_code == 422 and "CPF invalido" in r.text
    assert fake.chamadas == []


def test_protocolo_mais_cpf_nao_abre_sessao_pela_rota_antiga():
    c, fake = make()
    r = c.post(f"/chamado/{PROTOCOLO}/entrar", data={"cpf": CPF})
    assert r.status_code in (404, 405) and "set-cookie" not in r.headers
    assert fake.chamadas == []


def test_abrir_o_link_so_mostra_a_confirmacao_e_nao_gasta_o_codigo():
    c, fake = make()
    r = c.get(ACESSO)
    assert r.status_code == 200 and "Entrar no chamado" in r.text
    assert r.headers["cache-control"] == "no-store"
    assert r.headers["referrer-policy"] == "no-referrer"
    assert f'action="{ACESSO}"' in r.text
    assert fake.chamadas == []  # leitor de e-mail que pre-abre o link nao consome o codigo


def test_confirmar_o_link_grava_cookie_httponly_e_mostra_o_chamado_da_api():
    c, fake = make()
    r = abrir_sessao(c)
    assert r.status_code == 303 and r.headers["location"] == f"/chamado/{PROTOCOLO}"
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=lax" in cookie and "path=/chamado" in cookie
    assert json.loads(fake.chamou("/portal/sessao")[0].content) == {"codigo": CODIGO}
    page = c.get(f"/chamado/{PROTOCOLO}")
    assert page.status_code == 200 and "Triagem" in page.text and "Faltando" in page.text
    assert all(x.headers["authorization"] == f"Bearer {TOKEN}" for x in fake.chamadas[1:])


def test_link_so_funciona_uma_vez_e_codigo_errado_ou_mal_formado_nao_cria_sessao():
    c, fake = make()
    assert abrir_sessao(c).status_code == 303
    c.cookies.clear()
    r = abrir_sessao(c)  # reuso
    assert r.status_code == 401 and "Link invalido, vencido ou ja usado" in r.text and "set-cookie" not in r.headers
    antes = len(fake.chamadas)
    assert c.post(f"/chamado/{PROTOCOLO}/acesso/curto").status_code == 404  # fora do formato: nem chega a API
    assert c.get(f"/chamado/{PROTOCOLO}/acesso/{'<script>' * 6}").status_code == 404
    assert len(fake.chamadas) == antes


def test_upload_envia_o_arquivo_a_api_com_token_e_aparece_na_listagem():
    c, fake = make()
    abrir_sessao(c)
    r = c.post(f"/chamado/{PROTOCOLO}/documentos", data={"tipo": "RG"},
               files={"arquivo": ("meu rg.png", PNG, "image/png")})
    assert r.status_code == 303
    envio = next(x for x in fake.chamadas if x.method == "POST" and x.url.path.endswith("/documentos"))
    assert envio.headers["authorization"] == f"Bearer {TOKEN}"
    assert b'name="tipo"' in envio.content and PNG in envio.content
    assert b"meu rg.png" not in envio.content  # o nome vindo do usuario nao e repassado
    assert "Em analise" in c.get(f"/chamado/{PROTOCOLO}").text


def test_upload_sem_sessao_ou_com_arquivo_invalido_nao_chega_a_api():
    c, fake = make()
    r = c.post(f"/chamado/{PROTOCOLO}/documentos", data={"tipo": "RG"}, files={"arquivo": ("a.png", PNG, "image/png")})
    assert r.status_code == 401 and fake.chamadas == []
    abrir_sessao(c)
    antes = len(fake.chamadas)
    r = c.post(f"/chamado/{PROTOCOLO}/documentos", data={"tipo": "RG"}, files={"arquivo": ("a.png", b"MZ ruim", "image/png")})
    assert r.status_code == 422 and "Tipo nao permitido" in r.text
    assert not any(x.method == "POST" and x.url.path.endswith("/documentos") for x in fake.chamadas[antes:])


def test_sessao_expirada_na_api_pede_novo_link_e_limpa_o_cookie():
    c, fake = make()
    abrir_sessao(c)
    c.cookies.clear()
    c.cookies.set("kronos_portal", "token.vencido", path="/chamado")
    r = c.get(f"/chamado/{PROTOCOLO}")
    assert r.status_code == 401 and "sessao expirou" in r.text and "novo link" in r.text
    assert "kronos_portal" in r.headers["set-cookie"]


def test_api_fora_do_ar_vira_502_sem_vazar_detalhe():
    c, fake = make()
    abrir_sessao(c)
    fake.fora_do_ar = True
    r = c.get(f"/chamado/{PROTOCOLO}")
    assert r.status_code == 502 and "sem rede" not in r.text and "http://api" not in r.text
    assert pedir_link(c).status_code == 502


def test_protocolo_fora_do_formato_nao_vai_para_a_api():
    c, fake = make()
    assert c.get("/chamado/ABC").status_code == 404
    assert c.post("/chamado/ABC/link", data={"cpf": CPF}).status_code == 404
    assert c.post(f"/chamado/ABC/acesso/{CODIGO}").status_code == 404
    assert fake.chamadas == []


def test_pedir_link_tem_rate_limit():
    c, _ = make(max_calls=2)
    codes = [pedir_link(c).status_code for _ in range(3)]
    assert codes == [200, 200, 429]


def test_candidatura_fora_do_demo_nao_cria_protocolo_ficticio():
    c, fake = make()
    r = c.post("/vagas/v1/candidatar", data={"nome": "Maria Silva", "email": "maria@example.com",
                                             "cpf": CPF, "consentimento": "on"})
    assert r.status_code == 503
    assert "location" not in r.headers
    assert fake.chamadas == []
