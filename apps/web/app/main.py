from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from .arquivos import TAMANHO_MAXIMO_BYTES, ArquivoInvalido, validar_arquivo
from .config import Settings, load_settings
from .gateway import CHECKLIST, STATUS_LABELS, STATUSES, DemoGateway, Gateway
from .security import RateLimiter, SecurityHeadersMiddleware
from .validators import is_valid_cpf, is_valid_email, only_digits

BASE = Path(__file__).parent


def create_app(settings: Settings | None = None, gateway: Gateway | None = None) -> FastAPI:
    cfg = settings or load_settings()
    gw: Gateway = gateway or DemoGateway()  # TODO: HttpGateway(cfg.api_base_url) quando a API expor os endpoints
    limiter = RateLimiter(cfg.rate_limit_max, cfg.rate_limit_window_s)
    templates = Jinja2Templates(directory=str(BASE / "templates"))  # autoescape ligado por padrao

    app = FastAPI(title="KRONOS Web", docs_url=None, redoc_url=None)
    app.add_middleware(SecurityHeadersMiddleware)
    app.mount("/static", StaticFiles(directory=str(BASE / "static")), name="static")

    def render(request: Request, name: str, status_code: int = 200, **ctx) -> HTMLResponse:
        ctx.update(demo=cfg.demo_mode, labels=STATUS_LABELS)
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
        return render_chamado(request, c)

    def render_chamado(request: Request, c, status_code: int = 200, erro: str | None = None):
        docs = gw.listar_documentos(c.protocolo)
        itens = []
        for tipo, rotulo in CHECKLIST.items():
            ultimo = next((d for d in reversed(docs) if d.tipo == tipo), None)
            itens.append({"tipo": tipo, "rotulo": rotulo, "doc": ultimo})
        return render(request, "chamado.html", status_code=status_code, chamado=c,
                      vaga=gw.obter_vaga(c.vaga_id), checklist=itens, erro_upload=erro)

    @app.post("/chamado/{protocolo}/documentos")
    async def enviar_documento(
        request: Request,
        protocolo: str,
        tipo: str = Form("", max_length=40),
        arquivo: UploadFile = File(None),
    ):
        c = gw.obter_chamado(protocolo)
        if not c:
            raise HTTPException(404)
        ip = request.client.host if request.client else "?"
        if not limiter.allow(f"upload:{ip}"):
            raise HTTPException(429, "Muitas tentativas. Aguarde um minuto.")
        try:
            if tipo not in CHECKLIST:
                raise ArquivoInvalido("Escolha o tipo do documento.")
            if arquivo is None:
                raise ArquivoInvalido("Selecione um arquivo.")
            conteudo = await arquivo.read(TAMANHO_MAXIMO_BYTES + 1)  # nunca le alem do teto
            mime = validar_arquivo(conteudo)
        except ArquivoInvalido as e:
            return render_chamado(request, c, status_code=e.status_code, erro=str(e))
        gw.enviar_documento(protocolo, tipo, mime, len(conteudo))
        return RedirectResponse(f"/chamado/{protocolo}", status_code=303)

    @app.get("/painel", response_class=HTMLResponse)
    def painel(request: Request):
        # Sem autenticacao ainda: so existe em modo demo. Em producao exige login + 2FA (modulo 01).
        if not cfg.demo_mode:
            raise HTTPException(404)
        colunas = {s: [] for s in STATUSES}
        for c in gw.listar_chamados():
            colunas[c.status].append(c)
        return render(request, "painel.html", colunas=colunas)

    return app


app = create_app()
