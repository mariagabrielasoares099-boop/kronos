# Módulo 10 — Testes de qualificação

**Fase:** Fase 2

Banco de testes por cargo, nota de corte, correção automática, fila de avaliador e controles anti-cola.

## Entregas

- [ ] tests, test_questions, test_attempts
- [ ] Múltipla escolha, dissertativa, prático e perfil
- [ ] Nota de corte: revisão ou encerramento automático
- [ ] Anti-cola: tempo, embaralhamento, saídas da aba
- [ ] Plataformas de terceiros por webhook (Fase 3)

## Os 10 passos neste módulo

| # | Passo | Aplicação |
|---|-------|-----------|
| 1 | Segredos e credenciais | Coberto pela plataforma transversal (ver `docs/PASSOS.md`). |
| 2 | Prompt injection e sanitização | Respostas dissertativas e links são entrada não confiável; sanitizar. |
| 3 | Custos e rate limiting | Coberto pela plataforma transversal (ver `docs/PASSOS.md`). |
| 4 | Resiliência de APIs externas | Webhooks de terceiros com retry e verificação de assinatura. |
| 5 | Privacidade e LGPD | Teste de perfil é apoio à decisão, nunca critério único de eliminação. |
| 6 | Testes e evals | Testes de pontuação e de nota de corte. |
| 7 | DX e documentação | Coberto pela plataforma transversal (ver `docs/PASSOS.md`). |
| 8 | Monetização e licenciamento | Coberto pela plataforma transversal (ver `docs/PASSOS.md`). |
| 9 | Observabilidade e logs | Coberto pela plataforma transversal (ver `docs/PASSOS.md`). |
| 10 | CI/CD e suporte | Coberto pela plataforma transversal (ver `docs/PASSOS.md`). |
