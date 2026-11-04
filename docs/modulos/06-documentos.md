# Módulo 06 — Documentos e armazenamento seguro

**Fase:** Fase 1

Upload (foto/PDF), checklist com status por item, validação (aprovar/recusar com motivo), alertas de vencido/ilegível, validação de CPF/PIS.

## Entregas

- [ ] Storage privado (S3/R2/MinIO) com criptografia
- [ ] URLs assinadas que expiram em minutos
- [ ] Log de quem viu/baixou cada documento
- [ ] Validação de CPF e PIS
- [ ] Recusa devolve o chamado ao candidato
- [ ] Antivírus/validação de tipo e tamanho de arquivo

## Os 10 passos neste módulo

| # | Passo | Aplicação |
|---|-------|-----------|
| 1 | Segredos e credenciais | Credenciais de storage via cofre/variáveis de ambiente. |
| 2 | Prompt injection e sanitização | Validar MIME real, tamanho e nome de arquivo; nunca confiar na extensão. |
| 3 | Custos e rate limiting | Cota de upload por chamado e por tenant. |
| 4 | Resiliência de APIs externas | Retry/backoff no storage; fallback gracioso. |
| 5 | Privacidade e LGPD | Dados sensíveis (ASO): criptografia em repouso e em trânsito; acesso auditado. |
| 6 | Testes e evals | Testes de validação de CPF/PIS e de expiração de URL. |
| 7 | DX e documentação | Coberto pela plataforma transversal (ver `docs/PASSOS.md`). |
| 8 | Monetização e licenciamento | Coberto pela plataforma transversal (ver `docs/PASSOS.md`). |
| 9 | Observabilidade e logs | Auditoria de visualização/download. |
| 10 | CI/CD e suporte | Coberto pela plataforma transversal (ver `docs/PASSOS.md`). |
