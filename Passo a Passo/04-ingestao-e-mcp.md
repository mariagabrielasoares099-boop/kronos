# 4. Ingestão (RAG), Ollama e MCP

Tudo é **local e gratuito**. Sem chave de API.

## O que é cada coisa

- **Ingestão**: o passo que lê os documentos de política do RH da pasta `docs/conhecimento/` e os grava, em pedaços, numa base local.
- **RAG**: a pergunta feita na tela busca os pedaços mais parecidos e responde **citando o documento**.
- **Ollama** (opcional): programa de IA local. Com ele a busca é por significado e a resposta é escrita em texto corrido. Sem ele a busca é por palavras-chave e a tela mostra os trechos encontrados.
- **MCP do KRONOS**: deixa o **Claude Code** consultar vagas, chamados e a base de conhecimento, só leitura.

## Ingerir documentos

**Pela tela** (mais simples): `/rh/conhecimento` → aba **Ingestão** → **Ingerir agora**. A aba mostra se a pasta foi encontrada, se o Ollama está disponível, o resultado (novos, atualizados, sem mudança, removidos, ignorados) e a lista de documentos na base.

**Pelo terminal**, na pasta `apps/web`:

```powershell
python -m app.services.rag_ingest                 # pasta padrão: docs/conhecimento
python -m app.services.rag_ingest D:\politicas    # outra pasta
python -m app.services.rag_ingest --sem-ollama    # só palavras-chave
```

Regras da ingestão:

| Regra | Detalhe |
|---|---|
| Formatos | `.md`, `.txt` e `.pdf` com texto |
| Para adicionar | copie o arquivo para `docs/conhecimento/` e ingira de novo |
| Reexecutar é seguro | só arquivos que mudaram são reprocessados; arquivos apagados saem da base |
| PDF ignorado | escaneado (só imagem), com senha, corrompido, acima de 20 MB ou com mais de 300 páginas; a tela e o terminal dizem o motivo |
| O que colocar | políticas e manuais da empresa. **Não** coloque documentos de candidatos (RG, CPF, currículo) |
| Onde fica a base | `apps/web/data/conhecimento.db` (não vai para o git) |

A pasta traz 3 documentos de **exemplo** (documentos da admissão, SLA, LGPD), fictícios. Troque pelos reais.

## Ollama (opcional)

```powershell
# instale em https://ollama.com e depois:
ollama pull llama3.2
ollama pull nomic-embed-text
```

Se a base foi ingerida **antes** de instalar o Ollama, apague `apps/web/data/conhecimento.db` e ingira de novo: os arquivos não mudaram, então seriam pulados e ficariam sem vetores. Variáveis (`.env.example`): `OLLAMA_URL`, `OLLAMA_MODEL`, `OLLAMA_EMBED_MODEL`, `OLLAMA_TIMEOUT_S`.

## Perguntar

`/rh/conhecimento` → aba **Perguntar**. Exemplos para o demo:

- "Quando devo recusar um comprovante de residência?"
- "O que fazer com chamado atrasado?"
- "A IA decide quem é contratado?"

## MCP do KRONOS

Aba **MCP do KRONOS** em `/rh/conhecimento` mostra as ferramentas e a configuração. Resumo:

| Ferramenta | O que faz |
|---|---|
| `listar_vagas` | vagas abertas |
| `listar_chamados` | chamados, com filtro opcional por status |
| `consultar_chamado` | detalhe pelo protocolo (status, documentos, histórico) |
| `buscar_conhecimento` | trechos da base de conhecimento, com fonte |
| `resumo_uso` | uso do mês contra a cota (exemplo) |

Todas são **somente leitura** e usam os **dados fictícios** do demo. Nenhuma cria, decide, apaga ou envia nada.

### Conectar no Claude Code

1. Abra o Claude Code **na pasta do projeto**. O arquivo `.mcp.json` da raiz já registra o servidor `kronos`.
2. Aprove o servidor quando o Claude Code pedir.
3. Confira com `claude mcp list`.
4. Peça, por exemplo: "use o kronos para consultar o chamado ADM-2026-000001".

Se o `python` do PATH não for o do projeto, troque o campo `command` do `.mcp.json` pelo caminho do `python.exe` dentro de `apps/web/.venv`. O servidor funciona sem `httpx`; com o Ollama no ar ele usa a busca por significado.

Teste direto, sem o Claude Code:

```powershell
cd apps/web
'{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | python mcp_kronos.py
```

## Limites

- Uma base só, para **uma empresa**. Várias empresas exigem uma base por empresa e controle de acesso.
- Sem OCR: PDF escaneado não entra.
- O contador de uso zera ao reiniciar o servidor.
- Integração testada com um Ollama simulado; confirme uma vez com o Ollama real instalado.

Detalhes técnicos: [`docs/RAG-MCP.md`](../docs/RAG-MCP.md).
