# Dados e banco — KRONOS (ATS + Admissão)

> Criado em 2026-11-04. Regras: modelo antes da primeira migration; migration revisada como mudança de produção.
> ADR de banco: [ADR-001](adr/ADR-001-banco-postgresql.md).
> Escopo de origem: [escopo-produto.pdf](escopo-produto.pdf). Este documento cobre o núcleo da Fase 1; testes, assinatura, uniforme e ERP entram na própria fase (ver "Perguntas em aberto").

## Princípios

1. `tenant_id` em **toda** tabela de negócio, primeiro campo das chaves e índices compostos; Row Level Security (`FORCE`) em todas.
2. A aplicação conecta com um papel sem `BYPASSRLS` e que não é dono das tabelas; o tenant é definido por transação (`set_config('app.tenant_id', ..., true)`).
3. `ticket_events` é **append-only** (trigger + `REVOKE UPDATE, DELETE, TRUNCATE`): correção é um evento novo.
4. Arquivos (documentos do candidato) ficam no storage privado; o banco guarda só o registro e a chave do objeto.
5. O modelo de admissão é **canônico** (campos do S-2200 do eSocial); nenhum conector de ERP altera o modelo, só o traduz.
6. Envio ao ERP é idempotente: `tickets.erp_ref` (= protocolo) é a referência externa e `erp_syncs` guarda cada tentativa.
7. Dados pessoais têm retenção: candidato não contratado é anonimizado após o prazo configurável do tenant.
8. Constraints vivem no banco (`NOT NULL`, `CHECK`, FK, `UNIQUE`); a validação na API não as substitui.

## Fluxo dos dados

```mermaid
flowchart LR
  CAND[Candidato - portal] --> API[API NestJS]
  RH[RH - painel] --> API
  API --> DB[(PostgreSQL com RLS)]
  API --> S3[(Storage privado - documentos)]
  DB --> FILA[Fila Redis/BullMQ]
  FILA --> CONN[Conectores de ERP]
  CONN --> ERP[ERP de folha do cliente]
  ERP --> CONN
  CONN --> DB
```

## Camadas / schemas

| Schema | Guarda | Quem escreve | Quem lê | Regra |
|---|---|---|---|---|
| `public` | Modelo de negócio (tenants, chamados, vagas, candidatos) | API (papel `kronos_app`) | API | RLS por `tenant_id` |
| `public` (`admission_data`, Fase 1) | Pré-cadastro em formato canônico S-2200 | API | API, conectores | Travado para edição após `ENVIO_ERP` |
| `raw` (Fase 2) | Resposta bruta do ERP, como veio | Conectores | Conectores, suporte | Imutável; permite reprocessar sem reenviar |
| `analytics` (Fase 2+) | Visões/cópias para relatórios | Job de carga | Módulo de relatórios | Somente leitura; pode ir para DuckDB no futuro |

## Modelo — diagrama

```mermaid
erDiagram
  TENANTS ||--o{ COMPANIES : possui
  TENANTS ||--o{ USERS : possui
  TENANTS ||--o{ CANDIDATES : possui
  COMPANIES ||--o{ JOBS : abre
  JOBS ||--o{ TICKETS : recebe
  CANDIDATES ||--o{ TICKETS : abre
  TICKETS ||--o{ TICKET_EVENTS : registra
  TICKETS ||--o{ MESSAGES : conversa

  TENANTS {
    uuid id PK
    text nome
    text cnpj
    text plano
    jsonb config
    timestamptz created_at
  }
  COMPANIES {
    uuid id PK
    uuid tenant_id FK
    text cnpj
    text razao_social
    text codigo_erp
  }
  USERS {
    uuid id PK
    uuid tenant_id FK
    text email
    text role
    text password_hash
    text totp_secret
  }
  JOBS {
    uuid id PK
    uuid tenant_id FK
    uuid company_id FK
    text titulo
    text cargo_erp_id
    jsonb fluxo
    jsonb checklist
  }
  CANDIDATES {
    uuid id PK
    uuid tenant_id FK
    text cpf
    text nome
    text email
    timestamptz consentimento_lgpd
    timestamptz anonimizado_em
  }
  TICKETS {
    uuid id PK
    uuid tenant_id FK
    text protocolo
    uuid job_id FK
    uuid candidate_id FK
    text status
    uuid responsavel FK
    timestamptz prazo_sla
    text erp_ref
  }
  TICKET_EVENTS {
    uuid id PK
    uuid tenant_id FK
    uuid ticket_id FK
    text tipo
    text de
    text para
    text motivo
    jsonb payload
    timestamptz created_at
  }
  MESSAGES {
    uuid id PK
    uuid tenant_id FK
    uuid ticket_id FK
    text canal
    text texto
    boolean interno
  }
```

## Chaves, constraints e índices

| Tabela | Chave natural (`UNIQUE`) | Constraints | Índices além da PK |
|---|---|---|---|
| `tenants` | — | `nome` NOT NULL | — |
| `companies` | `(tenant_id, cnpj)` | `cnpj` NOT NULL | `(tenant_id)` |
| `users` | `(tenant_id, email)` | `role IN ('ADMIN','RECRUTADOR','DP','GESTOR_VAGA','AVALIADOR','ALMOXARIFADO')` | — |
| `jobs` | — | FK `company_id` | `(tenant_id, company_id)` |
| `candidates` | `(tenant_id, cpf)` | CPF só dígitos, 11 chars | — |
| `tickets` | `(tenant_id, protocolo)` | `status IN (10 valores)`; FK `job_id`, `candidate_id` | `(tenant_id, status)`, `(job_id)`, `(candidate_id)`, parcial `(tenant_id, prazo_sla) WHERE status NOT IN ('ADMITIDO','REPROVADO')` |
| `ticket_events` | — | append-only (trigger + REVOKE) | `(ticket_id, created_at)` |
| `messages` | — | `canal IN ('EMAIL','WHATSAPP','PORTAL')` | `(ticket_id, created_at)` |
| `documents` | `chave_storage` | `tipo`, `status`, `mime` com CHECK; `tamanho_bytes` 1..5 MB; `sha256` hex de 64; recusado exige `motivo`; app só atualiza `status`, `motivo`, `revisado_por` | `(tenant_id, ticket_id)` |

## Regras de carga e validação

| Tema | Regra |
|---|---|
| Idempotência | Candidatura repetida do mesmo CPF na mesma vaga não cria segundo chamado aberto; reenvio ao ERP usa `erp_ref` e nunca duplica o empregado |
| Dado inválido | CPF/PIS validados na API e por `CHECK` de formato no banco; candidato aprovado com qualificação cadastral divergente bloqueia o envio ao ERP |
| Datas e fuso | Instantes em `timestamptz` (UTC); datas de negócio (admissão, nascimento) em `date`, interpretadas em `America/Fortaleza` |
| Números | `numeric` para salário e tamanhos; nunca `float` |
| Protocolo | `ADM-AAAA-NNNNNN`, sequencial por tenant e ano (contador em tabela com lock de linha, não `max()+1`) |

## Volume esperado

| Tabela | Conta | Linhas em 1 ano | Linhas em 3 anos |
|---|---|---|---|
| `tickets` | 50 tenants x 40 admissões/mês x 12 x ~8 candidaturas por admissão | ~190 mil | ~580 mil |
| `ticket_events` | tickets x ~15 eventos | ~2,9 milhões | ~8,7 milhões |
| `messages` | tickets x ~6 | ~1,1 milhão | ~3,5 milhões |

Premissas a validar com o piloto; abaixo de dezenas de milhões de linhas não há particionamento (rever `ticket_events` se passar de ~30 milhões).

## Segurança, LGPD e retenção

| Item | Regra |
|---|---|
| Dado pessoal | CPF, contato, dependentes, dados bancários, ASO (saúde, dado sensível). Cliente é controlador; KRONOS é operador (DPA). Credenciais de ERP e `totp_secret` criptografados em repouso |
| Acesso (papéis) | `kronos_app` (RLS, sem BYPASSRLS, sem TRUNCATE em `ticket_events`); `kronos_migrator` só para migrations; ninguém usa o superusuário na aplicação |
| Retenção | Candidatos reprovados/desistentes: prazo configurável por tenant, depois anonimização (`anonimizado_em`); chamados admitidos seguem a guarda trabalhista definida com o jurídico |
| Backup | Diário, retenção a definir, em região Brasil. **Data do último treino de restauração: nunca realizado** (obrigatório antes do primeiro cliente pagante) |

## Migrations

| Migration | Conteúdo |
|---|---|
| `20261105000000_init` | Tabelas, uniques e índices gerados do `schema.prisma` (instantes em `timestamptz(3)`). FKs compostas `(tenant_id, id)` em jobs, tickets, ticket_events e messages: referência entre tenants é recusada pelo banco |
| `20261105000100_rls_roles` | RLS `FORCE` com política `tenant_isolation`, trigger append-only, CHECKs, índice parcial de SLA, papel `kronos_app` (sem BYPASSRLS) e `REVOKE UPDATE, DELETE, TRUNCATE` em `ticket_events` |
| `20261107000000_tenant_update_permissions` | Restringe UPDATE de `tenants` a `nome`, `cnpj` e `config`; plano e identidade ficam no provisionamento |
| `20261107000200_documents` | Tabela `documents` (metadados; arquivo no storage) com RLS, FK composta com `tickets`, CHECKs e `kronos_app` só com SELECT, INSERT e UPDATE de `status`, `motivo`, `revisado_por`. Contém dado pessoal (documentos de identidade): acesso só por download autenticado; remoção/anonimização entra na M2 |
| `20261107000300_acesso_por_empresa` | Acesso por empresa e por pessoa (LGPD): `companies.matriz_id` (um nível), `user_companies`, `ticket_assignments`, funções de visibilidade e políticas RLS restritivas. Exige que o papel da migration tenha BYPASSRLS (no Supabase, `postgres` já tem) |
| `20261107000400_protocol_counters` | `protocol_counters (tenant_id, ano, ultimo)` para o protocolo `ADM-AAAA-NNNNNN`, incrementado de forma atômica (`INSERT … ON CONFLICT DO UPDATE`). Não dá para usar `max(protocolo)`: o RLS por empresa esconde chamados de outras empresas e geraria repetidos. Só isolamento por tenant (não é dado pessoal) |
| `20261109000100_rls_escrita` | Separa **escrita de leitura** nas políticas restritivas de `tickets`, `candidates`, `documents` e `messages`: o ramo do candidato vale só para SELECT (e para enviar documento `PENDENTE` sem revisor e mensagem não interna). Criar chamado exige `can_see_job` mesmo com `candidateId` no contexto; aprovar/recusar documento exige equipe atribuída com papel RECRUTADOR/DP. `kronos_app` deixa de ler `users.password_hash` e `totp_secret` (grant por coluna) e só atualiza `protocol_counters.ultimo` |
| `20261109000200_admin_sem_vagas` | `can_see_job` e a política de `jobs` passam a exigir papel operacional (RECRUTADOR, DP, GESTOR_VAGA, AVALIADOR, ALMOXARIFADO). Antes, um ADMIN *vinculado* a uma empresa enxergava as vagas dela, contra a regra "ADMIN não vê vagas, chamados, candidatos nem documentos". Por `can_see_job`, a restrição vale também para chamados, candidatos, eventos, mensagens e documentos |
| `20261113000100_portal_sessao` | Função `auth_candidato(protocolo, cpf)` (`SECURITY DEFINER`): localiza tenant e candidato antes de haver contexto de RLS. Exige papel com BYPASSRLS na migration. Substituída em `…000200` e deixada de uso interno em `…000300` |
| `20261113000200_portal_sessao_ambigua` | `auth_candidato` devolve zero linhas quando protocolo + CPF existem em mais de um tenant (o número do protocolo é único só por tenant); nunca escolhe um tenant por `LIMIT 1` |
| `20261113000300_portal_link` | Entrada do candidato por link de uso único enviado ao e-mail: tabela `portal_links` (só o SHA-256 do código, validade de 15 min, `usado_em`) com RLS `FORCE` sem política e sem grant para `kronos_app`; acesso só pelas funções `auth_candidato_solicitar_link` (intervalo mínimo de 1 min por candidato, invalida links anteriores) e `auth_candidato_consumir_link` (atômica, uso único). `kronos_app` perde o EXECUTE de `auth_candidato`. A tabela está representada no `schema.prisma` para evitar divergência nas próximas migrations; os grants continuam proibindo acesso direto pela API |

Execute o teste com `psql -f apps/api/prisma/tests/rls_isolation.sql` usando uma conexão administrativa de desenvolvimento com todas as migrations aplicadas. O script habilita `ON_ERROR_STOP`: qualquer erro encerra o processo com falha e a conexão desfaz a transação. Inclui restrições de plano/identidade, DELETE de eventos e rejeição de referência a empresa de outro tenant.

Teste de isolamento: `apps/api/prisma/tests/rls_isolation.sql` (rodar num banco migrado; faz ROLLBACK). `id` é gerado pelo Prisma (UUID v7 no cliente), sem default no banco. `tenants` tem RLS pela própria `id`; o `kronos_app` só faz SELECT e UPDATE nela (criar tenant é provisionamento, fora da aplicação). `kronos_migrator` e a senha do `kronos_app` ficam por ambiente, fora do repositório.

## Perguntas em aberto

- Nomes e ordem exatos dos 10 status: conferir com o diagrama do PDF (era imagem) e ajustar o `CHECK` e `ticket-status.ts` juntos.
- Tabelas ainda não modeladas: `document_types`, `admission_data`, `erp_connections`, `erp_syncs`, `erp_lookups`, `tests*`, `signature_requests`, `contract_templates`, `uniform_*`. Entram em migrations próprias por módulo.
- Prazo de retenção da guarda de documentos admissionais (jurídico).
- Meta de RPO/RTO do backup.


## Acesso por empresa e por pessoa autorizada (LGPD)

Além do isolamento por tenant, os dados de uma empresa ficam fechados para ela. O banco aplica a regra (políticas RLS **restritivas**, somadas com AND ao isolamento por tenant); a API só informa o contexto de cada transação: `app.tenant_id`, `app.user_id`, `app.user_role` e, no portal, `app.candidate_id`. Sem contexto, nenhuma linha é devolvida.

| Quem | O que enxerga |
|---|---|
| Usuário vinculado a uma **filial** | Só a própria filial |
| Usuário vinculado à **matriz** | A matriz e todas as filiais (o inverso não vale) |
| Usuário sem vínculo com a empresa | Nada dela: nem vagas, chamados, candidatos, eventos, mensagens ou documentos |
| **ADMIN** | Gere cadastro de empresas, usuários e vínculos, mas **não** vê chamados, candidatos, vagas nem documentos |
| Documentos | Exigem vínculo com a empresa **e** atribuição ao chamado (`ticket_assignments`) |
| **Candidato** | Só o próprio cadastro, chamados, documentos e mensagens não internas |

Garantias no banco: ninguém se vincula nem se atribui sozinho (só ADMIN vincula; só RECRUTADOR/DP que opera o chamado atribui); atribuir exige que o atribuído já tenha vínculo com a empresa; matriz não pode ser filial e filial não tem filiais.

Premissas: quem cria o candidato declara `app.candidate_id` com o id novo (o `INSERT ... RETURNING` precisa enxergar a linha); o que cada papel *faz* (aprovar documento, avançar status) continua na API; a decisão do RH em documentos limita-se, por GRANT, às colunas `status`, `motivo` e `revisado_por`, e o banco (migration `20261109000100_rls_escrita`) recusa que o candidato altere chamado, decida o próprio documento ou apague o cadastro; a API continua sendo a primeira barreira. O login futuro lerá `password_hash`/`totp_secret` por função `SECURITY DEFINER` própria, não pelo papel `kronos_app`. O teste `apps/api/prisma/tests/rls_isolation.sql` cobre matriz/filial, ADMIN, atribuição, candidato e tenants.
