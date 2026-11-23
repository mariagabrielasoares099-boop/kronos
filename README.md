# KRONOS — ATS + Admissão

ATS em que **cada candidato é um chamado** com protocolo único (ex.: `ADM-2026-000123`), da candidatura até a admissão concluída na folha, integrado ao ERP de folha do cliente (Fortes, Domínio, Alterdata, Totvs, Senior…) por **conectores**.

> Projeto de demonstração, sem comprador: usa apenas serviços gratuitos ou locais.

▶️ **Vídeo de demonstração (31 s):** [assistir](<docs/video divulgação/KRONOS-walkthrough.mp4>)

## O problema
O recrutamento acontece num lugar (Gupy, planilha, e-mail) e a admissão em outro (WhatsApp para pedir documentos, digitação manual na folha). O RH digita tudo duas vezes, perde documentos e não sabe em que etapa cada pessoa está.

## A solução
1. **Candidato**: se candidata, acompanha o chamado e envia documentos pelo celular.
2. **RH**: trabalha numa fila de chamados com status, responsável e prazo (SLA); aprova ou recusa documentos com motivo.
3. **Admissão**: aprovado o candidato, os dados validados seguem para o ERP do cliente.

Leitura rápida para a equipe: [`docs/RESUMO.md`](docs/RESUMO.md).
Quer ver funcionando? Roteiro de demonstração em [`docs/DEMO.md`](docs/DEMO.md).

## Começar rápido (modo demonstração)
Guia completo, com regras de uso, usuários de teste, ingestão/MCP e celular: **[`Passo a Passo/`](Passo%20a%20Passo/README.md)**.

```powershell
cd apps/web
python -m venv .venv ; .venv\Scripts\Activate.ps1      # Mac/Linux: source .venv/bin/activate
pip install -r requirements.txt
$env:DEMO_MODE = 'true'                                # Mac/Linux: export DEMO_MODE=true
python -m uvicorn app.main:app --port 8000             # abra http://127.0.0.1:8000
python scripts/semear_candidatos.py http://127.0.0.1:8000   # candidatos de teste (outro terminal)
```

| Quero… | Onde |
|---|---|
| Instalar em outro computador | [Passo a Passo/01](Passo%20a%20Passo/01-subir-o-kronos-no-computador.md) |
| Entender as regras do sistema | [Passo a Passo/02](Passo%20a%20Passo/02-como-usar-o-kronos.md) |
| Usuários e roteiro de teste | [Passo a Passo/03](Passo%20a%20Passo/03-usuarios-de-teste.md) |
| Ingestão (RAG), Ollama e MCP | [Passo a Passo/04](Passo%20a%20Passo/04-ingestao-e-mcp.md) |
| Usar no celular | [Passo a Passo/05](Passo%20a%20Passo/05-usar-no-celular.md) |

## Stack
| Camada | Tecnologia |
|---|---|
| Front-end | Python: FastAPI + Jinja2 + HTMX |
| Back-end | NestJS (Node.js + TypeScript) |
| Banco | PostgreSQL + Prisma, com Row Level Security |
| Fila / cache | Redis (BullMQ) |

Detalhes e decisões: [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) e [`docs/adr/`](docs/adr).

## Estrutura do repositório
```
apps/
  api/   API NestJS: domínio do chamado, modelo de dados, health check
  web/   Portal e painel (FastAPI + Jinja2 + HTMX)
docs/    Escopo, arquitetura, dados, módulos e ADRs
docker-compose.yml   PostgreSQL e Redis para desenvolvimento local
```

## Como rodar localmente

Pré-requisitos: Node.js, Python 3 e Docker.

```bash
# 1. Variáveis de ambiente
cp .env.example .env
cp .env.example apps/api/.env
#    O Compose lê o .env da raiz; a API lê apps/api/.env.
#    Edite apps/api/.env: configure DATABASE_URL com as credenciais/porta do
#    docker-compose.yml e troque JWT_SECRET e ENCRYPTION_KEY por valores de 32+ caracteres.

# 2. Banco e Redis
docker compose up -d

# 3. API (porta 3000; a primeira compilação pode demorar)
cd apps/api
npm install
npx prisma generate
npx prisma migrate deploy   # usa MIGRATE_DATABASE_URL (administrador)
docker compose exec -T postgres psql -U kronos -d kronos < prisma/dev/app-role.sql   # papel de login da API (so dev)
npm run start:dev

# 4. Web (em outro terminal)
cd apps/web
pip install -r requirements.txt
uvicorn app.main:app --reload
```

> A API **recusa subir** se `DATABASE_URL` for de superusuário, BYPASSRLS ou dono das tabelas, porque o banco ignoraria o isolamento por empresa. Use o papel `kronos_api` (`.env.example`).

> Se a porta 5432 já estiver em uso, em Bash use `POSTGRES_PORT=5433 docker compose up -d`; no PowerShell use `$env:POSTGRES_PORT = "5433"; docker compose up -d`. Para Redis, use `REDIS_PORT` (Bash) ou `$env:REDIS_PORT` (PowerShell). Ao mudar a porta, atualize a `DATABASE_URL` em `apps/api/.env`.

Atalhos na raiz (`package.json`): `npm run db:up`, `dev:api`, `dev:web`, `test`.

Verificação: `GET http://localhost:3000/health` retorna `{"status":"ok"}`.

O front roda em **modo demo** (rotas `/`, `/vagas`, `/painel`) por padrão (`DEMO_MODE=true`), sem precisar da API. Fora do modo demo, `API_BASE_URL` e `SESSION_SECRET` (32+ caracteres) são obrigatórios.

## Testes
```bash
cd apps/api && npm test        # unitários (Vitest)
cd apps/web && pip install pytest && pytest   # front-end
```

## Documentação
- Escopo completo: [`docs/escopo-produto.pdf`](docs/escopo-produto.pdf)
- Modelo de dados: [`docs/DADOS.md`](docs/DADOS.md)
- Módulos: [`docs/modulos/`](docs/modulos/README.md)
- Os 10 passos (checklist transversal): [`docs/PASSOS.md`](docs/PASSOS.md)
- Segurança: [`SECURITY.md`](SECURITY.md)

## Fases
1. **MVP**: tenancy, chamados, vagas, portal, painel, documentos, admissão (export CSV/JSON), e-mail.
2. **Vendável**: planos/cobrança, WhatsApp, testes, assinatura digital, 1º conector ERP, relatórios.
3. **Escala**: parcerias/conectores de ERP, IA (OCR/triagem), API pública e webhooks.

## Equipe
<!-- Preencher: nomes e papéis -->

## Requisitos da disciplina
<!-- Preencher com as especificações do professor -->
