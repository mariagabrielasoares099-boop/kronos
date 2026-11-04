# Arquitetura

Aplicação web **multi-tenant** em nuvem, banco compartilhado isolado por `tenant_id` + Row Level Security. Toda comunicação com ERP passa por **fila e conectores**, nunca direto da tela.

| Camada | Escolha |
|---|---|
| Front-end | Next.js + TypeScript + Tailwind (portal e painel) |
| Back-end | NestJS (Node.js + TypeScript), organizado por módulos |
| Banco | PostgreSQL + Prisma, RLS |
| Arquivos | S3 compatível (R2/MinIO), privado, links assinados |
| Fila | Redis + BullMQ (SLA, notificações, sync ERP com retry) |
| Agente local | Serviço .NET ou Node no servidor do cliente |
| Hospedagem | Railway/Render no MVP; AWS São Paulo na Fase 2 |

Modelo canônico de admissão baseado no evento **S-2200** do eSocial; cada ERP é um conector que traduz esse modelo. Quem transmite ao eSocial é o ERP do cliente.

Estrutura planejada do monorepo: `apps/web`, `apps/api`, `packages/connectors`, `apps/erp-agent`.
