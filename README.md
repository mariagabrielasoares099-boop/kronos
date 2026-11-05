# KRONOS — ATS + Admissão

ATS em que **cada candidato é um chamado** com protocolo único (ex.: `ADM-2026-000123`), da candidatura até a admissão concluída na folha, integrado ao ERP de folha do cliente (Fortes, Domínio, Alterdata, Totvs, Senior…) por **conectores**.

> Projeto de demonstração, sem comprador: usa apenas serviços gratuitos ou locais.

## O problema
O recrutamento acontece num lugar (Gupy, planilha, e-mail) e a admissão em outro (WhatsApp para pedir documentos, digitação manual na folha). O RH digita tudo duas vezes, perde documentos e não sabe em que etapa cada pessoa está.

## A solução
1. **Candidato**: se candidata, acompanha o chamado e envia documentos pelo celular.
2. **RH**: trabalha numa fila de chamados com status, responsável e prazo (SLA); aprova ou recusa documentos com motivo.
3. **Admissão**: aprovado o candidato, os dados validados seguem para o ERP do cliente.

Leitura rápida para a equipe: [`docs/RESUMO.md`](docs/RESUMO.md).

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
#    Edite o .env: JWT_SECRET e ENCRYPTION_KEY precisam ter 32+ caracteres,
#    senão a API não sobe. O usuário/senha do banco local estão no docker-compose.yml.

# 2. Banco e Redis
docker compose up -d

# 3. API (porta 3000; a primeira compilação pode demorar)
cd apps/api
npm install
npm run start:dev

# 4. Web (em outro terminal)
cd apps/web
pip install -r requirements.txt
uvicorn app.main:app --reload
```

> Se a porta 5432 já estiver em uso (outro Postgres local), suba com outra porta: `POSTGRES_PORT=5433 docker compose up -d` (Redis: `REDIS_PORT`) e ajuste a porta no `DATABASE_URL`.

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
