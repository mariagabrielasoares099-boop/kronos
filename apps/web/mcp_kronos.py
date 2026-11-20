"""Servidor MCP do KRONOS por stdio (para o Claude Code). O mesmo MCP tambem responde por HTTP em POST /mcp.

Sem dependencia externa: fala JSON-RPC 2.0 por linhas (um JSON por linha) em stdin/stdout.
stdout e so protocolo; avisos vao para stderr. O nucleo (ferramentas e protocolo) esta em app/services/mcp.py.

Uso (na pasta apps/web):  python mcp_kronos.py
Registro no Claude Code: veja .mcp.json na raiz do repositorio e docs/RAG-MCP.md.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.services.mcp import FERRAMENTAS, MAX_PERGUNTA, PROTOCOLO_RE, VERSAO_PADRAO, Servidor  # noqa: E402,F401


def principal() -> int:
    from app.config import load_settings
    from app.services.rag import BaseConhecimento as Base

    ollama = None
    try:  # opcional: embeddings do Ollama se o httpx e o servidor existirem; senao, palavras-chave
        from app.services.ollama import cliente_de
        import os
        cli = cliente_de(load_settings({"DEMO_MODE": "true", **os.environ}))
        ollama = cli if cli.disponivel() else None
    except Exception as e:  # noqa: BLE001 - qualquer falha aqui so desliga o recurso opcional
        print(f"kronos-mcp: sem Ollama ({type(e).__name__}); busca por palavras-chave", file=sys.stderr)
    srv = Servidor(base=Base(), ollama=ollama)
    for linha in sys.stdin:
        linha = linha.strip()
        if not linha:
            continue
        try:
            msg = json.loads(linha)
        except json.JSONDecodeError:
            resp = Servidor._erro(None, -32700, "JSON inválido")
        else:
            resp = srv.tratar(msg) if isinstance(msg, dict) else Servidor._erro(None, -32600, "Requisição inválida")
        if resp is not None:
            sys.stdout.write(json.dumps(resp, ensure_ascii=False) + "\n")
            sys.stdout.flush()
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    raise SystemExit(principal())
