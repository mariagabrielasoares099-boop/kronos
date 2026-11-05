# ADR-001 — PostgreSQL como banco principal

- **Status:** aceito
- **Data:** 2026-11-04

## Contexto
O KRONOS é um SaaS multi-tenant e transacional que guarda dados pessoais e sensíveis (documentos, ASO, bancários), exige trilha de auditoria imutável e fila de sincronização com ERPs. O escopo já prevê PostgreSQL com Prisma e Row Level Security.

## Decisão
- **PostgreSQL ≥ 15** como único banco transacional, com `tenant_id` em toda tabela e RLS `FORCE`.
- ORM: Prisma. Migrations em SQL revisadas conforme o checklist do `kina:dba`; o `rls.sql` entra como migration.
- Ids `uuid` (v7, gerado na aplicação) por serem expostos em URLs e APIs; evita enumeração entre tenants.
- Status e papéis como `text` + `CHECK` (não `ENUM`), porque os valores ainda mudam.
- Hospedagem: Postgres gerenciado em região Brasil. MVP em Railway/Render; Fase 2 em AWS RDS São Paulo. Supabase é aceitável **apenas como hospedagem do Postgres**, sem usar Auth nem Storage deles.
- Documentos em storage de objetos privado (S3/R2/MinIO), nunca no banco.

## Alternativas descartadas
- **DuckDB:** banco analítico embarcado com um único escritor; não atende escrita concorrente multi-tenant. Pode servir depois, no módulo de relatórios, lendo exportações.
- **Supabase completo (Auth, Storage, PostgREST):** acopla autenticação, storage e regras de acesso a um fornecedor; preferimos RLS e autenticação sob controle do nosso código.
- **Banco por tenant ou schema por tenant:** custo operacional alto para o porte esperado; revisitar se um cliente grande exigir isolamento físico.

## Consequências
- Todo acesso passa por transação que define `app.tenant_id`; consulta sem isso retorna zero linhas (falha segura).
- Referência cruzada entre tenants via FK simples não é bloqueada pelo RLS; tratar com FKs compostas (ver `docs/DADOS.md`, perguntas em aberto).
- Backup só conta após restauração testada; treino de restauração é pré-requisito do primeiro cliente pagante.
