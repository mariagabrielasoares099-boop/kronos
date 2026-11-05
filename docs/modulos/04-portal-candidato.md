# Módulo 04 — Portal do candidato

**Fase:** Fase 1

Candidatura com currículo, acompanhamento do chamado, envio de documentos pelo celular, formulário admissional e direitos do titular.

## Entregas

- [ ] FastAPI + Jinja2 + HTMX (apps/web), mobile first
- [ ] Candidatura com aceite de consentimento LGPD
- [ ] Acompanhamento e pendências do chamado
- [ ] Download/exclusão dos próprios dados

## Os 10 passos neste módulo

| # | Passo | Aplicação |
|---|-------|-----------|
| 1 | Segredos e credenciais | Nenhuma chave no front-end além de chaves públicas. |
| 2 | Prompt injection e sanitização | Sanitizar toda entrada do candidato (campos, nome de arquivo, mensagens). |
| 3 | Custos e rate limiting | Rate limit por IP/CPF em candidatura e upload. |
| 4 | Resiliência de APIs externas | Coberto pela plataforma transversal (ver `docs/PASSOS.md`). |
| 5 | Privacidade e LGPD | Consentimento registrado, finalidade clara, exportação e exclusão pelo portal. |
| 6 | Testes e evals | Testes E2E do fluxo candidatura -> upload. |
| 7 | DX e documentação | Coberto pela plataforma transversal (ver `docs/PASSOS.md`). |
| 8 | Monetização e licenciamento | Coberto pela plataforma transversal (ver `docs/PASSOS.md`). |
| 9 | Observabilidade e logs | Coberto pela plataforma transversal (ver `docs/PASSOS.md`). |
| 10 | CI/CD e suporte | Coberto pela plataforma transversal (ver `docs/PASSOS.md`). |
