# RAG, Ollama e MCP do KRONOS

Tudo local e grátis. Sem chave de API, sem nuvem. Comandos a partir de `apps/web` (PowerShell), com o ambiente virtual ativo.

## O que existe

| Peça | Onde | Para quê |
|---|---|---|
| Cliente Ollama | `app/services/ollama.py` | `chat`, `gerar` e `embed` (`/api/embed`) na API do Ollama |
| RAG | `app/services/rag.py` | Divide, guarda (SQLite) e busca trechos; responde citando a fonte |
| Ingestão | `python -m app.services.rag_ingest` | Lê `docs/conhecimento/` (`.md`, `.txt` e `.pdf`) para a base |
| Tela do RH | `/rh/conhecimento` | Pergunta e resposta com fontes |
| Painel de uso | `/rh/gastos` | Consumo contra a cota do plano e custo (R$ 0,00 com IA local) |
| Servidor MCP | `mcp_kronos.py` + `.mcp.json` | Deixa uma IA consultar vagas, chamados e a base (somente leitura), por HTTP no servidor ou por stdio |

## Fluxo de ingestão

```
docs/conhecimento/*.md|txt|pdf
   │  1. lê e calcula o hash (arquivo igual = pulado; arquivo removido = sai da base)
   │  2. divide em trechos de ~700 caracteres, por parágrafo e frase
   │  3. Ollama /api/embed gera um vetor por trecho (se o Ollama responder)
   ▼
apps/web/data/conhecimento.db   (SQLite, ignorado pelo git)
   │
pergunta ─► busca ─► 4 melhores trechos ─► Ollama /api/chat ─► resposta + fontes
              │
              └─ sem Ollama ou sem vetores: busca por palavras-chave (TF-IDF simples), devolve só os trechos
```

Regras de segurança do fluxo:
- O texto dos documentos é **não confiável**. Vai só na mensagem de usuário, entre `<trechos>` e `</trechos>`; o prompt de sistema é fixo e manda ignorar instruções dentro dos trechos. Um `</trechos>` dentro de um documento é removido.
- Por arquivo é tudo ou nada: ou todos os trechos têm vetor ou nenhum, para nunca misturar os dois tipos de busca.
- A resposta é só apoio. Nenhuma aprovação ou recusa é automática.
- Não coloque documentos de candidatos (RG, CPF, currículo) em `docs/conhecimento`: a base é para **políticas e manuais** da empresa.

## Passo a passo

```powershell
# 1. Ollama (https://ollama.com): instale e baixe os dois modelos (uma vez)
ollama pull llama3.2
ollama pull nomic-embed-text

# 2. Ingestão (reexecute sempre que mudar os documentos; só o que mudou é reprocessado)
cd apps/web
python -m app.services.rag_ingest                 # pasta padrão: docs/conhecimento
python -m app.services.rag_ingest D:\politicas    # outra pasta
python -m app.services.rag_ingest --sem-ollama    # só palavras-chave

# 3. Subir o app e abrir /rh/conhecimento
$env:DEMO_MODE = 'true'; python -m uvicorn app.main:app --port 8000
```

Sem o Ollama a ingestão avisa e segue só com palavras-chave; a tela mostra "Sem geração de IA" e os trechos. Depois de instalar o Ollama, reingira com `--sem-ollama` ausente e **apague `data/conhecimento.db`** (os arquivos não mudaram, então o hash os pularia e eles ficariam sem vetores).

Variáveis (`.env.example`): `OLLAMA_URL` (padrão `http://localhost:11434`), `OLLAMA_MODEL` (`llama3.2`), `OLLAMA_EMBED_MODEL` (`nomic-embed-text`), `OLLAMA_TIMEOUT_S` (`60`).

## Servidor MCP

Ferramentas, todas **somente leitura** e com dados **fictícios do demo**: `listar_vagas`, `listar_chamados`, `consultar_chamado`, `buscar_conhecimento`, `resumo_uso`. Nenhuma cria, decide, apaga ou envia nada. O servidor fala JSON-RPC por stdin/stdout, sem dependência extra.

**Dois transportes, o mesmo núcleo** (`app/services/mcp.py`): **stdio** (`mcp_kronos.py`, iniciado pelo Claude Code) e **HTTP** (`POST /mcp` no servidor web, só com `DEMO_MODE=true`). O HTTP enxerga os chamados vivos do servidor, recusa `Origin` de outro site, limita o corpo a 64 KB e aceita sessão da equipe ou `MCP_TOKEN` (Bearer, 24+ caracteres). Registro: `claude mcp add --transport http kronos http://127.0.0.1:8000/mcp`. Veja `Passo a Passo/04-ingestao-e-mcp.md`.

O `.mcp.json` da raiz registra o servidor `kronos` para o Claude Code deste projeto (ele pede aprovação na primeira vez). Para conferir:

```powershell
claude mcp list
claude mcp get kronos
```

Teste manual sem o Claude Code:

```powershell
'{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | python mcp_kronos.py
```

O `.mcp.json` usa `python` do PATH. Se o `python` do PATH não for o do projeto, troque `command` pelo caminho do `python.exe` do `.venv`. O MCP não precisa do `httpx` para buscar por palavras-chave; com o `httpx` e o Ollama no ar, passa a usar os vetores.

## Painel de uso e custos

`/rh/gastos` mostra consumo do mês contra a cota do plano (chamadas de IA, tokens, armazenamento, admissões) e o histórico de 6 meses. **Os 5 meses anteriores e a base do mês atual são fictícios.** Só as buscas e respostas da base de conhecimento feitas desde que o servidor subiu são medidas de verdade, e o contador zera ao reiniciar. O custo é R$ 0,00 porque a IA é local; quando houver provedor pago, a cota evita surpresa de fatura.

## Limites conhecidos

- PDF usa a biblioteca `pypdf` (já em `requirements.txt`; licença livre, sem custo). Só lê o texto do PDF: **PDF escaneado (imagem) não tem texto e é ignorado**, assim como PDF protegido por senha, corrompido, acima de 20 MB ou com mais de 300 páginas. A ingestão lista cada arquivo ignorado com o motivo e segue com os demais. OCR não está incluído.
- Sem a `pypdf` instalada, os PDFs são ignorados com o aviso `pip install pypdf`; `.md` e `.txt` continuam funcionando.
- Sem teste com um Ollama real nesta máquina: a integração foi testada contra um servidor simulado (`httpx.MockTransport`). Rode os passos acima uma vez com o Ollama instalado para confirmar o modelo de embeddings.
- Pensado para **uma empresa** neste primeiro momento: a base é única e compartilhada por quem acessa o painel. Para atender várias empresas será preciso uma base por empresa (tenant) e checagem de acesso.
