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
    assert len(gw.obter_chamado("ADM-2026-000001").documentos) == 3  # so os 3 do seed do demo: nada novo foi guardado


def test_formulario_avisa_que_demo_nao_salva_documentos():
    c = make()
    assert "O conteudo nao e salvo nem enviado ao RH" in c.get("/chamado/ADM-2026-000001").text


def _chamado(c):
    return c.post("/vagas/v1/candidatar", data=VALID).headers["location"]


def test_upload_valido_marca_item_em_analise():
    c = make()
    url = _chamado(c)
    assert "Faltando" in c.get(url).text
    r = c.post(url + "/documentos", data={"tipo": "RG"}, files={"arquivo": ("rg.png", PNG, "image/png")})
    assert r.status_code == 303 and r.headers["location"] == url
    assert "Em analise" in c.get(url).text


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

# --- Fila do RH ---------------------------------------------------------------
from datetime import datetime, timedelta, timezone

from app.fila import filtrar, sla_situacao
from app.gateway import Chamado

AGORA = datetime(2026, 11, 7, 12, 0, tzinfo=timezone.utc)


def _ch(status="TRIAGEM", prazo=None, nome="Ana", protocolo="ADM-2026-000001"):
    return Chamado(protocolo, "v1", nome, status=status, prazo_sla=prazo)


def test_sla_situacoes():
    assert sla_situacao(_ch(prazo=AGORA - timedelta(minutes=1)), AGORA) == "atrasado"
    assert sla_situacao(_ch(prazo=AGORA + timedelta(hours=24)), AGORA) == "vencendo"
    assert sla_situacao(_ch(prazo=AGORA + timedelta(hours=25)), AGORA) == "no_prazo"
    assert sla_situacao(_ch(prazo=None), AGORA) == "sem_sla"
    assert sla_situacao(_ch(status="ADMITIDO", prazo=AGORA - timedelta(days=9)), AGORA) == "sem_sla"


def test_filtrar_por_status_e_busca_e_ordena_por_urgencia():
    a = _ch("TRIAGEM", AGORA + timedelta(days=2), "Ana Souza", "ADM-2026-000001")
    b = _ch("TRIAGEM", AGORA + timedelta(hours=1), "Bruno Lima", "ADM-2026-000002")
    c = _ch("ADMITIDO", None, "Carla Dias", "ADM-2026-000003")
    assert filtrar([a, b, c]) == [b, a, c]
    assert filtrar([a, b, c], status="ADMITIDO") == [c]
    assert filtrar([a, b, c], busca="bruno") == [b]
    assert filtrar([a, b, c], busca="000003") == [c]


def test_fila_lista_filtra_e_so_existe_em_demo():
    c = make()
    page = c.get("/painel/fila")
    assert page.status_code == 200 and "Ana Souza" in page.text and "Atrasado" in page.text
    frag = c.get("/painel/fila/tabela", params={"status": "TRIAGEM"})
    assert "Bruno Lima" in frag.text and "Ana Souza" not in frag.text
    assert "<html" not in frag.text  # fragmento HTMX, sem layout
    assert "Nenhum chamado" in c.get("/painel/fila/tabela", params={"busca": "zzz"}).text
    assert make(demo=False).get("/painel/fila").status_code == 404
    assert make(demo=False).get("/painel/fila/tabela").status_code == 404


def test_fila_rejeita_status_invalido_e_escapa_busca():
    c = make()
    assert c.get("/painel/fila/tabela", params={"status": "HACK"}).status_code == 422
    r = c.get("/painel/fila", params={"busca": '"><script>alert(1)</script>'})
    assert "<script>alert(1)</script>" not in r.text


# --- Detalhe do chamado no RH e documentos ---------------------------------------
PDF = b"%PDF-1.7\nconteudo de teste"
PNG = b"\x89PNG\r\n\x1a\n\x00\x00"


def upload(c, protocolo, conteudo, tipo="RG", nome="x.pdf"):
    return c.post(f"/chamado/{protocolo}/documentos", data={"tipo": tipo}, files={"arquivo": (nome, conteudo, "application/pdf")})


def test_candidato_envia_documento_e_ve_o_checklist():
    c = make()
    p = c.post("/vagas/v1/candidatar", data=VALID).headers["location"].rsplit("/", 1)[1]
    assert "Faltando" in c.get(f"/chamado/{p}").text
    r = upload(c, p, PDF)
    assert r.status_code == 303
    assert "Em analise" in c.get(f"/chamado/{p}").text


@pytest.mark.parametrize("conteudo", [b"MZ\x90\x00", b"<html><script>", b""])
def test_upload_rejeita_conteudo_invalido_mesmo_com_nome_pdf(conteudo):
    c = make()
    p = c.post("/vagas/v1/candidatar", data=VALID).headers["location"].rsplit("/", 1)[1]
    assert upload(c, p, conteudo, nome="inocente.pdf").status_code == 422
    assert "Em analise" not in c.get(f"/chamado/{p}").text


def test_upload_acima_de_5mb_responde_413_como_a_api():
    c = make()
    p = c.post("/vagas/v1/candidatar", data=VALID).headers["location"].rsplit("/", 1)[1]
    assert upload(c, p, PDF + b"x" * (5 * 1024 * 1024), nome="grande.pdf").status_code == 413
    assert "Em analise" not in c.get(f"/chamado/{p}").text


def test_upload_nao_ecoa_o_nome_do_arquivo():
    c = make()
    p = c.post("/vagas/v1/candidatar", data=VALID).headers["location"].rsplit("/", 1)[1]
    upload(c, p, PNG, nome="<script>alert(1)</script>.png")
    assert "<script>alert(1)</script>" not in c.get(f"/chamado/{p}").text


def test_upload_tipo_invalido_e_chamado_inexistente():
    c = make()
    p = c.post("/vagas/v1/candidatar", data=VALID).headers["location"].rsplit("/", 1)[1]
    assert upload(c, p, PDF, tipo="PASSAPORTE").status_code == 422
    assert upload(c, "ADM-2026-999999", PDF).status_code == 404


def test_detalhe_do_rh_mostra_documentos_e_linha_do_tempo():
    r = make().get("/painel/chamado/ADM-2026-000001")
    assert r.status_code == 200
    assert "Aguardando decisao" in r.text and "Linha do tempo" in r.text and "Documentos recebidos" in r.text


def test_rh_aprova_e_recusa_com_motivo_via_htmx():
    c = make()
    ok = c.post("/painel/documentos/d1/decisao", data={"acao": "aprovar"})
    assert ok.status_code == 200 and "Aprovado" in ok.text
    sem_motivo = c.post("/painel/documentos/d2/decisao", data={"acao": "recusar", "motivo": ""})
    assert "motivo da recusa" in sem_motivo.text and "Recusado" not in sem_motivo.text
    rec = c.post("/painel/documentos/d2/decisao", data={"acao": "recusar", "motivo": "Foto ilegivel"})
    assert "Recusado" in rec.text and "Foto ilegivel" in rec.text
    assert "ja foi decidido" in c.post("/painel/documentos/d1/decisao", data={"acao": "recusar", "motivo": "tarde demais"}).text


def test_decisao_valida_acao_e_documento():
    c = make()
    assert c.post("/painel/documentos/d1/decisao", data={"acao": "apagar"}).status_code == 422
    assert c.post("/painel/documentos/nao-existe/decisao", data={"acao": "aprovar"}).status_code == 404


def test_candidato_ve_motivo_da_recusa():
    c = make()
    c.post("/painel/documentos/d3/decisao", data={"acao": "recusar", "motivo": "Conta antiga"})
    assert "Conta antiga" in c.get("/chamado/ADM-2026-000001").text


def test_avancar_percorre_o_fluxo_ate_admitido():
    c = make()
    p = "ADM-2026-000001"
    for _ in range(3):  # VALIDACAO_DP -> ASSINATURA -> ENVIO_ERP -> ADMITIDO
        assert c.post(f"/painel/chamado/{p}/avancar").status_code == 303
    page = c.get(f"/painel/chamado/{p}").text
    assert "Admitido" in page and "Chamado encerrado" in page
    assert c.post(f"/painel/chamado/{p}/avancar").status_code == 409


def test_rotas_do_rh_somem_fora_do_modo_demo():
    c = make(demo=False)
    assert c.get("/painel/chamado/ADM-2026-000001").status_code == 404
    assert c.post("/painel/documentos/d1/decisao", data={"acao": "aprovar"}).status_code == 404
    assert c.post("/painel/chamado/ADM-2026-000001/avancar").status_code == 404
