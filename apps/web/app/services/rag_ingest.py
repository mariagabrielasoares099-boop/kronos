"""Ingestao do RAG pela linha de comando.

    python -m app.services.rag_ingest [pasta] [--base caminho.db] [--sem-ollama]

Pasta padrao: docs/conhecimento. Banco: apps/web/data/conhecimento.db (ignorado pelo git).
Reexecutar e seguro: so reprocessa arquivos que mudaram.
"""
import argparse
import os
import sys

from ..config import load_settings
from .ollama import cliente_de
from .rag import PADRAO_BASE, PADRAO_PASTA, BaseConhecimento


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Ingere .md/.txt/.pdf na base de conhecimento do RH (local).")
    ap.add_argument("pasta", nargs="?", default=str(PADRAO_PASTA))
    ap.add_argument("--base", default=str(PADRAO_BASE))
    ap.add_argument("--sem-ollama", action="store_true", help="so palavras-chave, sem embeddings")
    a = ap.parse_args(argv)
    ollama = None
    if not a.sem_ollama:
        cli = cliente_de(load_settings({"DEMO_MODE": "true", **os.environ}))
        if cli.disponivel():
            ollama = cli
        else:
            print(f"Aviso: Ollama nao responde em {cli.base_url}; ingerindo so com palavras-chave.", file=sys.stderr)
    base = BaseConhecimento(a.base)
    r = base.ingerir_pasta(a.pasta, ollama)
    print(f"Pasta: {a.pasta}\nIngestao: { {k: v for k, v in r.items() if k != 'ignorados'} }\nBase: {base.contagem()}")
    for i in r["ignorados"]:
        print(f"Ignorado: {i['fonte']} ({i['motivo']})", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
