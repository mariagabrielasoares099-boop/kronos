from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from .config import Settings, load_settings
from .fila import filtrar, sla_situacao
from .gateway import ACAO_AVANCAR, CHECKLIST, PROXIMO, STATUS_LABELS, STATUSES, TIPOS_DOCUMENTO, DemoGateway, Gateway
from .uploads import MAX_BYTES, ArquivoInvalido, validar_arquivo
from .security import RateLimiter, SecurityHeadersMiddleware
from .validators import is_valid_cpf, is_valid_email, only_digits

BASE = Path(__file__).parent
SLA_LABELS = {"atrasado": "Atrasado", "vencendo": "Vence em 24h", "no_prazo": "No prazo", "sem_sla": "-"}


def create_app(settings: Settings | None = None, gateway: Gateway | None = None) -> FastAPI:
    cfg = settings or load_settings()
    gw: Gateway = gateway or DemoGateway()  # TODO: HttpGateway(cfg.api_base_url) quando a API expor os endpoints
    limiter = RateLimiter(cfg.rate_limit_max, cfg.rate_limit_window_s)
    templates = Jinja2Templates(directory=str(BASE / "templates"))  # autoescape ligado por padrao

    app = FastAPI(title="KRONOS Web", docs_url=None, redoc_url=None)
    app.add_middleware(SecurityHeadersMiddleware)
    app.mount("/static", StaticFiles(directory=str(BASE / "static")), name="static")

    def render(request: Request, name: str, status_code: int = 200, **ctx) -> HTMLResponse:
        ctx.update(demo=cfg.demo_mode, labels=STATUS_LABELS, tipos=TIPOS_DOCUMENTO)
        return templates.TemplateResponse(request, name, ctx, status_code=status_code)

    @app.get("/health")
    def health():
        return {"status": "ok"}

    @app.get("/", response_class=HTMLResponse)
    @app.get("/vagas", response_class=HTMLResponse)
    def vagas(request: Request):
        return render(request, "vagas.html", vagas=gw.listar_vagas())

    @app.get("/vagas/{vaga_id}", response_class=HTMLResponse)
    def vaga(request: Request, vaga_id: str):
        v = gw.obter_vaga(vaga_id)
        if not v:
            raise HTTPException(404)
        return render(request, "vaga.html", vaga=v, erros={}, valores={})

    @app.post("/validar/cpf", response_class=HTMLResponse)
    def validar_cpf(request: Request, cpf: str = Form("", max_length=20)):
        ok = is_valid_cpf(cpf) if cpf else None
        return render(request, "_cpf_status.html", ok=ok)

    @app.post("/vagas/{vaga_id}/candidatar")
    def candidatar(
        request: Request,
        vaga_id: str,
        nome: str = Form("", max_length=120),
        email: str = Form("", max_length=320),
        cpf: str = Form("", max_length=20),
        consentimento: str = Form(""),
    ):
        v = gw.obter_vaga(vaga_id)
        if not v:
            raise HTTPException(404)
        ip = request.client.host if request.client else "?"
        if not limiter.allow(f"candidatura:{ip}"):
            raise HTTPException(429, "Muitas tentativas. Aguarde um minuto.")
        erros: dict[str, str] = {}
        if len(nome.strip()) < 3:
            erros["nome"] = "Informe seu nome completo."
        if not is_valid_email(email):
            erros["email"] = "E-mail invalido."
        if not is_valid_cpf(cpf):
            erros["cpf"] = "CPF invalido."
        if consentimento != "on":
            erros["consentimento"] = "E necessario aceitar o tratamento dos dados."
        if erros:
            valores = {"nome": nome, "email": email, "cpf": cpf}  # nunca reenvia o CPF em log
            return render(request, "vaga.html", status_code=422, vaga=v, erros=erros, valores=valores)
        c = gw.criar_chamado(vaga_id, nome.strip())
        _ = only_digits(cpf)  # seguiria para a API; o demo nao guarda dado pessoal alem do nome
        return RedirectResponse(f"/chamado/{c.protocolo}", status_code=303)

    @app.get("/chamado/{protocolo}", response_class=HTMLResponse)
    def chamado(request: Request, protocolo: str):
        c = gw.obter_chamado(protocolo)
        if not c:
            raise HTTPException(404)
        return render(request, "chamado.html", chamado=c, vaga=gw.obter_vaga(c.vaga_id), checklist=checklist_de(c), erro=None)

    @app.post("/chamado/{protocolo}/documentos", response_class=HTMLResponse)
    def enviar_documento(request: Request, protocolo: str, tipo: str = Form("", max_length=30), arquivo: UploadFile = File(...)):
        c = gw.obter_chamado(protocolo)
        if not c:
            raise HTTPException(404)
        ip = request.client.host if request.client else "?"
        if not limiter.allow(f"upload:{ip}"):
            raise HTTPException(429, "Muitas tentativas. Aguarde um minuto.")
        erro = None
        if tipo not in TIPOS_DOCUMENTO:
            erro = "Escolha o tipo do documento."
        else:
            try:
                validar_arquivo(arquivo.file.read(MAX_BYTES + 1))  # so valida; o demo guarda apenas os metadados
            except ArquivoInvalido as e:
                erro = str(e)
        if erro:
            return render(request, "chamado.html", status_code=422, chamado=c, vaga=gw.obter_vaga(c.vaga_id),
                          checklist=checklist_de(c), erro=erro)
        gw.enviar_documento(protocolo, tipo, "arquivo-enviado")  # nunca guarda/ecoa o nome enviado pelo usuario
        return RedirectResponse(f"/chamado/{protocolo}", status_code=303)

    def checklist_de(c) -> list[dict]:
        """Cada item do checklist mostra o status do ultimo envio daquele tipo."""
        itens = []
        for tipo in CHECKLIST:
            ultimo = next((d for d in reversed(c.documentos) if d.tipo == tipo), None)
            itens.append({"tipo": tipo, "doc": ultimo, "status": ultimo.status if ultimo else "FALTANDO"})
        return itens

    @app.get("/painel", response_class=HTMLResponse)
    def painel(request: Request):
        # Sem autenticacao ainda: so existe em modo demo. Em producao exige login + 2FA (modulo 01).
        if not cfg.demo_mode:
            raise HTTPException(404)
        colunas = {s: [] for s in STATUSES}
        for c in gw.listar_chamados():
            colunas[c.status].append(c)
        return render(request, "painel.html", colunas=colunas)

    def montar_fila(status: str, busca: str) -> dict:
        if status and status not in STATUS_LABELS:
            raise HTTPException(422, "Status invalido")
        itens = filtrar(gw.listar_chamados(), status, busca)
        return {"linhas": [(c, sla_situacao(c)) for c in itens], "sla_labels": SLA_LABELS,
                "status": status, "busca": busca}

    @app.get("/painel/fila", response_class=HTMLResponse)
    def fila(request: Request, status: str = Query("", max_length=30), busca: str = Query("", max_length=60)):
        if not cfg.demo_mode:  # mesma regra do /painel ate existir login + 2FA
            raise HTTPException(404)
        return render(request, "fila.html", **montar_fila(status, busca))

    @app.get("/painel/fila/tabela", response_class=HTMLResponse)
    def fila_tabela(request: Request, status: str = Query("", max_length=30), busca: str = Query("", max_length=60)):
        if not cfg.demo_mode:
            raise HTTPException(404)
        return render(request, "_fila_tabela.html", **montar_fila(status, busca))

    def so_demo() -> None:  # mesma regra do /painel ate existir login + 2FA
        if not cfg.demo_mode:
            raise HTTPException(404)

    def render_docs(request: Request, c, erro: str | None = None):
        return render(request, "_docs_rh.html", chamado=c, checklist=checklist_de(c), erro=erro)

    @app.get("/painel/chamado/{protocolo}", response_class=HTMLResponse)
    def painel_chamado(request: Request, protocolo: str):
        so_demo()
        c = gw.obter_chamado(protocolo)
        if not c:
            raise HTTPException(404)
        return render(request, "painel_chamado.html", chamado=c, vaga=gw.obter_vaga(c.vaga_id), checklist=checklist_de(c),
                      erro=None, acao=ACAO_AVANCAR.get(c.status), sla=sla_situacao(c), sla_labels=SLA_LABELS)

    @app.post("/painel/documentos/{doc_id}/decisao", response_class=HTMLResponse)
    def decidir_documento(request: Request, doc_id: str, acao: str = Form("", max_length=10), motivo: str = Form("", max_length=500)):
        so_demo()
        achado = gw.obter_documento(doc_id)
        if not achado:
            raise HTTPException(404)
        c, d = achado
        if acao not in ("aprovar", "recusar"):
            raise HTTPException(422, "Acao invalida")
        if acao == "recusar" and len(motivo.strip()) < 3:
            return render_docs(request, c, "Informe o motivo da recusa (minimo 3 caracteres).")
        if gw.decidir_documento(doc_id, acao == "aprovar", motivo) is None:
            return render_docs(request, c, "Este documento ja foi decidido.")
        return render_docs(request, c)

    @app.post("/painel/chamado/{protocolo}/avancar")
    def avancar(protocolo: str):
        so_demo()
        if gw.avancar(protocolo) is None:
            raise HTTPException(409, "Este chamado nao pode avancar")
        return RedirectResponse(f"/painel/chamado/{protocolo}", status_code=303)

    return app


app = create_app()
