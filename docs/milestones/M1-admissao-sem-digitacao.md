# Milestone 1 — MVP: Admissão sem digitação

**Objetivo:** fluxo ponta a ponta funcional com dados mockados/básicos: o candidato envia documentos, o RH trabalha numa fila, e o aprovado sai do KRONOS num arquivo pronto para importar no ERP, sem redigitar nada.

**Critério de pronto (demo):** um candidato de teste percorre `TRIAGEM → … → ENVIO_ERP → ADMITIDO`, envia 3 documentos, o RH aprova, e o download do arquivo no formato do ERP escolhido importa sem ajuste manual.

**Fora do escopo (vai para M2/M3):** validação estrita Zod em todas as bordas, bloqueio por documento aprovado, anonimização LGPD, demais ERPs.

## Mapa: etapas × módulos

| Etapa | Entrega | Módulos (`docs/modulos/`) | Issue da milestone |
|---|---|---|---|
| 1. Domínio | Entidade Chamado/Admissão (DDD) | 02 Chamados, 07 Admissão | Criar entidade base do Chamado/Admissão |
| 2. Documentos | API de upload do candidato | 06 Documentos, 04 Portal | Criar API de upload de documentos |
| 3. Fila do RH | Tela da fila + aprovar/recusar | 05 Painel RH | Implementar tela da fila do RH |
| 4. Exportação | Arquivo para 1 ERP | 09 Conectores (arquivo), 07 Admissão | Gerar arquivo exportável (Fortes ou Totvs) |

Dependências: 1 → 2 → 3 → 4. A etapa 1 destrava todas; 3 pode começar em paralelo com 2 usando dados mockados.

## Etapa 1 — Domínio do Chamado/Admissão (DDD)
**Módulos:** 02, 07 · **Onde:** `apps/api/src/domain/` e `apps/api/src/chamados/`

Já existe: `ticket-status.ts` (10 status, retornos), `protocol.ts`, `br-docs.ts`, modelos Prisma `Ticket`, `TicketEvent`, `Candidate`, migrações com RLS.

- [ ] Agregado `Chamado` (id, protocolo, status, candidato, vaga, `erpRef`) com métodos `avancar()`, `devolver(motivo)`, `reprovar()` que usam a máquina de estados existente
- [ ] Value objects: `Cpf`, `Protocolo`, `StatusChamado` (reaproveitar `br-docs.ts`/`protocol.ts`)
- [ ] Entidade `Admissao` com dados no formato canônico (subconjunto do S-2200: nome, CPF, nascimento, endereço, cargo, salário, data de admissão)
- [ ] Porta `ChamadoRepository` (interface) + adaptador Prisma, sempre dentro do contexto de tenant (RLS)
- [ ] Todo evento de mudança grava em `ticket_events` (append-only)
- [ ] Módulo Nest `ChamadosModule`: `POST /chamados`, `GET /chamados/:protocolo`, `POST /chamados/:id/transicoes`
- [ ] Testes unitários das transições válidas e inválidas

**Pronto quando:** transições inválidas são rejeitadas por testes e cada transição aparece em `ticket_events`.

## Etapa 2 — API de upload de documentos
**Módulos:** 06, 04 · **Onde:** `apps/api/src/documentos/`

Atenção ao custo zero: armazenamento em disco local (ou MinIO no compose), atrás de uma porta `StoragePort` para trocar depois.

- [ ] Modelo `Document` (chamado, tipo, status `PENDENTE|APROVADO|RECUSADO`, motivo, caminho, hash, tamanho) + migração com RLS
- [ ] `POST /chamados/:id/documentos` (multipart; limite de tamanho; só JPG/PNG/PDF conferindo o conteúdo, não só a extensão)
- [ ] `GET /chamados/:id/documentos` e download autenticado (sem URL pública)
- [ ] `PATCH /documentos/:id` aprovar/recusar com motivo (usado pela etapa 3)
- [ ] Checklist por vaga mockado (RG, CPF, comprovante de residência)
- [ ] Rate limit já global (Throttler); testes de tipo inválido, arquivo grande e acesso entre tenants

**Pronto quando:** upload pelo portal (`/chamado/{protocolo}` no web) aparece na API e nenhum outro tenant consegue ler o arquivo.

## Etapa 3 — Tela da fila do RH
**Módulos:** 05 · **Onde:** `apps/web/app/` (`painel.html`, `chamado.html`) e gateway para a API

Já existe: rota `/painel` em modo demo.

- [ ] Fila com colunas: protocolo, candidato, vaga, status, responsável, SLA (atrasado/no prazo)
- [ ] Filtro por status e busca por protocolo/CPF
- [ ] Detalhe do chamado: linha do tempo (`ticket_events`) + lista de documentos com visualizar/aprovar/recusar (HTMX, sem recarregar a página)
- [ ] Ação "Enviar ao ERP" habilitada só em `VALIDACAO_DP`/`ASSINATURA` conforme o fluxo (a trava forte por documento aprovado fica na M2)
- [ ] Substituir os dados do modo demo por chamadas ao gateway quando `DEMO_MODE=false`
- [ ] Testes `pytest` das rotas e dos fragmentos HTMX

**Pronto quando:** o RH aprova/recusa um documento e o status e a linha do tempo atualizam na tela.

## Etapa 4 — Exportação para 1 ERP
**Módulos:** 09, 07 · **Onde:** `apps/api/src/integracoes/`

Dependência de decisão: issue #17 (quais ERPs aceitam importação por arquivo e em qual formato). **Escolha Fortes ou Totvs só depois de ela estar respondida**, senão o layout é chute.

- [ ] Porta `ErpConnector` (`exportar(admissao): ArquivoExportacao`) na camada de domínio/aplicação
- [ ] Adaptador do ERP escolhido (primeiro: CSV/TXT conforme layout do ERP) em `integracoes/<erp>/`
- [ ] `GET /chamados/:id/exportacao?erp=<erp>` gera o arquivo e registra evento no chamado + `erpRef`
- [ ] Idempotência: exportar duas vezes não duplica registro nem muda `erpRef`
- [ ] Teste de contrato: arquivo gerado bate com um arquivo de exemplo do layout oficial
- [ ] Botão de download no detalhe do chamado (etapa 3)

**Pronto quando:** o arquivo gerado para o candidato de teste é aceito pelo importador do ERP (ou, sem acesso ao ERP, validado contra o layout documentado).

## Ordem sugerida de PRs
1. `feat(chamados): agregado, repositório e transições`
2. `feat(documentos): upload, storage e validação`
3. `feat(web): fila do RH e detalhe do chamado`
4. `feat(integracoes): porta ErpConnector e exportação <erp>`

Cada PR com testes e sem tocar em RLS sem rodar `prisma/tests/rls_isolation.sql`.

## Riscos
- **Layout do ERP desconhecido** → depende da issue #17; sem ela, a etapa 4 fica só com a porta e um formato canônico CSV/JSON.
- **Nomes/ordem dos 10 status inferidos** (aviso em `ticket-status.ts`) → conferir com o diagrama do `escopo-produto.pdf` antes da etapa 1 ir longe.
- **Arquivos sensíveis** (documentos pessoais) → mesmo no MVP, sem URL pública e sempre dentro do tenant.

## Relação com M2 e M3
- **M2 — Validações & LGPD:** Zod nas bordas criadas aqui, bloqueio de envio sem CPF/documentos aprovados, anonimização de não contratados.
- **M3 — Ecossistema de ERPs:** a porta `ErpConnector` da etapa 4 é o ponto de extensão; Domínio, Alterdata e Senior viram novos adaptadores sem mexer no domínio.
