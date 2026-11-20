"""Base de conhecimento (RAG) e painel de uso/custos do RH. Mesma autorizacao das demais telas da equipe."""
from fastapi import APIRouter, Form, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import HTMLResponse

from ..services.rag import responder


def mount_apoio(app, *, render, token_equipe, base, ollama, medidor, limiter):
    router = APIRouter(prefix="/rh")

    @router.get("/conhecimento", response_class=HTMLResponse)
    def conhecimento(request: Request):
        token_equipe(request)
        return render(request, "hr/conhecimento.html", pergunta="", resultado=None, contagem=base.contagem())

    @router.post("/conhecimento", response_class=HTMLResponse)
    async def perguntar(request: Request, pergunta: str = Form("", max_length=500)):
        token_equipe(request)
        ip = request.client.host if request.client else "?"
        if not limiter.allow(f"rag:{ip}"):
            raise HTTPException(429, "Muitas tentativas. Aguarde um minuto.")
        if len(pergunta.strip()) < 3:
            return render(request, "hr/conhecimento.html", status_code=422, pergunta=pergunta, resultado=None,
                          contagem=base.contagem(), erro="Escreva uma pergunta com pelo menos 3 caracteres.")
        resultado = await run_in_threadpool(responder, base, pergunta, ollama, 4, medidor)
        return render(request, "hr/conhecimento.html", pergunta=pergunta, resultado=resultado, contagem=base.contagem())

    @router.get("/gastos", response_class=HTMLResponse)
    def gastos(request: Request):
        token_equipe(request)
        return render(request, "hr/gastos.html", uso=medidor.resumo())

    app.include_router(router)
