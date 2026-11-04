# Módulo 02 — Chamados (tickets), status e SLA

**Fase:** Fase 1

Núcleo do produto: cada candidatura é um chamado com protocolo único (ADM-AAAA-NNNNNN), 10 status, 2 retornos, SLA por etapa e trilha de auditoria.

## Entregas

- [ ] tickets, ticket_events (append-only), messages
- [ ] Máquina de estados dos 10 status; 'Envio ao ERP' e 'Admitido' fixos
- [ ] SLA por etapa com alerta de atraso (jobs na fila)
- [ ] Notas internas invisíveis ao candidato
- [ ] Protocolo único e erp_ref

## Os 10 passos neste módulo

| # | Passo | Aplicação |
|---|-------|-----------|
| 1 | Segredos e credenciais | Coberto pela plataforma transversal (ver `docs/PASSOS.md`). |
| 2 | Prompt injection e sanitização | Coberto pela plataforma transversal (ver `docs/PASSOS.md`). |
| 3 | Custos e rate limiting | Coberto pela plataforma transversal (ver `docs/PASSOS.md`). |
| 4 | Resiliência de APIs externas | Coberto pela plataforma transversal (ver `docs/PASSOS.md`). |
| 5 | Privacidade e LGPD | Reprovados encerram e entram na regra de retenção/anonimização. |
| 6 | Testes e evals | Testes de transição de status (válidas e inválidas) e de SLA. |
| 7 | DX e documentação | OpenAPI dos endpoints de chamado. |
| 8 | Monetização e licenciamento | Coberto pela plataforma transversal (ver `docs/PASSOS.md`). |
| 9 | Observabilidade e logs | ticket_events é a trilha de auditoria: quem, quando, por quê. |
| 10 | CI/CD e suporte | Migrações versionadas e sem downtime. |
