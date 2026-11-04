# Os 10 passos — checklist transversal

Todo módulo precisa cumprir (ou justificar a não aplicabilidade de) cada passo. A tabela por módulo está em `docs/modulos/`.

| # | Passo | Definição de pronto (DoD) | Onde vive |
|---|-------|---------------------------|-----------|
| 1 | Segredos e credenciais | Zero segredo no código; `.env.example`; cofre em produção; gitleaks no CI; credenciais de ERP criptografadas | 16-plataforma, 09 |
| 2 | Prompt injection e sanitização | Toda entrada validada/sanitizada; moderação antes de enviar a LLM; conteúdo de documentos tratado como não confiável | 16-plataforma, 04, 06, 15 |
| 3 | Custos e rate limiting | Rate limit por usuário/IP/tenant; cotas por plano; alertas de gasto (e-mail, WhatsApp, IA) | 16-plataforma, 12 |
| 4 | Resiliência | Retry com backoff exponencial, circuit breaker, fallback e estado "aguardando ERP" | 09, 08, 11 |
| 5 | LGPD/GDPR | Consentimento, retenção/anonimização, direitos do titular, DPA, TLS e criptografia em repouso, dados no Brasil | 01, 04, 16-plataforma |
| 6 | Testes e evals | Testes unitários/integração/E2E; testes de isolamento entre tenants; evals de IA antes de produção | todos |
| 7 | DX e documentação | OpenAPI/Swagger, exemplos Python e Node.js, endpoints intuitivos | 14, todos |
| 8 | Monetização e licenciamento | Gateway de pagamento, planos, validação de licença/entitlements | 12 |
| 9 | Observabilidade | Logs estruturados, tracing, métricas de latência/erros, rastreio de IA (LangSmith/Phoenix/Datadog) | 16-plataforma |
| 10 | CI/CD e suporte | GitHub Actions (testes, lint, scan), deploy sem downtime, canal de suporte/central de ajuda | 16-plataforma |
