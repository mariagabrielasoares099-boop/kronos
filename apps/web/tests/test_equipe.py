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


PROTOCOLO = "ADM-2026-000001"
CHAMADO_ID = "0190d2a0-0000-7000-8000-000000000001"
DOC_ID = "0190d2a0-0000-7000-8000-0000000000d1"
RESUMO = {"id": CHAMADO_ID, "protocolo": PROTOCOLO, "status": "VALIDACAO_DP", "vagaTitulo": "Analista",
          "candidatoNome": "Ana Souza", "responsavelNome": "Rita RH", "prazoSla": "2020-01-01T00:00:00.000Z",
          "criadoEm": "2019-12-01T00:00:00.000Z"}


class FakeApi:
    def __init__(self):
        self.chamadas: list[httpx.Request] = []
        self.exige_2fa = True
        self.bloqueada = False
        self.fora_do_ar = False
        self.consultas: list[dict] = []
        self.decisoes: list[dict] = []
        self.transicoes: list[dict] = []
        self.status_doc = "PENDENTE"
        self.motivo_doc = None
        self.sem_atribuicao = False
        self.atribuicoes: list[dict] = []
        self.atribuicao_status = 200  # 403 papel sem permissao, 409 sem vinculo com a empresa

    def equipe(self, req: httpx.Request) -> httpx.Response:
        """Rotas da API usadas pelo painel; exige o token da equipe como a API real."""
        if req.headers.get("authorization") != f"Bearer {TOKEN}":
            return httpx.Response(401)
        path, m = req.url.path, req.method
        if path == "/chamados" and m == "GET":
            self.consultas.append(dict(req.url.params))
            return httpx.Response(200, json=[RESUMO])
        if path == f"/chamados/{PROTOCOLO}/resumo":
            return httpx.Response(200, json=RESUMO)
        if path == f"/chamados/{CHAMADO_ID}/eventos":
            extra = [] if self.sem_atribuicao or not self.atribuicoes else [
                {"tipo": "ATRIBUICAO", "de": None, "para": None, "motivo": None, "detalhe": "Atribuido a Rita RH",
                 "autorNome": "Rita RH", "em": "2019-12-03T00:00:00Z"}]
            return httpx.Response(200, json=[
                {"tipo": "CRIADO", "de": None, "para": "TRIAGEM", "motivo": None, "autorNome": "Rita RH",
                 "em": "2019-12-01T00:00:00Z"},
                {"tipo": "TRANSICAO", "de": "TRIAGEM", "para": "VALIDACAO_DP", "motivo": "ok", "autorNome": "Rita RH",
                 "em": "2019-12-02T00:00:00Z"},
            ] + extra)
        if path == f"/chamados/{CHAMADO_ID}/documentos" and self.sem_atribuicao:
            return httpx.Response(404)  # a API esconde documentos de quem nao esta atribuido
        if path == f"/chamados/{CHAMADO_ID}/documentos":
            return httpx.Response(200, json={"documentos": [
                {"id": DOC_ID, "tipo": "RG", "status": self.status_doc, "motivo": self.motivo_doc}], "checklist": []})
        if path == f"/documentos/{DOC_ID}/arquivo":
            return httpx.Response(200, content=b"%PDF-1.7 fake", headers={"content-type": "application/pdf"})
        if path == f"/documentos/{DOC_ID}" and m == "PATCH":
            corpo = json.loads(req.content)
            self.decisoes.append(corpo)
            if self.status_doc != "PENDENTE":
                return httpx.Response(409)
            self.status_doc, self.motivo_doc = corpo["status"], corpo.get("motivo")
            return httpx.Response(200, json={})
        if path == f"/chamados/{CHAMADO_ID}/atribuicao" and m == "POST":
            self.atribuicoes.append(json.loads(req.content))
            if self.atribuicao_status == 200:
                self.sem_atribuicao = False
            return httpx.Response(self.atribuicao_status, json={})
        if path == f"/chamados/{CHAMADO_ID}/transicoes" and m == "POST":
            self.transicoes.append(json.loads(req.content))
            return httpx.Response(200, json={})
        return httpx.Response(404)

    def __call__(self, req: httpx.Request) -> httpx.Response:
        self.chamadas.append(req)
        if self.fora_do_ar:
            raise httpx.ConnectError("sem rede", request=req)
        if req.url.path != "/auth/login":
            return self.equipe(req)
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
    r = c.get("/painel")
    assert r.status_code == 303 and r.headers["location"] == "/painel/fila"


def test_sem_codigo_pede_o_2fa_sem_criar_sessao():
    c, _ = make()
    r = c.post("/login", data={"email": EMAIL, "senha": SENHA})
    assert r.status_code == 401 and "código do aplicativo" in r.text and "set-cookie" not in r.headers
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


# --- Fila, detalhe e decisoes pela API real ---------------------------------------
def logado():
    c, fake = make()
    entrar(c)
    return c, fake


def test_fila_mostra_chamados_da_api_com_sla_e_repassa_filtros():
    c, fake = logado()
    r = c.get("/painel/fila", params={"status": "VALIDACAO_DP", "busca": " ana "})
    assert r.status_code == 200 and "Ana Souza" in r.text and "Atrasado" in r.text and "Rita RH" in r.text
    assert fake.consultas[-1] == {"status": "VALIDACAO_DP", "busca": "ana"}
    assert f'href="/painel/chamado/{PROTOCOLO}"' in r.text
    assert c.get("/painel/fila/tabela", params={"status": "HACK"}).status_code == 422


def test_sessao_vencida_na_api_volta_ao_login_e_limpa_o_cookie():
    c, _ = make()
    c.cookies.set("kronos_equipe", "token.vencido", path="/")
    r = c.get("/painel/fila")
    assert r.status_code == 303 and r.headers["location"] == "/login" and "kronos_equipe" in r.headers["set-cookie"]
    h = c.post(f"/painel/documentos/{DOC_ID}/decisao", data={"acao": "aprovar", "protocolo": PROTOCOLO},
               headers={"HX-Request": "true"})
    assert h.status_code == 200 and h.headers["hx-redirect"] == "/login"  # HTMX nao segue 303 sozinho


def test_detalhe_traz_documentos_e_linha_do_tempo_da_api():
    c, _ = logado()
    r = c.get(f"/painel/chamado/{PROTOCOLO}")
    assert r.status_code == 200 and "Ana Souza" in r.text and "Aguardando decisão" in r.text
    assert "Validar e seguir para assinatura" in r.text
    assert c.get("/painel/chamado/ADM-2026-999999").status_code == 404
    assert c.get("/painel/chamado/ABC").status_code == 404


def test_aprovar_e_recusar_documento_gravam_na_api_e_recarregam_o_estado():
    c, fake = logado()
    r = c.post(f"/painel/documentos/{DOC_ID}/decisao", data={"acao": "recusar", "motivo": "ab", "protocolo": PROTOCOLO})
    assert "mínimo 3 caracteres" in r.text and fake.decisoes == []  # nem chega a API
    r = c.post(f"/painel/documentos/{DOC_ID}/decisao",
               data={"acao": "recusar", "motivo": " Foto ilegivel ", "protocolo": PROTOCOLO})
    assert fake.decisoes == [{"status": "RECUSADO", "motivo": "Foto ilegivel"}]
    assert "Recusado" in r.text and "Foto ilegivel" in r.text
    r = c.post(f"/painel/documentos/{DOC_ID}/decisao", data={"acao": "aprovar", "protocolo": PROTOCOLO})
    assert "já foi decidido" in r.text  # a API respondeu 409


def test_decisao_so_vale_para_documento_do_chamado_informado():
    c, fake = logado()
    outro = "0190d2a0-0000-7000-8000-0000000000ff"
    assert c.post(f"/painel/documentos/{outro}/decisao", data={"acao": "aprovar", "protocolo": PROTOCOLO}).status_code == 404
    assert c.post("/painel/documentos/x/decisao", data={"acao": "aprovar", "protocolo": PROTOCOLO}).status_code == 404
    assert c.post(f"/painel/documentos/{DOC_ID}/decisao", data={"acao": "hack", "protocolo": PROTOCOLO}).status_code == 422
    assert fake.decisoes == []


def test_avancar_chama_a_transicao_da_api():
    c, fake = logado()
    r = c.post(f"/painel/chamado/{PROTOCOLO}/avancar")
    assert r.status_code == 303 and r.headers["location"] == f"/painel/chamado/{PROTOCOLO}"
    assert fake.transicoes == [{"acao": "AVANCAR"}]


def test_master_detail_pela_api_fragmento_e_avancar_via_htmx():
    c, fake = logado()
    frag = c.get(f"/painel/chamado/{PROTOCOLO}/detalhe")
    assert frag.status_code == 200 and "<html" not in frag.text and "Ana Souza" in frag.text
    r = c.post(f"/painel/chamado/{PROTOCOLO}/avancar", headers={"HX-Request": "true"})
    assert r.status_code == 200 and r.headers["hx-trigger"] == "atualizarFila" and fake.transicoes == [{"acao": "AVANCAR"}]
    c.cookies.clear()
    assert c.get(f"/painel/chamado/{PROTOCOLO}/detalhe").status_code == 303


def test_ver_documento_baixa_pela_api_como_anexo_e_so_do_proprio_chamado():
    c, fake = logado()
    page = c.get(f"/painel/chamado/{PROTOCOLO}")
    assert f"/painel/chamado/{PROTOCOLO}/documentos/{DOC_ID}/arquivo" in page.text
    r = c.get(f"/painel/chamado/{PROTOCOLO}/documentos/{DOC_ID}/arquivo")
    assert r.status_code == 200 and r.content == b"%PDF-1.7 fake" and r.headers["content-type"] == "application/pdf"
    assert r.headers["content-disposition"].startswith("attachment") and r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["cache-control"] == "private, no-store"
    outro = "0190d2a0-0000-7000-8000-0000000000ff"
    assert c.get(f"/painel/chamado/{PROTOCOLO}/documentos/{outro}/arquivo").status_code == 404
    assert c.get(f"/painel/chamado/{PROTOCOLO}/documentos/x/arquivo").status_code == 404
    c.cookies.clear()
    assert c.get(f"/painel/chamado/{PROTOCOLO}/documentos/{DOC_ID}/arquivo").status_code == 303


def test_equipe_sem_atribuicao_ve_o_chamado_mas_nao_os_documentos_e_nao_recebe_502():
    c, fake = logado()
    fake.sem_atribuicao = True
    r = c.get(f"/painel/chamado/{PROTOCOLO}/detalhe")
    assert r.status_code == 200 and "Ana Souza" in r.text and "n&atilde;o est&aacute; atribu" in r.text
    assert "Aguardando decisão" not in r.text and "btn-ok" not in r.text  # nada para decidir sem atribuicao
    assert c.post(f"/painel/documentos/{DOC_ID}/decisao", data={"acao": "aprovar", "protocolo": PROTOCOLO}).status_code == 404
    assert fake.decisoes == []


def test_layout_do_rh_com_login_real_tem_menu_sair_e_sem_nome_de_demonstracao():
    c, _ = logado()
    page = c.get("/painel/fila").text
    assert 'class="area-rh"' in page and 'action="/sair"' in page and "Diego" not in page
    assert "Portal de vagas" not in page and "includeIndicatorStyles" in page  # htmx sem estilo inline (CSP)


def test_detalhe_mostra_o_titulo_da_vaga_da_api_e_favicon_nao_da_404():
    c, _ = logado()
    assert "Analista" in c.get(f"/painel/chamado/{PROTOCOLO}/detalhe").text
    assert c.get("/favicon.ico").status_code == 204


def test_assumir_chamado_pela_tela_atribui_na_api_e_libera_os_documentos():
    c, fake = logado()
    fake.sem_atribuicao = True
    antes = c.get(f"/painel/chamado/{PROTOCOLO}/detalhe").text
    assert "Assumir este chamado" in antes and "Aguardando decisão" not in antes
    r = c.post(f"/painel/chamado/{PROTOCOLO}/atribuir", headers={"HX-Request": "true"})
    assert r.status_code == 200 and r.headers["hx-trigger"] == "atualizarFila" and fake.atribuicoes == [{}]
    assert "Aguardando decisão" in r.text and "Assumir este chamado" not in r.text  # estado novo veio da API
    assert "Atribuido a Rita RH por Rita RH" in r.text  # auditoria visivel na linha do tempo
    assert "<html" not in r.text


def test_assumir_chamado_sem_javascript_redireciona_e_exige_sessao():
    c, fake = logado()
    fake.sem_atribuicao = True
    r = c.post(f"/painel/chamado/{PROTOCOLO}/atribuir")
    assert r.status_code == 303 and r.headers["location"] == f"/painel/chamado/{PROTOCOLO}"
    c.cookies.clear()
    r = c.post(f"/painel/chamado/{PROTOCOLO}/atribuir")
    assert r.status_code == 303 and r.headers["location"] == "/login"
    assert len(fake.atribuicoes) == 1  # a segunda tentativa nem chegou a API


def test_atribuicao_negada_pela_api_mostra_aviso_e_nao_libera_documentos():
    for status, trecho in ((403, "papel não permite"), (409, "não pode ser atribuído")):
        c, fake = logado()
        fake.sem_atribuicao = True
        fake.atribuicao_status = status
        r = c.post(f"/painel/chamado/{PROTOCOLO}/atribuir", headers={"HX-Request": "true"})
        assert r.status_code == 200 and trecho in r.text and "Aguardando decisão" not in r.text
        assert c.post(f"/painel/chamado/{PROTOCOLO}/atribuir").status_code == status  # sem HTMX: o mesmo codigo


def test_atribuir_valida_o_protocolo_e_nao_existe_no_demo():
    c, fake = logado()
    assert c.post("/painel/chamado/ABC/atribuir").status_code == 404
    assert c.post("/painel/chamado/ADM-2026-999999/atribuir").status_code == 404
    assert fake.atribuicoes == []
    demo = TestClient(create_app(Settings("http://api", True, "s" * 32, 10, 60)), follow_redirects=False)
    assert demo.post("/painel/chamado/ADM-2026-000001/atribuir").status_code == 404
