# KRONOS em uma página

## Em uma frase
Um sistema em que **cada candidato vira um "chamado"**, como num help desk, e é acompanhado da candidatura até estar **cadastrado na folha de pagamento**, sem ninguém redigitar nada.

## O problema
Hoje o recrutamento acontece num lugar (Gupy, planilha, e-mail) e a admissão em outro (WhatsApp para pedir documentos, digitação manual no sistema de folha). Resultado: o RH digita tudo duas vezes, perde documentos e não sabe em que etapa cada pessoa está.

## Como o KRONOS resolve
1. **O candidato** se candidata, acompanha o chamado e envia os documentos pelo celular, num portal próprio.
2. **O RH** trabalha numa fila de chamados com status, responsável e prazo (SLA), e aprova ou recusa cada documento com um motivo.
3. **Quando o candidato é aprovado**, os dados já validados viram um pré-cadastro e seguem para o sistema de folha (ERP) do cliente.

Cada chamado tem um número único, por exemplo `ADM-2026-000123`. Esse número continua valendo depois da contratação e fica gravado no ERP, então qualquer divergência pode ser rastreada.

## O caminho de um chamado
O chamado passa por 10 status, da triagem até **Admitido**. Ele só chega em "Admitido" depois que o ERP confirma o cadastro.

Existem dois retornos:
- **Documento recusado:** o chamado volta para o candidato, com o motivo.
- **Erro no ERP:** o chamado volta para a fila do DP, com a mensagem de erro.

Antes de enviar ao ERP, o sistema faz uma validação final automática (CPF, documentos aprovados, contrato assinado, cargo existente no ERP), e uma pessoa com permissão precisa autorizar.

## Ponto importante: o ERP
Cada cliente usa um ERP diferente (Fortes, Domínio, Alterdata, Totvs, Senior). Por isso o KRONOS guarda os dados num **formato próprio** e cada ERP é um **conector** que traduz esse formato. Assim o sistema não depende de um ERP só. Quem transmite a admissão ao eSocial é o ERP do cliente, não o KRONOS.

## Para quem vendemos
- Empresas médias (100 a 2.000 funcionários) que usam qualquer ERP de folha.
- Consultorias de RH e de recrutamento.
- Escritórios contábeis que fazem a folha dos clientes.

Modelo de negócio: assinatura mensal, cobrada pelo volume de admissões, mais uma taxa de implantação. Os preços ainda precisam ser validados com clientes.

**Diferencial:** não competimos com a Gupy. Ela é forte em atrair e triar candidatos. Nós cuidamos do trecho seguinte, da aprovação até o funcionário cadastrado, e podemos receber candidatos aprovados vindos dela.

## Fases do produto
| Fase | O que entrega |
|---|---|
| 1 - MVP | Vagas, portal do candidato, fila de chamados, validação de documentos, formulário admissional (com uniforme e EPI), exportação do pré-cadastro e e-mail |
| 2 - Vendável | Planos e cobrança, WhatsApp, testes de qualificação, assinatura digital do contrato, primeiro conector de ERP, relatórios |
| 3 - Escala | Parcerias oficiais com ERPs, mais conectores, IA para ler documentos, API pública |

## Segurança e LGPD (requisito de venda)
O sistema guarda documentos pessoais e dados sensíveis (saúde, dependentes, bancários). Por isso:
- A empresa cliente é a controladora dos dados e o KRONOS é o operador, com contrato (DPA).
- O candidato dá consentimento na candidatura e pode pedir os dados ou a exclusão pelo portal.
- Candidatos não contratados são anonimizados depois de um prazo configurável.
- Documentos ficam em armazenamento privado, com links temporários, e cada acesso é registrado.
- Os dados de cada cliente são isolados no banco.

## Como estamos construindo
- **Back-end:** NestJS (TypeScript) com banco PostgreSQL.
- **Frontend:** Python (FastAPI + Jinja2 + HTMX).
- **Repositório:** GitHub privado `kronos`, com 3 milestones (uma por fase) e uma issue por módulo, 16 no total. Cada módulo segue os 10 passos de segurança, qualidade e comercialização (`docs/PASSOS.md`).

## Em que ponto estamos
- Planejamento e documentação prontos: escopo, arquitetura, modelo de dados e módulos.
- Já existem a base da API, as regras do chamado (status, protocolo, CPF e PIS) e as telas iniciais de vagas, candidatura, acompanhamento e fila, com dados de exemplo.
- Ainda não existem login, upload de documentos, integração real com ERP nem a ligação entre frontend e API.

## Decisões que ainda dependem de conversa
- Quais ERPs dos primeiros clientes aceitam importar funcionários por arquivo, e em que formato.
- Se o foco inicial é empresas que contratam direto ou escritórios contábeis.
- Se o exame admissional (ASO) entra no fluxo desde o começo.
- Conferir o diagrama dos 10 status (a ordem atual foi inferida do texto).

## Onde ler mais
- `docs/escopo-produto.pdf`: escopo completo.
- `docs/ARQUITETURA.md` e `docs/DADOS.md`: como é construído.
- `docs/modulos/`: o que cada módulo entrega.
