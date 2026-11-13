import pytest
from fastapi.testclient import TestClient

from app.config import Settings, load_settings
from app.main import create_app
from app.security import RateLimiter
from app.validators import is_valid_cpf

VALID = {"nome": "Maria Silva", "email": "maria@example.com", "cpf": "529.982.247-25", "consentimento": "on"}


def make(demo=True, max_calls=10):
    s = Settings("", demo, "x" * 32, max_calls, 60)
    return TestClient(create_app(s), follow_redirects=False)


def test_cpf():
    assert is_valid_cpf("529.982.247-25")
    assert not is_valid_cpf("111.111.111-11")
    assert not is_valid_cpf("52998224726")


def test_vagas_e_headers_de_seguranca():
    r = make().get("/")
    assert r.status_code == 200 and "Auxiliar Administrativo" in r.text
    assert "default-src 'self'" in r.headers["content-security-policy"]
    assert r.headers["x-frame-options"] == "DENY"


def test_candidatura_valida_abre_chamado():
    c = make()
    r = c.post("/vagas/v1/candidatar", data=VALID)
    assert r.status_code == 303 and r.headers["location"].startswith("/chamado/ADM-2026-")
    page = c.get(r.headers["location"])
    assert page.status_code == 200 and "Triagem" in page.text


@pytest.mark.parametrize("campo", ["nome", "email", "cpf", "consentimento"])
def test_candidatura_invalida_nao_cria_chamado(campo):
    data = {**VALID, campo: ""}
    r = make().post("/vagas/v1/candidatar", data=data)
    assert r.status_code == 422


def test_xss_e_escapado():
    c = make()
    r = c.post("/vagas/v1/candidatar", data={**VALID, "nome": "<script>alert(1)</script>"})
    page = c.get(r.headers["location"] + "")
    assert "<script>alert(1)</script>" not in page.text
    painel = c.get("/painel")
    assert "<script>alert(1)</script>" not in painel.text


def test_rate_limit_na_candidatura():
    c = make(max_calls=2)
    codes = [c.post("/vagas/v1/candidatar", data=VALID).status_code for _ in range(3)]
    assert codes == [303, 303, 429]


def test_painel_so_em_modo_demo():
    assert make(demo=True).get("/painel").status_code == 200
    assert make(demo=False).get("/painel").status_code == 404


def test_validacao_htmx_do_cpf():
    c = make()
    assert "CPF valido" in c.post("/validar/cpf", data={"cpf": "529.982.247-25"}).text
    assert "CPF invalido" in c.post("/validar/cpf", data={"cpf": "123"}).text


def test_rate_limiter_janela():
    rl = RateLimiter(2, 10)
    assert rl.allow("a", 0) and rl.allow("a", 1) and not rl.allow("a", 2)
    assert rl.allow("a", 11)


def test_config_producao_exige_segredos():
    with pytest.raises(RuntimeError):
        load_settings({"DEMO_MODE": "false"})
    assert load_settings({"DEMO_MODE": "false", "SESSION_SECRET": "s" * 32, "API_BASE_URL": "http://api"}).demo_mode is False


def test_lista_de_vagas_em_vagas_e_na_raiz():
    c = make()
    assert c.get("/vagas").status_code == 200
    assert c.get("/vagas").text == c.get("/").text


PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 32


def test_upload_fora_do_demo_nao_confirma_envio_sem_sessao():
    """Fora do demo o upload vai para a API com o token do candidato; sem sessao nada e confirmado nem guardado."""
    from app.gateway import DemoGateway

    gw = DemoGateway()
    settings = Settings("http://api", False, "s" * 32, 10, 60)
    c = TestClient(create_app(settings, gateway=gw), follow_redirects=False)
    r = c.post("/chamado/ADM-2026-000001/documentos", data={"tipo": "RG"},
               files={"arquivo": ("rg.png", PNG, "image/png")})
    assert r.status_code == 401
    assert gw.listar_documentos("ADM-2026-000001") == []


def test_formulario_avisa_que_demo_nao_salva_documentos():
    c = make()
    assert "O conteudo nao e salvo nem enviado ao RH" in c.get("/chamado/ADM-2026-000001").text


def _chamado(c):
    return c.post("/vagas/v1/candidatar", data=VALID).headers["location"]


def test_upload_valido_marca_item_em_analise():
    c = make()
    url = _chamado(c)
    assert "faltando" in c.get(url).text
    r = c.post(url + "/documentos", data={"tipo": "RG"}, files={"arquivo": ("rg.png", PNG, "image/png")})
    assert r.status_code == 303 and r.headers["location"] == url
    assert "em analise" in c.get(url).text


def test_upload_confere_conteudo_e_nao_a_extensao():
    c = make()
    url = _chamado(c)
    r = c.post(url + "/documentos", data={"tipo": "RG"}, files={"arquivo": ("rg.png", b"MZ nao e imagem", "image/png")})
    assert r.status_code == 422 and "Tipo nao permitido" in r.text
    assert "em analise" not in c.get(url).text


def test_upload_rejeita_arquivo_grande_vazio_e_tipo_desconhecido():
    c = make()
    url = _chamado(c)
    grande = PNG + b"0" * (5 * 1024 * 1024)
    assert c.post(url + "/documentos", data={"tipo": "RG"}, files={"arquivo": ("a.png", grande, "image/png")}).status_code == 413
    assert c.post(url + "/documentos", data={"tipo": "RG"}, files={"arquivo": ("a.png", b"", "image/png")}).status_code == 422
    assert c.post(url + "/documentos", data={"tipo": "CTPS"}, files={"arquivo": ("a.png", PNG, "image/png")}).status_code == 422


def test_upload_em_chamado_inexistente_e_404_e_tem_rate_limit():
    c = make(max_calls=2)
    assert c.post("/chamado/ADM-2026-999999/documentos", data={"tipo": "RG"}, files={"arquivo": ("a.png", PNG)}).status_code == 404
    url = _chamado(c)
    codes = [c.post(url + "/documentos", data={"tipo": "RG"}, files={"arquivo": ("a.png", PNG)}).status_code for _ in range(3)]
    assert codes[-1] == 429 and 303 in codes
