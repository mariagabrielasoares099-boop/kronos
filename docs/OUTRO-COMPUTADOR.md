# Levantar o KRONOS em outro computador

Guia para Windows (PowerShell). O demo roda só com Python; a API NestJS e o banco são opcionais.

## 0. Antes, neste computador: subir o trabalho

Boa parte do trabalho recente **ainda não foi commitada** (RAG, MCP, painéis, ajustes de acessibilidade, skills, documentos de design). O outro computador só recebe o que estiver no GitHub. Confira com `git status` e, quando você decidir, commite e envie:

```powershell
git status --short
git switch feat/portal-equipe        # branch atual
git add -A                           # revise antes: veja a lista de "Não vai para o git"
git commit -m "feat(web): RAG, MCP, painel de uso, acessibilidade e design"
git push -u origin feat/portal-equipe
```

**Não vai para o git** (já está no `.gitignore` ou não deve ir): `.env`, `apps/web/.venv`, `apps/web/data/` (base do RAG, regerável), `storage/` (documentos enviados) e `.playwright-cli/`. Conferir `git status` para não levar segredos ou dados pessoais.

## 1. Pré-requisitos

| Ferramenta | Para quê | Obrigatório |
|---|---|---|
| Git | clonar | sim |
| Python 3.11+ (testado com 3.14) | demo web, RAG, MCP | sim |
| Node 20+ e npm | API NestJS, skills, scan de acessibilidade | só para API e skills |
| Docker Desktop | PostgreSQL, Redis e Mailpit da API | só para a API |
| Ollama | IA local e embeddings do RAG | opcional |
| Google Chrome | abrir o app, scan de acessibilidade | recomendado |

## 2. Clonar e subir o demo

```powershell
git clone <URL-do-repositório> kronos
cd kronos
git switch feat/portal-equipe

cd apps/web
python -m venv .venv
.venv\Scripts\Activate.ps1          # se bloquear: Set-ExecutionPolicy -Scope Process Bypass
pip install -r requirements.txt

$env:DEMO_MODE = 'true'
python -m uvicorn app.main:app --port 8000
```

Abra `http://127.0.0.1:8000`. Confirme: `python -m pytest -q` deve passar tudo (122 testes na última execução).

## 3. RAG e Ollama (opcional)

```powershell
ollama pull llama3.2
ollama pull nomic-embed-text
python -m app.services.rag_ingest
```

Detalhes e o que fazer ao instalar o Ollama depois da primeira ingestão: `docs/RAG-MCP.md`.

## 4. MCP no Claude Code

O `.mcp.json` já vem no repositório. Abra o Claude Code na pasta do projeto, aprove o servidor `kronos` quando ele pedir e confira com `claude mcp list`. Se o `python` do PATH não for o do projeto, ajuste o `command` do `.mcp.json`.

## 5. Skills de design e acessibilidade

As skills ficam em `.claude/skills/` e o `skills-lock.json` registra de onde vieram. Se `.claude/` não estiver no git, reinstale na raiz do projeto (comandos da instalação original):

```powershell
npx -y skills add vercel-labs/agent-skills --skill web-design-guidelines vercel-react-best-practices vercel-composition-patterns -a claude-code -y
npx -y skills add anthropics/skills --skill frontend-design web-artifacts-builder -a claude-code -y
npx -y skills add bondar-artem/playwright-scripting-skills --skill '*' -a claude-code -y
npx -y skills add obra/superpowers --skill test-driven-development -a claude-code -y
npx -y skills add nextlevelbuilder/ui-ux-pro-max-skill -a claude-code -y
npx -y skills add pbakaus/impeccable -a claude-code -y
npx -y skills add AccessLint/claude-marketplace -a claude-code -y
npx -y skills add shadcn-ui/ui -a claude-code -y
npx -y @playwright/cli install --skills
```

Atalho testado: `npx -y skills experimental_install -a claude-code -y` restaura pelo `skills-lock.json` (num teste em pasta vazia voltaram 32 das 33 skills). A que **não** volta por esse comando é a `playwright-cli`, que vem de `npx -y @playwright/cli install --skills`. Antes de restaurar, `npx -y skills experimental_install --dry-run -a claude-code` só lista o que seria feito. Para o `skills-lock.json` valer em outro computador, ele precisa estar commitado.

## 6. Dados de teste e login de exposição

Com o servidor no ar: `python scripts/semear_candidatos.py http://127.0.0.1:8000`. Para exigir login na área do RH (exposição), suba com `$env:EXPO_LOGIN = 'true'`. Contas e detalhes em `docs/USUARIOS-TESTE.md`.

## 7. Modo completo (API + banco), opcional

```powershell
cd ..\..                              # raiz do repositório
Copy-Item .env.example .env           # troque JWT_SECRET e ENCRYPTION_KEY; nunca commite o .env
docker compose up -d                  # PostgreSQL, Redis, Mailpit (caixa de e-mail em http://localhost:8025)
npm --prefix apps/api install
npm run dev:api                       # http://localhost:3000/health
```

Depois suba o web com `DEMO_MODE=false`, `API_BASE_URL=http://localhost:3000` e `SESSION_SECRET` com 32+ caracteres. Guia da API: `docs/API.md`. As migrations e o papel `kronos_api` do banco estão em `apps/api/prisma/`.

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| `ModuleNotFoundError: app` ao rodar o ingest | rodou fora de `apps/web` |
| `pip` instala fora do venv | o venv não foi ativado |
| Porta 8000 ocupada | use `--port 8001` ou encerre o outro `uvicorn` |
| Tela do RH pede login | está com `DEMO_MODE` diferente de `true` |
| Busca do RAG sem "Ollama" | normal sem Ollama; veja `docs/RAG-MCP.md` |
