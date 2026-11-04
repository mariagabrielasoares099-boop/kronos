# Módulo 14 — API pública e webhooks

**Fase:** Fase 3

API pública versionada, chaves de API por tenant, webhooks para clientes e importação de aprovados da Gupy.

## Entregas

- [ ] OpenAPI/Swagger publicado
- [ ] Chaves de API com escopo e rotação
- [ ] Webhooks de saída assinados com retry
- [ ] Exemplos em Python e Node.js
- [ ] Importador Gupy

## Os 10 passos neste módulo

| # | Passo | Aplicação |
|---|-------|-----------|
| 1 | Segredos e credenciais | Chaves de API com hash no banco, escopo e rotação. |
| 2 | Prompt injection e sanitização | Coberto pela plataforma transversal (ver `docs/PASSOS.md`). |
| 3 | Custos e rate limiting | Rate limit e cota por chave. |
| 4 | Resiliência de APIs externas | Webhooks de saída com backoff e dead-letter. |
| 5 | Privacidade e LGPD | Coberto pela plataforma transversal (ver `docs/PASSOS.md`). |
| 6 | Testes e evals | Coberto pela plataforma transversal (ver `docs/PASSOS.md`). |
| 7 | DX e documentação | Este módulo implementa o passo 7: Swagger/OpenAPI e exemplos. |
| 8 | Monetização e licenciamento | Uso da API atrelado ao plano. |
| 9 | Observabilidade e logs | Coberto pela plataforma transversal (ver `docs/PASSOS.md`). |
| 10 | CI/CD e suporte | Coberto pela plataforma transversal (ver `docs/PASSOS.md`). |
