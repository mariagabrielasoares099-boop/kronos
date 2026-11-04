# Módulo 09 — Conectores de ERP e fila de sincronização

**Fase:** Fase 1 (arquivo) / Fase 2 (1º conector) / Fase 3

Camada de conectores com interface única (importar tabelas, enviar pré-cadastro, consultar resultado). Caminhos: arquivo, agente local, parceria oficial.

## Entregas

- [ ] Interface de conector + exportação de arquivo
- [ ] Fila Redis + BullMQ, envio idempotente (erp_ref)
- [ ] erp_connections com credenciais criptografadas
- [ ] erp_syncs e erp_lookups (cargos, departamentos, centros de custo, sindicatos)
- [ ] Agente local .NET/Node
- [ ] Fortes, Domínio, Alterdata, Totvs, Senior (por demanda)

## Os 10 passos neste módulo

| # | Passo | Aplicação |
|---|-------|-----------|
| 1 | Segredos e credenciais | Credenciais de ERP criptografadas, nunca exibidas após salvas. |
| 2 | Prompt injection e sanitização | Coberto pela plataforma transversal (ver `docs/PASSOS.md`). |
| 3 | Custos e rate limiting | Rate limit por conexão para não sobrecarregar o ERP do cliente. |
| 4 | Resiliência de APIs externas | Retry com backoff exponencial, circuit breaker e estado 'aguardando ERP'. |
| 5 | Privacidade e LGPD | Dados trafegam por TLS; agente local autenticado. |
| 6 | Testes e evals | Testes de contrato por conector e de idempotência. |
| 7 | DX e documentação | Documentar a interface do conector para novos ERPs. |
| 8 | Monetização e licenciamento | Coberto pela plataforma transversal (ver `docs/PASSOS.md`). |
| 9 | Observabilidade e logs | Cada envio e resposta registrado no chamado. |
| 10 | CI/CD e suporte | Coberto pela plataforma transversal (ver `docs/PASSOS.md`). |
