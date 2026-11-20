"""Nucleo do MCP do KRONOS (somente leitura, dados FICTICIOS do modo demonstracao).

Usado por dois transportes: stdio (mcp_kronos.py, para o Claude Code) e HTTP (POST /mcp, no proprio
servidor web). Ferramentas: listar_vagas, listar_chamados, consultar_chamado, buscar_conhecimento, resumo_uso.
Nenhuma ferramenta escreve, apaga ou envia nada.
"""
import json
import re

from ..gateway import CHECKLIST, STATUS_LABELS, TIPOS_DOCUMENTO, DemoGateway
from .rag import BaseConhecimento
from .uso import MedidorUso

PROTOCOLO_RE = re.compile(r"^ADM-\d{4}-\d{6}$")
VERSAO_PADRAO = "2024-11-05"
MAX_PERGUNTA = 500

FERRAMENTAS = [
    {"name": "listar_vagas", "description": "Lista as vagas abertas (dados fictícios do demo).",
     "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False}},
    {"name": "listar_chamados", "description": "Lista chamados (protocolo, candidato, status, responsável). Filtro opcional por status.",
     "inputSchema": {"type": "object", "properties": {"status": {"type": "string", "enum": list(STATUS_LABELS)}},
                     "additionalProperties": False}},
    {"name": "consultar_chamado", "description": "Detalhe de um chamado pelo protocolo (ex.: ADM-2026-000001): status, vaga, documentos e histórico.",
     "inputSchema": {"type": "object", "properties": {"protocolo": {"type": "string", "pattern": PROTOCOLO_RE.pattern}},
                     "required": ["protocolo"], "additionalProperties": False}},
    {"name": "buscar_conhecimento", "description": "Busca trechos na base de conhecimento do RH (RAG, docs/conhecimento). Devolve trechos com fonte; não gera resposta.",
     "inputSchema": {"type": "object", "properties": {"pergunta": {"type": "string", "maxLength": MAX_PERGUNTA},
                                                      "limite": {"type": "integer", "minimum": 1, "maximum": 8}},
                     "required": ["pergunta"], "additionalProperties": False}},
    {"name": "resumo_uso", "description": "Uso e custo do mês contra a cota do plano (exemplo; IA local custa R$ 0,00).",
     "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False}},
]


class Servidor:
    def __init__(self, gateway=None, base=None, medidor=None, ollama=None):
        self.gw = gateway or DemoGateway()
        self.base = base or BaseConhecimento()
        self.medidor = medidor or MedidorUso()
        self.ollama = ollama

    # ---- ferramentas ----
    def listar_vagas(self, _args: dict) -> dict:
        return {"vagas": [{"id": v.id, "titulo": v.titulo, "empresa": v.empresa, "local": v.local} for v in self.gw.listar_vagas()]}

    def listar_chamados(self, args: dict) -> dict:
        status = args.get("status")
        if status is not None and status not in STATUS_LABELS:
            raise ValueError("status inválido")
        itens = [c for c in self.gw.listar_chamados() if not status or c.status == status]
        return {"chamados": [{"protocolo": c.protocolo, "candidato": c.nome, "status": c.status,
                              "status_rotulo": STATUS_LABELS[c.status], "responsavel": c.responsavel} for c in itens]}

    def consultar_chamado(self, args: dict) -> dict:
        protocolo = str(args.get("protocolo", ""))
        if not PROTOCOLO_RE.match(protocolo):
            raise ValueError("protocolo inválido (formato ADM-AAAA-NNNNNN)")
        c = self.gw.obter_chamado(protocolo)
        if c is None:
            raise ValueError("chamado não encontrado")
        vaga = self.gw.obter_vaga(c.vaga_id)
        return {"protocolo": c.protocolo, "candidato": c.nome, "vaga": vaga.titulo if vaga else None,
                "status": c.status, "status_rotulo": STATUS_LABELS[c.status], "responsavel": c.responsavel,
                "prazo_sla": c.prazo_sla.isoformat() if c.prazo_sla else None,
                "documentos": [{"tipo": TIPOS_DOCUMENTO.get(d.tipo, d.tipo), "status": d.status, "motivo": d.motivo}
                               for d in c.documentos],
                "checklist_faltando": [t for t in CHECKLIST if not any(d.tipo == t for d in c.documentos)],
                "historico": [{"status": s, "detalhe": t} for s, t in c.historico]}

    def buscar_conhecimento(self, args: dict) -> dict:
        pergunta = str(args.get("pergunta", "")).strip()[:MAX_PERGUNTA]
        if len(pergunta) < 3:
            raise ValueError("pergunta muito curta")
        limite = args.get("limite", 4)
        if not isinstance(limite, int) or not 1 <= limite <= 8:
            raise ValueError("limite deve ser de 1 a 8")
        trechos = self.base.buscar(pergunta, k=limite, ollama=self.ollama)
        self.medidor.registrar("busca", tokens=len(pergunta) // 4)
        return {"trechos": [{"fonte": t.fonte, "trecho": t.ordem + 1, "texto": t.texto, "score": t.score} for t in trechos],
                "base": self.base.contagem()}

    def resumo_uso(self, _args: dict) -> dict:
        r = self.medidor.resumo()
        return {"mes": r["atual"]["mes"], "uso": r["uso"], "custo_total_reais": r["custo_total"], "observacao": "dados de exemplo"}

    # ---- protocolo ----
    def chamar(self, nome: str, args) -> dict:
        if not isinstance(args, dict):
            raise ValueError("argumentos devem ser um objeto")
        if nome not in {f["name"] for f in FERRAMENTAS}:
            raise KeyError(nome)
        return getattr(self, nome)(args)

    def tratar(self, msg: dict) -> dict | None:
        """Responde uma mensagem JSON-RPC; None para notificacoes."""
        mid, metodo = msg.get("id"), msg.get("method")
        if metodo is None or not isinstance(metodo, str):
            return self._erro(mid, -32600, "Requisição inválida") if mid is not None else None
        if mid is None:
            return None  # notificacao (ex.: notifications/initialized)
        if metodo == "initialize":
            versao = (msg.get("params") or {}).get("protocolVersion") or VERSAO_PADRAO
            return {"jsonrpc": "2.0", "id": mid, "result": {
                "protocolVersion": versao, "capabilities": {"tools": {}},
                "serverInfo": {"name": "kronos", "version": "0.1.0"},
                "instructions": "Somente leitura. Dados fictícios do modo demonstração do KRONOS."}}
        if metodo == "ping":
            return {"jsonrpc": "2.0", "id": mid, "result": {}}
        if metodo == "tools/list":
            return {"jsonrpc": "2.0", "id": mid, "result": {"tools": FERRAMENTAS}}
        if metodo == "tools/call":
            p = msg.get("params") or {}
            try:
                dados = self.chamar(p.get("name"), p.get("arguments") or {})
                texto, erro = json.dumps(dados, ensure_ascii=False, indent=2), False
            except KeyError:
                return self._erro(mid, -32602, "Ferramenta desconhecida")
            except ValueError as e:
                texto, erro = str(e), True
            return {"jsonrpc": "2.0", "id": mid, "result": {"content": [{"type": "text", "text": texto}], "isError": erro}}
        return self._erro(mid, -32601, "Método não encontrado")

    @staticmethod
    def _erro(mid, codigo: int, msg: str) -> dict:
        return {"jsonrpc": "2.0", "id": mid, "error": {"code": codigo, "message": msg}}
