import re
import time
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from .api_client import (
    ApiClient, ApiIndisponivel, Conflito, LoginRecusado, SemPermissao, SessaoExpirada,
)
from .arquivos import TAMANHO_MAXIMO_BYTES, ArquivoInvalido, validar_arquivo
from .config import Settings, load_settings
from .fila import filtrar, sla_situacao
from .gateway import (
    ACAO_AVANCAR, CHECKLIST, STATUS_LABELS, STATUSES, TIPOS_DOCUMENTO, Chamado, DemoGateway,
    Documento, Gateway,
)
from .security import RateLimiter, SecurityHeadersMiddleware
from .validators import is_valid_cpf, is_valid_email, only_digits

BASE = Path(__file__).parent
COOKIE_SESSAO = "kronos_portal"
COOKIE_EQUIPE = "kronos_equipe"
DOC_ID_RE = re.compile(r"^[0-9a-fA-F-]{36}$")
PROTOCOLO_RE = re.compile(r"^ADM-\d{4}-\d{6}$")
CODIGO_RE = re.compile(r"^[A-Za-z0-9_-]{43}$")  # 32 bytes em base64url (formato do codigo emitido pela API)
SLA_LABELS = {"atrasado": "Atrasado", "vencendo": "Vence em 24h", "no_prazo": "No prazo", "sem_sla": "-"}


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
        if not cfg.demo_mode:
            raise HTTPException(503, "Candidatura indisponivel: integracao com a API ainda nao implementada.")
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
                      checklist=itens, erro=erro)

    def itens_de(docs: list[Documento]) -> list[dict]:
        """Cada item do checklist mostra o status do ultimo envio daquele tipo (em ordem de envio)."""
        itens = []
        for tipo in CHECKLIST:
            ultimo = next((d for d in reversed(docs) if d.tipo == tipo), None)
            itens.append({"tipo": tipo, "doc": ultimo, "status": ultimo.status if ultimo else "FALTANDO"})
        return itens

    def checklist_de(c) -> list[dict]:
        return itens_de(c.documentos)

    def itens_demo(c) -> list[dict]:
        return checklist_de(c)

    def itens_api(docs: dict) -> list[dict]:
        return itens_de([
            Documento(d["id"], d["tipo"], "", d["status"], d.get("motivo")) for d in docs.get("documentos", [])
        ])

    def pagina_entrar(request: Request, protocolo: str, erro: str | None = None, status_code: int = 200,
                      limpar: bool = False, enviado: bool = False):
        resp = render(request, "entrar.html", status_code=status_code, protocolo=protocolo, erro=erro, enviado=enviado)
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
            return pagina_entrar(request, protocolo, "Sua sessao expirou. Peca um novo link de acesso.", 401, limpar=True)
        c = Chamado(ch["protocolo"], ch["jobId"], "", ch["status"])
        return render_chamado(request, c, itens_api(docs), None, status_code, erro)

    @app.get("/chamado/{protocolo}", response_class=HTMLResponse)
    def chamado(request: Request, protocolo: str):
        if portal_api is None:
            c = gw.obter_chamado(protocolo)
            if not c:
                raise HTTPException(404)
            return render_chamado(request, c, itens_demo(c), gw.obter_vaga(c.vaga_id))
        if not PROTOCOLO_RE.match(protocolo):
            raise HTTPException(404)
        token = request.cookies.get(COOKIE_SESSAO)
        if not token:
            return pagina_entrar(request, protocolo)
        return pagina_chamado_api(request, protocolo, token)

    @app.post("/chamado/{protocolo}/link", response_class=HTMLResponse)
    def pedir_link(request: Request, protocolo: str, cpf: str = Form("", max_length=20)):
        """Protocolo + CPF so servem para PEDIR o link por e-mail; a resposta e a mesma acertando ou errando."""
        if portal_api is None or not PROTOCOLO_RE.match(protocolo):
            raise HTTPException(404)
        ip = request.client.host if request.client else "?"
        if not limiter.allow(f"link:{ip}"):
            raise HTTPException(429, "Muitas tentativas. Aguarde um minuto.")
        if not is_valid_cpf(cpf):
            return pagina_entrar(request, protocolo, "CPF invalido.", 422)
        try:
            portal_api.solicitar_link(protocolo, only_digits(cpf))
        except ArquivoInvalido as e:  # a API limitou os pedidos (429)
            return pagina_entrar(request, protocolo, str(e), e.status_code)
        except ApiIndisponivel:
            raise HTTPException(502, "Servico indisponivel. Tente novamente em instantes.")
        return pagina_entrar(request, protocolo, enviado=True)

    @app.get("/chamado/{protocolo}/acesso/{codigo}", response_class=HTMLResponse)
    def acesso(request: Request, protocolo: str, codigo: str):
        """Abre so a pagina de confirmacao: o codigo nao e gasto aqui (leitores de e-mail pre-abrem links)."""
        if portal_api is None or not PROTOCOLO_RE.match(protocolo) or not CODIGO_RE.match(codigo):
            raise HTTPException(404)
        resp = render(request, "acesso.html", protocolo=protocolo, codigo=codigo)
        resp.headers["Cache-Control"] = "no-store"
        return resp

    @app.post("/chamado/{protocolo}/acesso/{codigo}")
    def entrar(request: Request, protocolo: str, codigo: str):
        if portal_api is None or not PROTOCOLO_RE.match(protocolo) or not CODIGO_RE.match(codigo):
            raise HTTPException(404)
        ip = request.client.host if request.client else "?"
        if not limiter.allow(f"entrar:{ip}"):
            raise HTTPException(429, "Muitas tentativas. Aguarde um minuto.")
        try:
            sessao = portal_api.entrar(codigo)
        except ArquivoInvalido as e:  # a API limitou as tentativas (429)
            return pagina_entrar(request, protocolo, str(e), e.status_code)
        except ApiIndisponivel:
            raise HTTPException(502, "Servico indisponivel. Tente novamente em instantes.")
        if sessao is None:
            return pagina_entrar(request, protocolo, "Link invalido, vencido ou ja usado. Peca um novo link.", 401)
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
                return render_chamado(request, c, itens_demo(c), gw.obter_vaga(c.vaga_id), status_code, erro)
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
            gw.enviar_documento(protocolo, tipo, "arquivo-enviado")  # o demo nunca guarda nem repete o nome enviado
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
                return pagina_entrar(request, protocolo, "Sua sessao expirou. Peca um novo link de acesso.", 401, limpar=True)
        return RedirectResponse(f"/chamado/{protocolo}", status_code=303)

    # --- Login da equipe (fora do demo): senha + 2FA na API; o token fica so em cookie HttpOnly ---
    def pagina_login(request: Request, email: str = "", erro: str | None = None, pede_2fa: bool = False,
                     status_code: int = 200):
        resp = render(request, "login.html", status_code=status_code, email=email, erro=erro, pede_2fa=pede_2fa)
        resp.headers["Cache-Control"] = "no-store"
        return resp

    @app.get("/login", response_class=HTMLResponse)
    def login_form(request: Request):
        if portal_api is None:
            raise HTTPException(404)
        return pagina_login(request)

    @app.post("/login", response_class=HTMLResponse)
    def login(request: Request, email: str = Form("", max_length=320), senha: str = Form("", max_length=200),
              codigo: str = Form("", max_length=10)):
        if portal_api is None:
            raise HTTPException(404)
        ip = request.client.host if request.client else "?"
        if not limiter.allow(f"login:{ip}"):
            raise HTTPException(429, "Muitas tentativas. Aguarde um minuto.")
        email = email.strip()
        if not is_valid_email(email) or not senha:
            return pagina_login(request, email, "Informe e-mail e senha.", status_code=422)
        try:
            sessao = portal_api.login_equipe(email, senha, codigo.strip())
        except LoginRecusado as e:
            if e.motivo == "codigo_2fa":
                aviso = "Codigo invalido." if codigo.strip() else "Informe o codigo do aplicativo autenticador."
                return pagina_login(request, email, aviso, pede_2fa=True, status_code=401)
            if e.motivo == "bloqueado":
                return pagina_login(request, email, "Muitas tentativas. Aguarde alguns minutos.", status_code=429)
            if e.motivo == "sem_2fa":
                return pagina_login(request, email, "Sua conta ainda nao tem 2FA configurado. Fale com o administrador.",
                                    status_code=403)
            # Generico: nao revela se o e-mail existe nem se o codigo ou a senha falhou.
            return pagina_login(request, email, "E-mail, senha ou codigo incorretos.", pede_2fa=bool(codigo.strip()),
                                status_code=401)
        except ApiIndisponivel:
            raise HTTPException(502, "Servico indisponivel. Tente novamente em instantes.")
        resp = RedirectResponse("/painel", status_code=303)
        resp.set_cookie(
            COOKIE_EQUIPE, sessao.token, max_age=max(sessao.expira_em - int(time.time()), 0),
            httponly=True, samesite="lax", secure=request.url.scheme == "https", path="/",
        )
        return resp

    @app.post("/sair")
    def sair():
        resp = RedirectResponse("/login" if portal_api is not None else "/", status_code=303)
        resp.delete_cookie(COOKIE_EQUIPE, path="/")
        return resp

    def sessao_equipe(request: Request) -> str | None:
        return request.cookies.get(COOKIE_EQUIPE)

    # --- Painel do RH: demo (em memoria) ou API real (sessao da equipe) ---
    class _Login(Exception):
        """Sem sessao valida da equipe: vira redirecionamento para /login."""

    @app.exception_handler(_Login)
    def _para_login(request: Request, exc: _Login):
        if request.headers.get("hx-request"):  # HTMX nao segue 303 para a pagina inteira: manda o navegador la
            resp = HTMLResponse(status_code=200, headers={"HX-Redirect": "/login"})
        else:
            resp = RedirectResponse("/login", status_code=303)
        resp.delete_cookie(COOKIE_EQUIPE, path="/")
        return resp

    def token_equipe(request: Request) -> str | None:
        """Demo: sem token (nao ha login). API: exige o cookie da equipe, senao vai para /login."""
        if cfg.demo_mode:
            return None
        token = sessao_equipe(request)
        if portal_api is None or not token:
            raise _Login()
        return token

    def chamar_equipe(fn, *args):
        """Chama a API como a equipe; 401 = sessao vencida, 403 = papel sem permissao, 502 = API fora."""
        try:
            return fn(*args)
        except SessaoExpirada:
            raise _Login()
        except SemPermissao:
            raise HTTPException(403, "Seu papel nao permite esta acao.")
        except ApiIndisponivel:
            raise HTTPException(502, "Servico indisponivel. Tente novamente em instantes.")

    def chamado_de_api(dados: dict) -> Chamado:
        r = dados["resumo"]
        prazo = datetime.fromisoformat(r["prazoSla"].replace("Z", "+00:00")) if r.get("prazoSla") else None
        historico = [(e["para"], e["motivo"] or "") for e in dados.get("eventos", []) if e.get("para")]
        docs = [Documento(d["id"], d["tipo"], "", d["status"], d.get("motivo")) for d in dados.get("documentos", [])]
        return Chamado(r["protocolo"], "", r.get("candidatoNome") or "-", r["status"], historico,
                       r.get("responsavelNome"), prazo, docs)

    @app.get("/painel", response_class=HTMLResponse)
    def painel(request: Request):
        if not cfg.demo_mode:
            token_equipe(request)
            return RedirectResponse("/painel/fila", status_code=303)
        colunas = {s: [] for s in STATUSES}
        for c in gw.listar_chamados():
            colunas[c.status].append(c)
        return render(request, "painel.html", colunas=colunas)

    def montar_fila(request: Request, status: str, busca: str) -> dict:
        if status and status not in STATUS_LABELS:
            raise HTTPException(422, "Status invalido")
        token = token_equipe(request)
        if token is None:
            itens = filtrar(gw.listar_chamados(), status, busca)
        else:  # a API ja filtra e ordena por SLA (e o RLS decide o que a pessoa enxerga)
            linhas = chamar_equipe(portal_api.equipe_listar, token, status, busca)
            itens = [chamado_de_api({"resumo": r}) for r in linhas]
        return {"linhas": [(c, sla_situacao(c)) for c in itens], "sla_labels": SLA_LABELS,
                "status": status, "busca": busca}

    @app.get("/painel/fila", response_class=HTMLResponse)
    def fila(request: Request, status: str = Query("", max_length=30), busca: str = Query("", max_length=60)):
        return render(request, "fila.html", **montar_fila(request, status, busca))

    @app.get("/painel/fila/tabela", response_class=HTMLResponse)
    def fila_tabela(request: Request, status: str = Query("", max_length=30), busca: str = Query("", max_length=60)):
        return render(request, "_fila_tabela.html", **montar_fila(request, status, busca))

    def render_docs(request: Request, c, erro: str | None = None):
        return render(request, "_docs_rh.html", chamado=c, checklist=checklist_de(c), erro=erro)

    def carregar_chamado(token: str | None, protocolo: str) -> Chamado:
        if token is None:
            c = gw.obter_chamado(protocolo)
        else:
            if not PROTOCOLO_RE.match(protocolo):
                raise HTTPException(404)
            dados = chamar_equipe(portal_api.equipe_chamado, protocolo, token)
            c = chamado_de_api(dados) if dados else None
        if not c:
            raise HTTPException(404)
        return c

    @app.get("/painel/chamado/{protocolo}", response_class=HTMLResponse)
    def painel_chamado(request: Request, protocolo: str):
        token = token_equipe(request)
        c = carregar_chamado(token, protocolo)
        vaga = gw.obter_vaga(c.vaga_id) if token is None else None
        return render(request, "painel_chamado.html", chamado=c, vaga=vaga, checklist=checklist_de(c),
                      erro=None, acao=ACAO_AVANCAR.get(c.status), sla=sla_situacao(c), sla_labels=SLA_LABELS)

    @app.post("/painel/documentos/{doc_id}/decisao", response_class=HTMLResponse)
    def decidir_documento(request: Request, doc_id: str, acao: str = Form("", max_length=10),
                          motivo: str = Form("", max_length=500), protocolo: str = Form("", max_length=20)):
        token = token_equipe(request)
        if acao not in ("aprovar", "recusar"):
            raise HTTPException(422, "Acao invalida")
        if token is None:
            achado = gw.obter_documento(doc_id)
            if not achado:
                raise HTTPException(404)
            c, _ = achado
        else:
            if not DOC_ID_RE.match(doc_id):
                raise HTTPException(404)
            c = carregar_chamado(token, protocolo)
            if not any(d.id == doc_id for d in c.documentos):
                raise HTTPException(404)  # o documento tem de ser deste chamado
        if acao == "recusar" and len(motivo.strip()) < 3:
            return render_docs(request, c, "Informe o motivo da recusa (minimo 3 caracteres).")
        if token is None:
            if gw.decidir_documento(doc_id, acao == "aprovar", motivo) is None:
                return render_docs(request, c, "Este documento ja foi decidido.")
            return render_docs(request, c)
        erro = None
        try:
            if not chamar_equipe(portal_api.decidir_documento, doc_id, acao == "aprovar", motivo, token):
                raise HTTPException(404)
        except Conflito:
            erro = "Este documento ja foi decidido."
        return render_docs(request, carregar_chamado(token, protocolo), erro)  # estado novo vem da API

    @app.post("/painel/chamado/{protocolo}/avancar")
    def avancar(request: Request, protocolo: str):
        token = token_equipe(request)
        if token is None:
            if gw.avancar(protocolo) is None:
                raise HTTPException(409, "Este chamado nao pode avancar")
        else:
            if not PROTOCOLO_RE.match(protocolo):
                raise HTTPException(404)
            dados = chamar_equipe(portal_api.equipe_chamado, protocolo, token)
            if not dados:
                raise HTTPException(404)
            try:
                ok = chamar_equipe(portal_api.avancar, dados["resumo"]["id"], token)
            except Conflito:
                raise HTTPException(409, "Este chamado nao pode avancar")
            if not ok:
                raise HTTPException(404)
        return RedirectResponse(f"/painel/chamado/{protocolo}", status_code=303)

    return app


app = create_app()
