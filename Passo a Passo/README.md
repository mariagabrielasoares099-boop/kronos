# Passo a Passo do KRONOS

Guia para quem vai **instalar, usar e apresentar** o KRONOS. Leia na ordem; cada arquivo funciona sozinho.

| # | Arquivo | Para quê |
|---|---|---|
| 1 | [Subir o KRONOS no computador](01-subir-o-kronos-no-computador.md) | Instalar e rodar do zero (Windows, Mac ou Linux) |
| 2 | [Como usar o KRONOS (regras)](02-como-usar-o-kronos.md) | O caminho do chamado, o que o candidato e o RH podem fazer e as regras do sistema |
| 3 | [Usuários de teste](03-usuarios-de-teste.md) | Candidatos e conta do RH para usar na demonstração |
| 4 | [Ingestão e MCP](04-ingestao-e-mcp.md) | Base de conhecimento (RAG), Ollama e o servidor MCP |
| 5 | [Usar no celular](05-usar-no-celular.md) | Abrir o KRONOS no telefone e o que foi verificado |

## Resumo em 1 minuto

1. Instale **Python 3.11+** e **Git**.
2. `git clone` do repositório, entre em `apps/web`, crie o ambiente virtual e rode `pip install -r requirements.txt`.
3. `python -m uvicorn app.main:app --port 8000` e abra `http://127.0.0.1:8000`.
4. Para ver o fluxo completo, cadastre os candidatos de teste: `python scripts/semear_candidatos.py`.
5. A área do RH está em `/painel/fila` e `/rh/dashboard`.

> Tudo aqui é **demonstração com dados fictícios**, sem custo: nenhum serviço pago, nenhuma chave de API. Reiniciar o servidor volta tudo ao estado inicial.

Documentação técnica de apoio (para desenvolvedores): [`docs/`](../docs).
