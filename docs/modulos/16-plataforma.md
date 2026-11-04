# Módulo 16 — Plataforma transversal (os 10 passos)

**Fase:** 1 em diante. Infraestrutura compartilhada que sustenta os 10 passos em todos os módulos.

## Entregas
- [ ] **P1** Gestão de segredos: `.env.example`, cofre (Doppler/AWS Secrets Manager), gitleaks no CI, criptografia de credenciais
- [ ] **P2** Camada de validação/sanitização (DTOs com class-validator, escape de saída, moderação para fluxos de IA)
- [ ] **P3** Rate limiting global (Redis) e cotas por tenant; alertas de gasto
- [ ] **P4** Biblioteca de resiliência (retry/backoff, circuit breaker) usada por todos os clientes externos
- [ ] **P5** Política de retenção, anonimização, exportação/exclusão de dados, DPA e política de privacidade (revisão jurídica)
- [ ] **P6** Estratégia de testes (unit, integração, E2E, isolamento de tenant) e harness de evals
- [ ] **P7** Swagger/OpenAPI e portal de documentação
- [ ] **P9** Logs estruturados, tracing OpenTelemetry, dashboards e alertas; rastreio de IA
- [ ] **P10** GitHub Actions: lint, testes, build, gitleaks, deploy; versionamento e changelog; canal de suporte/central de ajuda
- [ ] Backups diários, HTTPS em tudo, testes de segurança antes do primeiro cliente pagante

## Os 10 passos
Ver [`../PASSOS.md`](../PASSOS.md). Este módulo é o dono dos passos 1, 2, 3, 4, 5, 6, 9 e 10.
