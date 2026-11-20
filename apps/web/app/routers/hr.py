"""Workspace do analista, com autorizacao herdada do painel existente."""
import json
from typing import Literal

from fastapi import APIRouter, Form, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, Response

from ..api_client import Conflito


def mount_hr(app, *, render, montar_fila, token_equipe, carregar_chamado, contexto_detalhe,
             chamar_equipe, portal_api, gw):
    router = APIRouter(prefix="/rh")

    def contexto(request, id):
        token = token_equipe(request)
        # A interface usa protocolos; aceita tambem o UUID oficial da API.
        if not id.startswith("ADM-") and token is not None:
            linhas = chamar_equipe(portal_api.equipe_listar, token)
            linha = next((r for r in linhas if r["id"] == id), None)
            if linha is None:
                raise HTTPException(404)
            id = linha["protocolo"]
        c = carregar_chamado(token, id)
        ctx = contexto_detalhe(token, c)
        return token, c, ctx

    @router.get("/dashboard", response_class=HTMLResponse)
    def dashboard(request: Request, status: str = Query("", max_length=30),
                  busca: str = Query("", max_length=60), selecionado: str = Query("", max_length=40),
                  aba: Literal["resumo", "documentos", "historico"] = "resumo"):
        fila = montar_fila(request, status, busca)
        selecionado = selecionado or (fila["linhas"][0][0].protocolo if fila["linhas"] else "")
        detalhe = contexto(request, selecionado)[2] if selecionado else {}
        return render(request, "hr/dashboard.html", **(fila | detalhe), selecionado=selecionado, aba=aba)

    @router.get("/fila", response_class=HTMLResponse)
    def fila(request: Request, status: str = Query("", max_length=30), busca: str = Query("", max_length=60)):
        return render(request, "hr/_queue.html", **montar_fila(request, status, busca), selecionado="")

    @router.get("/chamados/{id}", response_class=HTMLResponse)
    def detalhe(request: Request, id: str, aba: Literal["resumo", "documentos", "historico"] = "resumo"):
        if not request.headers.get("hx-request"):
            return dashboard(request, status="", busca="", selecionado=id, aba=aba)
        _, _, ctx = contexto(request, id)
        return render(request, "hr/_workspace.html", **ctx, aba=aba)

    @router.get("/chamados/{id}/recusa", response_class=HTMLResponse)
    def recusa(request: Request, id: str, doc_id: str = Query(..., max_length=40)):
        _, c, _ = contexto(request, id)
        if c.docs_indisponiveis:
            raise HTTPException(403)
        doc = next((d for d in c.documentos if d.id == doc_id), None)
        if doc is None:
            raise HTTPException(404)
        return render(request, "hr/_feedback.html", chamado=c, doc=doc)

    @router.post("/chamados/{id}/atribuir", response_class=HTMLResponse)
    def atribuir(request: Request, id: str):
        token, c, _ = contexto(request, id)
        if token is None:
            raise HTTPException(404)
        erro = None
        dados = chamar_equipe(portal_api.equipe_chamado, c.protocolo, token)
        if not dados:
            raise HTTPException(404)
        try:
            if not chamar_equipe(portal_api.atribuir, dados["resumo"]["id"], token):
                raise HTTPException(404)
        except Conflito:
            erro = "Você não pode assumir este chamado. Confira seu vínculo com a empresa."
        except HTTPException as exc:
            if exc.status_code != 403:
                raise
            erro = "Seu papel não permite assumir este chamado."
        _, _, ctx = contexto(request, c.protocolo)
        ctx["erro_acao"] = erro
        resp = render(request, "hr/_workspace.html", **ctx, aba="documentos")
        if not erro:
            resp.headers["HX-Trigger"] = "hrRefreshQueue"
        return resp

    @router.post("/chamados/{id}/documentos/{doc_id}/decisao", response_class=HTMLResponse)
    def decidir(request: Request, id: str, doc_id: str, acao: Literal["aprovar", "recusar"] = Form(...),
                motivo: str = Form("", max_length=500)):
        token, c, ctx = contexto(request, id)
        doc = next((d for d in c.documentos if d.id == doc_id), None)
        if c.docs_indisponiveis or doc is None:
            raise HTTPException(404)
        erro = None
        if acao == "recusar" and len(motivo.strip()) < 3:
            erro = "Informe o motivo da recusa (mínimo 3 caracteres)."
        elif doc.status != "PENDENTE":
            erro = "Este documento já foi decidido."
        elif token is None:
            if gw.decidir_documento(doc_id, acao == "aprovar", motivo) is None:
                erro = "Este documento já foi decidido."
        else:
            try:
                if not chamar_equipe(portal_api.decidir_documento, doc_id, acao == "aprovar", motivo, token):
                    raise HTTPException(404)
            except Conflito:
                erro = "Este documento já foi decidido."
        _, _, ctx = contexto(request, id)
        ctx["erro"] = erro
        resp = render(request, "hr/_documents.html", **ctx)
        if not erro:
            resp.headers["HX-Trigger"] = "hrCloseDialog"
        return resp

    @router.get("/chamados/{id}/export-erp")
    def exportar(request: Request, id: str, download: bool = False):
        _, c, _ = contexto(request, id)
        payload = {"tipo": "PREVIA_CANONICA", "pronto_para_importacao": False, "protocolo": c.protocolo,
                   "nome": c.nome, "status": c.status, "vaga": c.vaga_titulo,
                   "campos_pendentes": ["cpf", "nascimento", "endereco", "cargo", "salarioCentavos", "dataAdmissao", "layout_erp"]}
        texto = json.dumps(payload, ensure_ascii=False, indent=2)
        if download:
            return Response(texto, media_type="application/json", headers={
                "Content-Disposition": f'attachment; filename="previa-{c.protocolo}.json"', "Cache-Control": "no-store"})
        return render(request, "hr/_export.html", chamado=c, payload=texto)

    app.include_router(router)
