# Módulo 11 — Assinatura digital e contratos

**Fase:** Fase 2

Modelos de contrato com variáveis, PDF gerado dos dados validados, conectores de assinatura (Clicksign, ZapSign, D4Sign, DocuSign) e evidências.

## Entregas

- [ ] contract_templates e signature_requests
- [ ] Camada de conectores de provedor de assinatura
- [ ] PDF assinado + relatório de evidências no chamado
- [ ] Bloqueio do envio ao ERP até todos assinarem

## Os 10 passos neste módulo

| # | Passo | Aplicação |
|---|-------|-----------|
| 1 | Segredos e credenciais | Tokens dos provedores em cofre. |
| 2 | Prompt injection e sanitização | Variáveis do modelo escapadas e validadas antes de gerar o PDF. |
| 3 | Custos e rate limiting | Coberto pela plataforma transversal (ver `docs/PASSOS.md`). |
| 4 | Resiliência de APIs externas | Retry e conciliação via webhook do provedor. |
| 5 | Privacidade e LGPD | Assinatura avançada/qualificada (Lei 14.063/2020); guarda de hash e evidências. |
| 6 | Testes e evals | Testes de geração de PDF e de fluxo de estados. |
| 7 | DX e documentação | Coberto pela plataforma transversal (ver `docs/PASSOS.md`). |
| 8 | Monetização e licenciamento | Coberto pela plataforma transversal (ver `docs/PASSOS.md`). |
| 9 | Observabilidade e logs | Coberto pela plataforma transversal (ver `docs/PASSOS.md`). |
| 10 | CI/CD e suporte | Coberto pela plataforma transversal (ver `docs/PASSOS.md`). |
