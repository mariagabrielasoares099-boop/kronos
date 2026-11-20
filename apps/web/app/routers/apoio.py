"""Base de conhecimento (RAG, ingestao, MCP) e painel de uso/custos do RH. Mesma autorizacao das telas da equipe."""
import json
from pathlib import Path
import hmac
from typing import Literal
from urllib.parse import urlsplit

from fastapi import APIRouter, Form, HTTPException, Query, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import HTMLResponse, JSONResponse, Response

from ..security import RateLimiter
from ..services.mcp import FERRAMENTAS, Servidor
from ..services.rag import PADRAO_PASTA, responder

CONFIG_MCP = {"mcpServers": {"kronos": {"command": "python", "args": ["apps/web/mcp_kronos.py"], "env": {}}}}
MCP_MAX_BYTES = 64 * 1024
MCP_MAX_LOTE = 20


def _ferramentas_mcp() -> list[dict]:
    return [{"nome": f["name"], "descricao": f["description"]} for f in FERRAMENTAS]


def _tratar(servidor: Servidor, msg):
    if not isinstance(msg, dict):
        return Servidor._erro(None, -32600, "Requisição inválida")
    return servidor.tratar(msg)


def mount_apoio(app, *, render, token_equipe, base, ollama, medidor, limiter, pasta: Path | None = None,
                gateway=None, mcp_ativo: bool = False, mcp_token: str = "", autorizado=lambda r: True):
    router = APIRouter(prefix="/rh")
    pasta = Path(pasta) if pasta else PADRAO_PASTA

    def pagina(request: Request, aba: str, status_code: int = 200, **extra):
        ctx = dict(aba=aba, pergunta="", resultado=None, erro=None, ingestao=None, contagem=base.contagem())
        if aba == "ingestao":
            ctx.update(fontes=base.fontes(), pasta_nome=f"{pasta.parent.name}/{pasta.name}", pasta_existe=pasta.is_dir(),
                       ollama_ok=ollama.disponivel() if ollama else False)
        if aba == "mcp":
            ctx.update(ferramentas=_ferramentas_mcp(), config_mcp=json.dumps(CONFIG_MCP, indent=2),
                       mcp_http=mcp_ativo, url_mcp=str(request.base_url) + "mcp", mcp_token_exigido=bool(mcp_token))
        ctx.update(extra)
        return render(request, "hr/conhecimento.html", status_code=status_code, **ctx)

    @router.get("/conhecimento", response_class=HTMLResponse)
    def conhecimento(request: Request, aba: Literal["perguntar", "ingestao", "mcp"] = Query("perguntar")):
        token_equipe(request)
        return pagina(request, aba)

    @router.post("/conhecimento", response_class=HTMLResponse)
    async def perguntar(request: Request, pergunta: str = Form("", max_length=500)):
        token_equipe(request)
        ip = request.client.host if request.client else "?"
        if not limiter.allow(f"rag:{ip}"):
            raise HTTPException(429, "Muitas tentativas. Aguarde um minuto.")
        if len(pergunta.strip()) < 3:
            return pagina(request, "perguntar", 422, pergunta=pergunta,
                          erro="Escreva uma pergunta com pelo menos 3 caracteres.")
        resultado = await run_in_threadpool(responder, base, pergunta, ollama, 4, medidor)
        return pagina(request, "perguntar", pergunta=pergunta, resultado=resultado)

    @router.post("/conhecimento/ingerir", response_class=HTMLResponse)
    async def ingerir(request: Request):
        token_equipe(request)
        ip = request.client.host if request.client else "?"
        if not limiter.allow(f"rag-ingest:{ip}"):
            raise HTTPException(429, "Muitas tentativas. Aguarde um minuto.")
        usar = ollama if ollama is not None and await run_in_threadpool(ollama.disponivel) else None
        resultado = await run_in_threadpool(base.ingerir_pasta, pasta, usar)
        return pagina(request, "ingestao", ingestao=resultado)

    # ---- MCP por HTTP (JSON-RPC 2.0 em POST /mcp): o mesmo nucleo do stdio, dentro do servidor web ----
    limite_mcp = RateLimiter(120, 60)  # uma sessao MCP faz varias chamadas; limite proprio, mais folgado
    servidor_mcp = Servidor(gateway=gateway, base=base, medidor=medidor, ollama=ollama) if mcp_ativo else None

    def erro_mcp(status: int, codigo: int, msg: str, **cab):
        return JSONResponse({"jsonrpc": "2.0", "id": None, "error": {"code": codigo, "message": msg}}, status, headers=cab)

    @app.post("/mcp", include_in_schema=False)
    async def mcp_http(request: Request):
        if servidor_mcp is None:
            raise HTTPException(404, "MCP por HTTP so existe no modo demonstracao.")
        # Anti DNS-rebinding: navegador de outro site manda Origin diferente do Host.
        origem = request.headers.get("origin")
        if origem and urlsplit(origem).netloc != request.headers.get("host", ""):
            return erro_mcp(403, -32600, "Origem não permitida")
        enviado = request.headers.get("authorization", "")
        com_token = bool(mcp_token) and enviado.startswith("Bearer ") and hmac.compare_digest(enviado[7:].strip(), mcp_token)
        if not com_token and not autorizado(request):
            return erro_mcp(401, -32001, "Não autorizado: use Authorization: Bearer <MCP_TOKEN> ou entre em /login",
                            **{"WWW-Authenticate": "Bearer"})
        ip = request.client.host if request.client else "?"
        if not limite_mcp.allow(f"mcp:{ip}"):
            return erro_mcp(429, -32000, "Muitas requisições. Aguarde um minuto.")
        bruto = await request.body()
        if len(bruto) > MCP_MAX_BYTES:
            return erro_mcp(413, -32600, "Requisição grande demais")
        try:
            msg = json.loads(bruto)
        except (json.JSONDecodeError, UnicodeDecodeError):
            return erro_mcp(400, -32700, "JSON inválido")
        if isinstance(msg, list):
            if not msg or len(msg) > MCP_MAX_LOTE:
                return erro_mcp(400, -32600, f"Lote deve ter de 1 a {MCP_MAX_LOTE} mensagens")
            respostas = [r for m in msg if (r := await run_in_threadpool(_tratar, servidor_mcp, m)) is not None]
            return JSONResponse(respostas) if respostas else Response(status_code=202)
        resposta = await run_in_threadpool(_tratar, servidor_mcp, msg)
        return JSONResponse(resposta) if resposta is not None else Response(status_code=202)

    @app.get("/mcp", include_in_schema=False)
    def mcp_get():
        # Streamable HTTP: este servidor nao abre fluxo SSE; so responde a POST.
        return Response(status_code=405, headers={"Allow": "POST"})

    @router.get("/gastos", response_class=HTMLResponse)
    def gastos(request: Request):
        token_equipe(request)
        return render(request, "hr/gastos.html", uso=medidor.resumo())

    app.include_router(router)
