import re
import time
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from .api_client import ApiClient, ApiIndisponivel
from .arquivos import TAMANHO_MAXIMO_BYTES, ArquivoInvalido, validar_arquivo
from .config import Settings, load_settings
from .gateway import CHECKLIST, STATUS_LABELS, STATUSES, Chamado, DemoGateway, Documento, Gateway
from .security import RateLimiter, SecurityHeadersMiddleware
from .validators import is_valid_cpf, is_valid_email, only_digits

BASE = Path(__file__).parent
COOKIE_SESSAO = "kronos_portal"
PROTOCOLO_RE = re.compile(r"^ADM-\d{4}-\d{6}$")


def create_app(
    settings: Settings | None = None, gateway: Gateway | None = None, api: ApiClient | None = None
) -> FastAPI:
    cfg = settings or load_settings()
    gw: Gateway = gateway or DemoGateway()  # vagas/candidatura/painel ainda so no demo
    # Fora do demo, o chamado e os documentos do candidato vem da API real (token do candidato no cookie).
    portal_api: ApiClient | None = api or (None if cfg.demo_mode else ApiClient(cfg.api_base_url))
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

    def render_chamado(request: Request, c, itens, vaga, status_code: int = 200, erro: str | None = None):
        return render(request, "chamado.html", status_code=status_code, chamado=c, vaga=vaga,
                      checklist=itens, erro_upload=erro)

    def itens_demo(protocolo: str):
        docs = gw.listar_documentos(protocolo)
        return [
            {"tipo": tipo, "rotulo": rotulo, "doc": next((d for d in reversed(docs) if d.tipo == tipo), None)}
            for tipo, rotulo in CHECKLIST.items()
        ]

    def itens_api(docs: dict):
        por_tipo: dict[str, Documento] = {}
        for d in docs.get("documentos", []):  # em ordem de envio: o ultimo de cada tipo vale
            por_tipo[d["tipo"]] = Documento(d["tipo"], d["mime"], d["tamanhoBytes"], d["status"], d.get("motivo"))
        return [{"tipo": t, "rotulo": r, "doc": por_tipo.get(t)} for t, r in CHECKLIST.items()]

    def pagina_entrar(request: Request, protocolo: str, erro: str | None = None, status_code: int = 200,
                      limpar: bool = False):
        resp = render(request, "entrar.html", status_code=status_code, protocolo=protocolo, erro=erro)
        if limpar:
            resp.delete_cookie(COOKIE_SESSAO, path="/chamado")
        return resp

    def pagina_chamado_api(request: Request, protocolo: str, token: str, status_code: int = 200,
                           erro: str | None = None):
        assert portal_api is not None
        try:
            ch = portal_api.obter_chamado(protocolo, token)
            docs = portal_api.listar_documentos(ch["id"], token) if ch else None
        except ApiIndisponivel:
            raise HTTPException(502, "Servico indisponivel. Tente novamente em instantes.")
        if ch is None or docs is None:
            # Token expirado ou chamado de outra pessoa: mesma resposta, sem distinguir.
            return pagina_entrar(request, protocolo, "Sua sessao expirou. Informe o CPF novamente.", 401, limpar=True)
        c = Chamado(ch["protocolo"], ch["jobId"], "", ch["status"])
        return render_chamado(request, c, itens_api(docs), None, status_code, erro)

    @app.get("/chamado/{protocolo}", response_class=HTMLResponse)
    def chamado(request: Request, protocolo: str):
        if portal_api is None:
            c = gw.obter_chamado(protocolo)
            if not c:
                raise HTTPException(404)
            return render_chamado(request, c, itens_demo(c.protocolo), gw.obter_vaga(c.vaga_id))
        if not PROTOCOLO_RE.match(protocolo):
            raise HTTPException(404)
        token = request.cookies.get(COOKIE_SESSAO)
        if not token:
            return pagina_entrar(request, protocolo)
        return pagina_chamado_api(request, protocolo, token)

    @app.post("/chamado/{protocolo}/entrar")
    def entrar(request: Request, protocolo: str, cpf: str = Form("", max_length=20)):
        if portal_api is None or not PROTOCOLO_RE.match(protocolo):
            raise HTTPException(404)
        ip = request.client.host if request.client else "?"
        if not limiter.allow(f"entrar:{ip}"):
            raise HTTPException(429, "Muitas tentativas. Aguarde um minuto.")
        if not is_valid_cpf(cpf):
            return pagina_entrar(request, protocolo, "CPF invalido.", 422)
        try:
            sessao = portal_api.entrar(protocolo, only_digits(cpf))
        except ArquivoInvalido as e:  # a API limitou as tentativas (429)
            return pagina_entrar(request, protocolo, str(e), e.status_code)
        except ApiIndisponivel:
            raise HTTPException(502, "Servico indisponivel. Tente novamente em instantes.")
        if sessao is None:
            return pagina_entrar(request, protocolo, "Protocolo ou CPF incorreto.", 401)
        resp = RedirectResponse(f"/chamado/{protocolo}", status_code=303)
        resp.set_cookie(
            COOKIE_SESSAO, sessao.token, max_age=max(sessao.expira_em - int(time.time()), 0),
            httponly=True, samesite="lax", secure=request.url.scheme == "https", path="/chamado",
        )
        return resp

    @app.post("/chamado/{protocolo}/documentos")
    async def enviar_documento(
        request: Request,
        protocolo: str,
        tipo: str = Form("", max_length=40),
        arquivo: UploadFile = File(None),
    ):
        token = request.cookies.get(COOKIE_SESSAO)
        if portal_api is None:
            c = gw.obter_chamado(protocolo)
            if not c:
                raise HTTPException(404)
        else:
            if not PROTOCOLO_RE.match(protocolo):
                raise HTTPException(404)
            if not token:
                raise HTTPException(401, "Informe o CPF para enviar documentos.")
        ip = request.client.host if request.client else "?"
        if not limiter.allow(f"upload:{ip}"):
            raise HTTPException(429, "Muitas tentativas. Aguarde um minuto.")

        async def mostrar(status_code: int, erro: str):
            if portal_api is None:
                return render_chamado(request, c, itens_demo(protocolo), gw.obter_vaga(c.vaga_id), status_code, erro)
            return await run_in_threadpool(pagina_chamado_api, request, protocolo, token, status_code, erro)

        try:
            if tipo not in CHECKLIST:
                raise ArquivoInvalido("Escolha o tipo do documento.")
            if arquivo is None:
                raise ArquivoInvalido("Selecione um arquivo.")
            conteudo = await arquivo.read(TAMANHO_MAXIMO_BYTES + 1)  # nunca le alem do teto
            mime = validar_arquivo(conteudo)
        except ArquivoInvalido as e:
            return await mostrar(e.status_code, str(e))

        if portal_api is None:
            gw.enviar_documento(protocolo, tipo, mime, len(conteudo))
        else:
            try:
                ch = await run_in_threadpool(portal_api.obter_chamado, protocolo, token)
                gravado = bool(ch) and await run_in_threadpool(
                    portal_api.enviar_documento, ch["id"], tipo, conteudo, mime, token
                )
            except ArquivoInvalido as e:
                return await mostrar(e.status_code, str(e))
            except ApiIndisponivel:
                raise HTTPException(502, "Servico indisponivel. Tente novamente em instantes.")
            if not gravado:
                return pagina_entrar(request, protocolo, "Sua sessao expirou. Informe o CPF novamente.", 401, limpar=True)
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
