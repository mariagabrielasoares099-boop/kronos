# Módulo 08 — Comunicação (e-mail e WhatsApp)

**Fase:** Fase 1 (e-mail) / Fase 2 (WhatsApp)

Notificação a cada mudança de status com link ao chamado; resposta do candidato volta para a timeline.

## Entregas

- [ ] E-mail transacional por mudança de status
- [ ] WhatsApp API oficial da Meta (Fase 2)
- [ ] Webhook de entrada que alimenta a timeline
- [ ] Modelos e preferências

## Os 10 passos neste módulo

| # | Passo | Aplicação |
|---|-------|-----------|
| 1 | Segredos e credenciais | Tokens de e-mail/WhatsApp em cofre. |
| 2 | Prompt injection e sanitização | Sanitizar mensagens recebidas por webhook antes de gravar/exibir. |
| 3 | Custos e rate limiting | Cota e rate limit por tenant (cada mensagem tem custo). |
| 4 | Resiliência de APIs externas | Fila com retry, backoff e circuit breaker nos provedores. |
| 5 | Privacidade e LGPD | Opt-out e base legal para contato. |
| 6 | Testes e evals | Coberto pela plataforma transversal (ver `docs/PASSOS.md`). |
| 7 | DX e documentação | Coberto pela plataforma transversal (ver `docs/PASSOS.md`). |
| 8 | Monetização e licenciamento | Coberto pela plataforma transversal (ver `docs/PASSOS.md`). |
| 9 | Observabilidade e logs | Status de entrega e falhas registrados. |
| 10 | CI/CD e suporte | Coberto pela plataforma transversal (ver `docs/PASSOS.md`). |
