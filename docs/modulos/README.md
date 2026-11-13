# Módulos

| Módulo | Fase | Resumo |
|--------|------|--------|
| [01 Tenancy, usuários e permissões](01-tenancy-auth.md) | Fase 1 | Tenants, empresas, usuários, papéis (admin, recrutador, DP, gestor da vaga, avaliador, almoxarifado), 2FA para RH e isolamento por Row Level Security. |
| [02 Chamados (tickets), status e SLA](02-chamados.md) | Fase 1 | Núcleo do produto: cada candidatura é um chamado com protocolo único (ADM-AAAA-NNNNNN), 10 status, 2 retornos, SLA por etapa e trilha de auditoria. |
| [03 Vagas, etapas e checklist](03-vagas.md) | Fase 1 | Vagas por empresa com fluxo configurável (etapas, SLAs, checklist de documentos, teste, nota de corte). |
| [04 Portal do candidato](04-portal-candidato.md) | Fase 1 | Candidatura com currículo, acompanhamento do chamado, envio de documentos pelo celular, formulário admissional e direitos do titular. |
| [05 Painel do RH (fila de chamados)](05-painel-rh.md) | Fase 1 | Kanban por etapa, lista com filtros e SLA, detalhe com linha do tempo, ações em lote e modelos de mensagem. |
| [06 Documentos e armazenamento seguro](06-documentos.md) | Fase 1 | Upload (foto/PDF), checklist com status por item, validação (aprovar/recusar com motivo), alertas de vencido/ilegível, validação de CPF/PIS. |
| [07 Admissão, uniforme/EPI e modelo canônico](07-admissao.md) | Fase 1 | Formulário admissional, modelo canônico baseado no S-2200 do eSocial, tamanhos de uniforme/EPI (CA), exportação CSV/JSON e validação final. |
| [08 Comunicação (e-mail e WhatsApp)](08-comunicacao.md) | Fase 1 (e-mail) / Fase 2 (WhatsApp) | Notificação a cada mudança de status com link ao chamado; resposta do candidato volta para a timeline. |
| [09 Conectores de ERP e fila de sincronização](09-integracoes-erp.md) | Fase 1 (arquivo) / Fase 2 (1º conector) / Fase 3 | Camada de conectores com interface única (importar tabelas, enviar pré-cadastro, consultar resultado). Caminhos: arquivo, agente local, parceria oficial. |
| [10 Testes de qualificação](10-testes-qualificacao.md) | Fase 2 | Banco de testes por cargo, nota de corte, correção automática, fila de avaliador e controles anti-cola. |
| [11 Assinatura digital e contratos](11-assinatura-digital.md) | Fase 2 | Modelos de contrato com variáveis, PDF gerado dos dados validados, conectores de assinatura (Clicksign, ZapSign, D4Sign, DocuSign) e evidências. |
| [12 Planos, cobrança e licenciamento](12-billing-licencas.md) | Fase 2 | SaaS por assinatura com mensalidade base + faixa de admissões, por empresa atendida para consultorias/escritórios; chaves/estado de licença. |
| [13 Administração e relatórios](13-relatorios.md) | Fase 2 | Tempo médio por etapa, funil por vaga, gargalos de documentos, SLA e métricas do piloto. |
| [14 API pública e webhooks](14-api-publica.md) | Fase 3 | API pública versionada, chaves de API por tenant, webhooks para clientes e importação de aprovados da Gupy. |
| [15 IA: OCR de documentos e triagem](15-ia-ocr.md) | Fase 3 | Leitura de documentos com conferência de CPF/nome/validade e triagem de currículos. Aplicável apenas se IA for usada. |
| [16 Plataforma transversal (10 passos)](16-plataforma.md) | Fase 1 em diante | Segredos, sanitização, rate limit, resiliência, LGPD, testes, observabilidade, CI/CD |

Decisões de arquitetura ligadas aos módulos: [ADR-003 — Escopo de IA generativa na demo](ADR-003-escopo-ia-demo.md).
