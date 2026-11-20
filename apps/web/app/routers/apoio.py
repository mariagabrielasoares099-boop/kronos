"""Base de conhecimento (RAG, ingestao, MCP) e painel de uso/custos do RH. Mesma autorizacao das telas da equipe."""
import json
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Form, HTTPException, Query, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import HTMLResponse

from ..services.rag import PADRAO_PASTA, responder

CONFIG_MCP = {"mcpServers": {"kronos": {"command": "python", "args": ["apps/web/mcp_kronos.py"], "env": {}}}}


def _ferramentas_mcp() -> list[dict]:
    """Lista as ferramentas do servidor MCP (fonte unica: mcp_kronos.py, na pasta apps/web)."""
    try:
        from mcp_kronos import FERRAMENTAS
    except ImportError:  # app iniciado fora de apps/web
        return []
    return [{"nome": f["name"], "descricao": f["description"]} for f in FERRAMENTAS]


def mount_apoio(app, *, render, token_equipe, base, ollama, medidor, limiter, pasta: Path | None = None):
    router = APIRouter(prefix="/rh")
    pasta = Path(pasta) if pasta else PADRAO_PASTA

    def pagina(request: Request, aba: str, status_code: int = 200, **extra):
        ctx = dict(aba=aba, pergunta="", resultado=None, erro=None, ingestao=None, contagem=base.contagem())
        if aba == "ingestao":
            ctx.update(fontes=base.fontes(), pasta_nome=f"{pasta.parent.name}/{pasta.name}", pasta_existe=pasta.is_dir(),
                       ollama_ok=ollama.disponivel() if ollama else False)
        if aba == "mcp":
            ctx.update(ferramentas=_ferramentas_mcp(), config_mcp=json.dumps(CONFIG_MCP, indent=2))
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

    @router.get("/gastos", response_class=HTMLResponse)
    def gastos(request: Request):
        token_equipe(request)
        return render(request, "hr/gastos.html", uso=medidor.resumo())

    app.include_router(router)
