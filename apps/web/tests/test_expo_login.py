import time

from fastapi.testclient import TestClient

from app.config import Settings, load_settings
from app.gateway import DemoGateway
from app.main import create_app
from app.services.rag import BaseConhecimento

EMAIL, SENHA = "equipe.teste@exemplo.test", "kronos-expo-2026"
ROTAS_RH = ["/painel", "/painel/fila", "/painel/fila/tabela", "/painel/chamado/ADM-2026-000001", "/rh/dashboard",
            "/rh/fila", "/rh/chamados/ADM-2026-000001", "/rh/conhecimento", "/rh/gastos",
            "/rh/chamados/ADM-2026-000001/export-erp"]


def app(expo=True, secret="s" * 32):
    cfg = Settings("", True, secret, 30, 60, expo_login=expo)
    return TestClient(create_app(cfg, gateway=DemoGateway(), conhecimento=BaseConhecimento(":memory:")), follow_redirects=False)


def entrar(c, senha=SENHA, email=EMAIL):
    return c.post("/login", data={"email": email, "senha": senha})


def test_desligado_por_padrao_o_demo_continua_aberto_e_sem_login():
    c = app(expo=False)
    assert c.get("/login").status_code == 404 and c.post("/login", data={"email": EMAIL, "senha": SENHA}).status_code == 404
    for rota in ROTAS_RH:
        assert c.get(rota).status_code == 200, rota
    assert "Diego (RH)" in c.get("/painel").text and "Sair" not in c.get("/painel").text


def test_ligado_toda_rota_do_rh_exige_login_e_o_portal_do_candidato_continua_publico():
    c = app()
    for rota in ROTAS_RH:
        r = c.get(rota)
        assert r.status_code == 303 and r.headers["location"] == "/login", rota
    assert c.post("/painel/documentos/x/decisao", data={"acao": "aprovar", "protocolo": "ADM-2026-000001"}).status_code == 303
    assert c.post("/painel/chamado/ADM-2026-000001/avancar").status_code == 303
    assert c.post("/rh/conhecimento", data={"pergunta": "prazo do chamado"}).status_code == 303
    for publico in ("/", "/vagas", "/vagas/v1", "/chamado/ADM-2026-000001", "/health"):
        assert c.get(publico).status_code == 200, publico


def test_htmx_sem_sessao_recebe_hx_redirect_para_o_login():
    r = app().get("/rh/fila", headers={"HX-Request": "true"})
    assert r.status_code == 200 and r.headers["HX-Redirect"] == "/login"


def test_tela_de_login_mostra_a_conta_de_teste_e_nao_pede_2fa():
    html = app().get("/login").text
    assert EMAIL in html and SENHA in html and "2FA" not in html and "Conta de teste para exposição" in html


def test_credenciais_erradas_nao_criam_sessao_e_nao_dizem_qual_campo_errou():
    c = app()
    for r in (entrar(c, senha="errada"), entrar(c, email="outra@exemplo.test"), entrar(c, senha="", email=EMAIL)):
        assert r.status_code in (401, 422) and "set-cookie" not in r.headers
    assert "E-mail ou senha incorretos" in entrar(c, senha="errada").text
    assert c.get("/rh/dashboard").status_code == 303


def test_login_correto_abre_o_painel_com_cookie_httponly_e_mostra_sair():
    c = app()
    r = entrar(c)
    assert r.status_code == 303 and r.headers["location"] == "/painel"
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=lax" in cookie and "max-age=28800" in cookie
    for rota in ROTAS_RH:
        assert c.get(rota).status_code == 200, rota
    painel = c.get("/painel").text
    assert "Sair" in painel and "Diego (RH)" not in painel
    assert c.post("/rh/conhecimento", data={"pergunta": "como funciona o prazo"}).status_code == 200


def test_email_do_login_nao_diferencia_maiusculas():
    c = app()
    assert entrar(c, email=EMAIL.upper()).status_code == 303


def test_cookie_adulterado_expirado_ou_de_outro_servidor_e_recusado():
    c = app()
    entrar(c)
    bom = c.cookies.get("kronos_equipe")
    exp, sig = bom.split(".")
    for falso in (f"{exp}.{'0' * 64}", f"{int(exp) + 99999}.{sig}", "lixo", f"{int(time.time()) - 5}.{sig}", ".", ""):
        c.cookies.set("kronos_equipe", falso)
        assert c.get("/rh/dashboard").status_code == 303, falso
    outro = app(secret="x" * 32)  # servidor com outro segredo nao aceita o cookie do primeiro
    outro.cookies.set("kronos_equipe", bom)
    assert outro.get("/rh/dashboard").status_code == 303


def test_sair_encerra_a_sessao_e_volta_ao_login():
    c = app()
    entrar(c)
    r = c.post("/sair")
    assert r.status_code == 303 and r.headers["location"] == "/login"
    c.cookies.clear()
    assert c.get("/painel").status_code == 303


def test_exposicao_so_vale_no_modo_demo():
    cfg = load_settings({"DEMO_MODE": "false", "SESSION_SECRET": "s" * 32, "API_BASE_URL": "http://api", "EXPO_LOGIN": "true"})
    assert cfg.expo_login is False
    assert load_settings({"DEMO_MODE": "true", "EXPO_LOGIN": "true"}).expo_login is True
    assert load_settings({"DEMO_MODE": "true"}).expo_login is False
    outra = load_settings({"DEMO_MODE": "true", "EXPO_LOGIN": "true", "EXPO_EMAIL": " a@b.co ", "EXPO_SENHA": "x"})
    assert (outra.expo_email, outra.expo_senha) == ("a@b.co", "x")


def test_limite_de_tentativas_de_login():
    cfg = Settings("", True, "s" * 32, 3, 60, expo_login=True)
    c = TestClient(create_app(cfg, gateway=DemoGateway(), conhecimento=BaseConhecimento(":memory:")), follow_redirects=False)
    codigos = [entrar(c, senha="errada").status_code for _ in range(5)]
    assert codigos[:3] == [401, 401, 401] and codigos[3:] == [429, 429]
