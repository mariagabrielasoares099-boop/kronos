# Módulo 12 — Planos, cobrança e licenciamento

**Fase:** Fase 2

SaaS por assinatura com mensalidade base + faixa de admissões, por empresa atendida para consultorias/escritórios; chaves/estado de licença.

## Entregas

- [ ] Planos e limites por tenant
- [ ] Gateway (Stripe, Paddle ou Mercado Pago) com webhooks
- [ ] Geração e validação de licença/entitlements
- [ ] Medição de admissões e chamados ativos
- [ ] Taxa de implantação

## Os 10 passos neste módulo

| # | Passo | Aplicação |
|---|-------|-----------|
| 1 | Segredos e credenciais | Chaves do gateway em cofre; webhooks com assinatura verificada. |
| 2 | Prompt injection e sanitização | Coberto pela plataforma transversal (ver `docs/PASSOS.md`). |
| 3 | Custos e rate limiting | Cotas por plano aplicadas na API (denial of wallet). |
| 4 | Resiliência de APIs externas | Webhooks idempotentes e reconciliação. |
| 5 | Privacidade e LGPD | Não armazenar dados de cartão (PCI via gateway). |
| 6 | Testes e evals | Testes de ciclo de assinatura e de bloqueio por inadimplência. |
| 7 | DX e documentação | Coberto pela plataforma transversal (ver `docs/PASSOS.md`). |
| 8 | Monetização e licenciamento | Este módulo implementa o passo 8 por completo. |
| 9 | Observabilidade e logs | Coberto pela plataforma transversal (ver `docs/PASSOS.md`). |
| 10 | CI/CD e suporte | Coberto pela plataforma transversal (ver `docs/PASSOS.md`). |
