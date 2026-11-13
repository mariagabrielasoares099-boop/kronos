"""Login da equipe fora do demo: senha + 2FA na API (simulada com httpx.MockTransport), sessao em cookie HttpOnly."""
import json

import httpx
from fastapi.testclient import TestClient

from app.api_client import ApiClient
from app.config import Settings
from app.main import create_app

EMAIL = "rh@empresa.com"
SENHA = "senha-forte-123"
CODIGO = "123456"
TOKEN = "token.da.equipe"


class FakeApi:
    def __init__(self):
        self.chamadas: list[httpx.Request] = []
        self.exige_2fa = True
        self.bloqueada = False
        self.fora_do_ar = False

    def __call__(self, req: httpx.Request) -> httpx.Response:
        self.chamadas.append(req)
        if self.fora_do_ar:
            raise httpx.ConnectError("sem rede", request=req)
        if req.url.path != "/auth/login":
            return httpx.Response(404)
        b = json.loads(req.content)
        if self.bloqueada:
            return httpx.Response(429)
        if b["email"] != EMAIL or b["senha"] != SENHA:
            return httpx.Response(401, json={"message": "Credenciais invalidas"})
        if self.exige_2fa and not b.get("codigo"):
            return httpx.Response(401, json={"message": "Informe o codigo", "codigo2fa": True})
        if self.exige_2fa and b["codigo"] != CODIGO:
            return httpx.Response(401, json={"message": "Credenciais invalidas"})
        return httpx.Response(200, json={"token": TOKEN, "expiraEm": "2099-01-01T00:00:00.000Z", "papel": "DP"})


def make(fake: FakeApi | None = None, max_calls=10):
    fake = fake or FakeApi()
    api = ApiClient("http://api", client=httpx.Client(base_url="http://api", transport=httpx.MockTransport(fake)))
    return TestClient(create_app(Settings("http://api", False, "s" * 32, max_calls, 60), api=api),
                      follow_redirects=False), fake


def entrar(c, **kw):
    return c.post("/login", data={"email": EMAIL, "senha": SENHA, "codigo": CODIGO, **kw})


def test_painel_sem_sessao_manda_para_o_login():
    c, fake = make()
    r = c.get("/painel")
    assert r.status_code == 303 and r.headers["location"] == "/login" and fake.chamadas == []


def test_login_ok_grava_cookie_httponly_e_abre_o_painel():
    c, fake = make()
    r = entrar(c)
    assert r.status_code == 303 and r.headers["location"] == "/painel"
    cookie = r.headers["set-cookie"].lower()
    assert "kronos_equipe=" in cookie and "httponly" in cookie and "samesite=lax" in cookie
    assert json.loads(fake.chamadas[0].content) == {"email": EMAIL, "senha": SENHA, "codigo": CODIGO}
    assert c.get("/painel").status_code == 200


def test_sem_codigo_pede_o_2fa_sem_criar_sessao():
    c, _ = make()
    r = c.post("/login", data={"email": EMAIL, "senha": SENHA})
    assert r.status_code == 401 and "codigo do aplicativo" in r.text and "set-cookie" not in r.headers
    assert r.headers["cache-control"] == "no-store"


def test_senha_ou_codigo_errado_tem_a_mesma_mensagem_generica():
    c, _ = make()
    a = c.post("/login", data={"email": EMAIL, "senha": "errada", "codigo": CODIGO})
    b = c.post("/login", data={"email": "outro@empresa.com", "senha": SENHA, "codigo": CODIGO})
    d = entrar(c, codigo="000000")
    for r in (a, b, d):
        assert r.status_code == 401 and "incorretos" in r.text and "set-cookie" not in r.headers
    assert "senha-forte" not in d.text  # nunca devolve a senha


def test_conta_bloqueada_e_2fa_nao_configurado_nao_abrem_sessao():
    c, fake = make()
    fake.bloqueada = True
    r = entrar(c)
    assert r.status_code == 429 and "set-cookie" not in r.headers


def test_entrada_invalida_nem_chega_a_api_e_ha_rate_limit():
    c, fake = make(max_calls=2)
    assert c.post("/login", data={"email": "nao-e-email", "senha": "x"}).status_code == 422
    assert c.post("/login", data={"email": EMAIL, "senha": ""}).status_code == 422
    assert fake.chamadas == []
    assert c.post("/login", data={"email": EMAIL, "senha": "x"}).status_code == 429


def test_api_fora_do_ar_vira_502_sem_vazar_detalhe():
    c, fake = make()
    fake.fora_do_ar = True
    r = entrar(c)
    assert r.status_code == 502 and "sem rede" not in r.text and "http://api" not in r.text


def test_sair_limpa_o_cookie_e_volta_ao_login():
    c, _ = make()
    entrar(c)
    r = c.post("/sair")
    assert r.status_code == 303 and r.headers["location"] == "/login"
    assert "kronos_equipe" in r.headers["set-cookie"]
    c.cookies.clear()
    assert c.get("/painel").status_code == 303


def test_no_demo_nao_existe_login():
    c = TestClient(create_app(Settings("http://api", True, "s" * 32, 10, 60)), follow_redirects=False)
    assert c.get("/login").status_code == 404
    assert c.post("/login", data={"email": EMAIL, "senha": SENHA}).status_code == 404
