import httpx
from fastapi.testclient import TestClient

from app.api_client import ApiClient
from app.config import Settings
from app.gateway import DemoGateway
from app.main import create_app
from test_equipe import FakeApi, TOKEN, PROTOCOLO, DOC_ID


def demo():
    gw = DemoGateway()
    app = create_app(Settings("", True, "s" * 32, 30, 60), gateway=gw)
    return TestClient(app), gw


def real(fake=None):
    fake = fake or FakeApi()
    api = ApiClient("http://api", client=httpx.Client(base_url="http://api", transport=httpx.MockTransport(fake)))
    client = TestClient(create_app(Settings("http://api", False, "s" * 32, 30, 60), api=api), follow_redirects=False)
    return client, fake


def test_master_detail_demo_e_abas_sem_spa():
    c, _ = demo()
    page = c.get("/rh/dashboard")
    assert page.status_code == 200
    assert 'id="workspace-detail"' in page.text and "Ana Souza" in page.text
    assert "IA em breve" in page.text and "% Match" not in page.text
    tab = c.get(f"/rh/chamados/{PROTOCOLO}?aba=documentos", headers={"HX-Request": "true"})
    assert "Auditoria de documentos" in tab.text and "<html" not in tab.text
    assert "Aprovar" in tab.text


def test_filtro_e_fallback_sem_javascript():
    c, _ = demo()
    page = c.get("/rh/dashboard?busca=Bruno")
    assert "Bruno Lima" in page.text and "Ana Souza" not in page.text
    assert c.get(f"/rh/chamados/{PROTOCOLO}").status_code == 200


def test_recusa_manual_so_e_gravada_apos_confirmacao():
    c, gw = demo()
    drawer = c.get(f"/rh/chamados/{PROTOCOLO}/recusa?doc_id=d1")
    assert drawer.status_code == 200 and "Confirmar recusa" in drawer.text
    assert gw.obter_documento("d1")[1].status == "PENDENTE"
    decided = c.post(f"/rh/chamados/{PROTOCOLO}/documentos/d1/decisao", data={"acao": "recusar", "motivo": "Reenvie uma imagem legível."})
    assert decided.status_code == 200 and gw.obter_documento("d1")[1].status == "RECUSADO"
    assert decided.headers["hx-trigger"] == "hrCloseDialog"


def test_documento_de_outro_chamado_nao_pode_ser_decidido():
    c, _ = demo()
    base = "/rh/chamados/ADM-2026-000002"
    assert c.get(base + "/recusa?doc_id=d1").status_code == 404
    assert c.post(base + "/documentos/d1/decisao", data={"acao": "aprovar"}).status_code == 404


def test_exportacao_e_previa_sem_alterar_status():
    c, gw = demo()
    status = gw.obter_chamado(PROTOCOLO).status
    r = c.get(f"/rh/chamados/{PROTOCOLO}/export-erp?download=true")
    assert r.status_code == 200 and r.json()["pronto_para_importacao"] is False
    assert "attachment" in r.headers["content-disposition"]
    assert gw.obter_chamado(PROTOCOLO).status == status


def test_dashboard_real_exige_sessao_e_preserva_permissoes():
    c, fake = real()
    assert c.get("/rh/dashboard").status_code == 303
    c.cookies.set("kronos_equipe", TOKEN)
    assert c.get("/rh/dashboard").status_code == 200
    fake.sem_atribuicao = True
    r = c.get(f"/rh/chamados/{PROTOCOLO}?aba=documentos", headers={"HX-Request": "true"})
    assert "Você não está atribuído" in r.text and "Assumir este chamado" in r.text
    assert c.get(f"/rh/chamados/{PROTOCOLO}/recusa?doc_id={DOC_ID}").status_code == 403


def test_csp_estrita_e_recursos_locais():
    c, _ = demo()
    r = c.get("/rh/dashboard")
    csp = r.headers["content-security-policy"]
    assert "cdn.jsdelivr.net" not in csp and "unsafe-inline" not in csp
    assert "cdn.jsdelivr.net" not in r.text
    assert r.headers["cache-control"] == "no-store" and r.headers["referrer-policy"] == "no-referrer"


def test_ia_nao_e_executada_no_fastapi():
    c, _ = demo()
    assert c.post(f"/rh/chamados/{PROTOCOLO}/analise").status_code == 404
    assert c.post(f"/rh/chamados/{PROTOCOLO}/gerar-feedback-recusa", data={"doc_id": "d1"}).status_code == 404


def test_assumir_pelo_workspace_recarrega_dados_da_api():
    c, fake = real()
    c.cookies.set("kronos_equipe", TOKEN)
    fake.sem_atribuicao = True
    r = c.post(f"/rh/chamados/{PROTOCOLO}/atribuir", headers={"HX-Request": "true"})
    assert r.status_code == 200 and r.headers["hx-trigger"] == "hrRefreshQueue"
    assert fake.sem_atribuicao is False
