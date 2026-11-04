# Módulo 15 — IA: OCR de documentos e triagem

**Fase:** Fase 3

Leitura de documentos com conferência de CPF/nome/validade e triagem de currículos. Aplicável apenas se IA for usada.

## Entregas

- [ ] OCR com conferência automática
- [ ] Triagem de currículos assistida
- [ ] Suite de evals
- [ ] Moderação de entrada

## Os 10 passos neste módulo

| # | Passo | Aplicação |
|---|-------|-----------|
| 1 | Segredos e credenciais | Chaves de provedores de IA em cofre (Secrets Manager/Doppler/Vault). |
| 2 | Prompt injection e sanitização | Sanitização e moderação de entradas; documentos e currículos são conteúdo não confiável (injeção indireta). |
| 3 | Custos e rate limiting | Cotas por tenant, orçamento e alertas de gasto; limite de tokens. |
| 4 | Resiliência de APIs externas | Circuit breaker, backoff e fallback para conferência manual do DP. |
| 5 | Privacidade e LGPD | Verificar política de retenção/treino do provedor; DPA; decisão final sempre humana (LGPD art. 20). |
| 6 | Testes e evals | LLM Evals com conjunto de casos esperados antes de cada mudança de modelo/prompt. |
| 7 | DX e documentação | Coberto pela plataforma transversal (ver `docs/PASSOS.md`). |
| 8 | Monetização e licenciamento | Coberto pela plataforma transversal (ver `docs/PASSOS.md`). |
| 9 | Observabilidade e logs | Rastreamento de prompts, respostas, latência e custo (LangSmith/Phoenix/Datadog). |
| 10 | CI/CD e suporte | Coberto pela plataforma transversal (ver `docs/PASSOS.md`). |
