"""Portal fora do demo: entrada com CPF + upload para a API real (simulada com httpx.MockTransport)."""
import httpx
from fastapi.testclient import TestClient

from app.api_client import ApiClient
from app.config import Settings
from app.main import create_app

PROTOCOLO = "ADM-2026-000001"
CPF = "529.982.247-25"
CHAMADO_ID = "0190d2a0-0000-7000-8000-000000000001"
TOKEN = "token.da.api"
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 32


class FakeApi:
    """Imita as rotas da API NestJS usadas pelo portal e registra o que recebeu."""

    def __init__(self):
        self.chamadas: list[httpx.Request] = []
        self.documentos: list[dict] = []
        self.sessao_status = 200
        self.fora_do_ar = False

    def __call__(self, req: httpx.Request) -> httpx.Response:
        self.chamadas.append(req)
        if self.fora_do_ar:
            raise httpx.ConnectError("sem rede", request=req)
        path = req.url.path
        autenticado = req.headers.get("authorization") == f"Bearer {TOKEN}"
        if path == "/portal/sessao":
            if self.sessao_status != 200:
                return httpx.Response(self.sessao_status)
            return httpx.Response(200, json={"token": TOKEN, "expiraEm": 4_102_444_800})
        if not autenticado:
            return httpx.Response(401)
        if path == f"/chamados/{PROTOCOLO}":
            return httpx.Response(200, json={"id": CHAMADO_ID, "protocolo": PROTOCOLO, "status": "TRIAGEM",
                                             "jobId": "j", "erpRef": None})
        if path == f"/chamados/{CHAMADO_ID}/documentos" and req.method == "GET":
            return httpx.Response(200, json={"documentos": self.documentos, "checklist": []})
        if path == f"/chamados/{CHAMADO_ID}/documentos" and req.method == "POST":
            self.documentos.append({"tipo": "RG", "status": "PENDENTE", "motivo": None,
                                    "mime": "image/png", "tamanhoBytes": 40})
            return httpx.Response(201, json={})
        return httpx.Response(404)


def make(fake: FakeApi | None = None, max_calls=10):
    fake = fake or FakeApi()
    api = ApiClient("http://api", client=httpx.Client(base_url="http://api", transport=httpx.MockTransport(fake)))
    settings = Settings("http://api", False, "s" * 32, max_calls, 60)
    return TestClient(create_app(settings, api=api), follow_redirects=False), fake


def entrar(c):
    return c.post(f"/chamado/{PROTOCOLO}/entrar", data={"cpf": CPF})


def test_sem_sessao_pede_cpf_e_nao_chama_a_api():
    c, fake = make()
    r = c.get(f"/chamado/{PROTOCOLO}")
    assert r.status_code == 200 and "confirme o CPF" in r.text
    assert fake.chamadas == []


def test_entrar_grava_cookie_httponly_e_mostra_o_chamado_da_api():
    c, fake = make()
    r = entrar(c)
    assert r.status_code == 303 and r.headers["location"] == f"/chamado/{PROTOCOLO}"
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=lax" in cookie and "path=/chamado" in cookie
    assert fake.chamadas[0].url.path == "/portal/sessao"
    assert b"52998224725" in fake.chamadas[0].content and CPF.encode() not in fake.chamadas[0].content  # so digitos
    page = c.get(f"/chamado/{PROTOCOLO}")
    assert page.status_code == 200 and "Triagem" in page.text and "faltando" in page.text
    assert all(x.headers["authorization"] == f"Bearer {TOKEN}" for x in fake.chamadas[1:])


def test_cpf_errado_ou_mal_formado_nao_cria_sessao():
    c, fake = make()
    assert c.post(f"/chamado/{PROTOCOLO}/entrar", data={"cpf": "111.111.111-11"}).status_code == 422
    assert fake.chamadas == []  # CPF invalido nem chega a API
    fake.sessao_status = 401
    r = entrar(c)
    assert r.status_code == 401 and "incorreto" in r.text and "set-cookie" not in r.headers


def test_upload_envia_o_arquivo_a_api_com_token_e_aparece_na_listagem():
    c, fake = make()
    entrar(c)
    r = c.post(f"/chamado/{PROTOCOLO}/documentos", data={"tipo": "RG"},
               files={"arquivo": ("meu rg.png", PNG, "image/png")})
    assert r.status_code == 303
    envio = next(x for x in fake.chamadas if x.method == "POST" and x.url.path.endswith("/documentos"))
    assert envio.headers["authorization"] == f"Bearer {TOKEN}"
    assert b'name="tipo"' in envio.content and PNG in envio.content
    assert b"meu rg.png" not in envio.content  # o nome vindo do usuario nao e repassado
    assert "em analise" in c.get(f"/chamado/{PROTOCOLO}").text


def test_upload_sem_sessao_ou_com_arquivo_invalido_nao_chega_a_api():
    c, fake = make()
    r = c.post(f"/chamado/{PROTOCOLO}/documentos", data={"tipo": "RG"}, files={"arquivo": ("a.png", PNG, "image/png")})
    assert r.status_code == 401 and fake.chamadas == []
    entrar(c)
    antes = len(fake.chamadas)
    r = c.post(f"/chamado/{PROTOCOLO}/documentos", data={"tipo": "RG"}, files={"arquivo": ("a.png", b"MZ ruim", "image/png")})
    assert r.status_code == 422 and "Tipo nao permitido" in r.text
    assert not any(x.method == "POST" and x.url.path.endswith("/documentos") for x in fake.chamadas[antes:])


def test_sessao_expirada_na_api_volta_a_pedir_cpf_e_limpa_o_cookie():
    c, fake = make()
    entrar(c)
    c.cookies.set("kronos_portal", "token.vencido", path="/chamado")
    r = c.get(f"/chamado/{PROTOCOLO}")
    assert r.status_code == 401 and "sessao expirou" in r.text
    assert "kronos_portal" in r.headers["set-cookie"]


def test_api_fora_do_ar_vira_502_sem_vazar_detalhe():
    c, fake = make()
    entrar(c)
    fake.fora_do_ar = True
    r = c.get(f"/chamado/{PROTOCOLO}")
    assert r.status_code == 502 and "sem rede" not in r.text and "http://api" not in r.text


def test_protocolo_fora_do_formato_nao_vai_para_a_api():
    c, fake = make()
    assert c.get("/chamado/ABC").status_code == 404
    assert c.post("/chamado/ABC/entrar", data={"cpf": CPF}).status_code == 404
    assert fake.chamadas == []


def test_entrar_tem_rate_limit():
    c, _ = make(max_calls=2)
    codes = [entrar(c).status_code for _ in range(3)]
    assert codes == [303, 303, 429]
