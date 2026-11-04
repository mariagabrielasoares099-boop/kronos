# Módulo 01 — Tenancy, usuários e permissões

**Fase:** Fase 1

Tenants, empresas, usuários, papéis (admin, recrutador, DP, gestor da vaga, avaliador, almoxarifado), 2FA para RH e isolamento por Row Level Security.

## Entregas

- [ ] Tabelas tenants, companies, users com tenant_id
- [ ] RLS no PostgreSQL em todas as tabelas de negócio
- [ ] RBAC por papel e por empresa; permissão 'Aprovar admissão'
- [ ] 2FA (TOTP) para usuários do RH
- [ ] Login do candidato por e-mail ou CPF com código

## Os 10 passos neste módulo

| # | Passo | Aplicação |
|---|-------|-----------|
| 1 | Segredos e credenciais | Segredos de JWT/sessão só em variáveis de ambiente; nada hardcoded. |
| 2 | Prompt injection e sanitização | Coberto pela plataforma transversal (ver `docs/PASSOS.md`). |
| 3 | Custos e rate limiting | Rate limit no login e no envio de código (anti força bruta e anti custo de SMS/e-mail). |
| 4 | Resiliência de APIs externas | Coberto pela plataforma transversal (ver `docs/PASSOS.md`). |
| 5 | Privacidade e LGPD | Isolamento entre clientes via tenant_id + RLS; operador/controlador (DPA). |
| 6 | Testes e evals | Testes automatizados de isolamento: tenant A nunca lê dados do tenant B. |
| 7 | DX e documentação | Documentar papéis e matriz de permissões. |
| 8 | Monetização e licenciamento | Coberto pela plataforma transversal (ver `docs/PASSOS.md`). |
| 9 | Observabilidade e logs | Log de autenticação e de ações sensíveis. |
| 10 | CI/CD e suporte | Coberto pela plataforma transversal (ver `docs/PASSOS.md`). |
