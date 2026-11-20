# PRODUCT.md — KRONOS

> Fonte: `docs/RESUMO.md`, `docs/ARQUITETURA.md` e o código atual. Fatos inferidos do repositório, ainda não confirmados em entrevista com o usuário, estão marcados com **(inferido)**.

## O que é
Sistema em que cada candidato vira um **chamado** (como num help desk), acompanhado da candidatura até estar cadastrado na folha de pagamento, sem redigitação. Protocolo único por chamado, por exemplo `ADM-2026-000123`.

## Plataforma
`web` (FastAPI + Jinja2 + HTMX). Mobile web importa: o candidato envia documentos pelo celular.

## Stack
Decidida: FastAPI + Jinja2 + HTMX no front, NestJS + PostgreSQL na API. Sem React, Tailwind ou shadcn hoje. Migrar é decisão do usuário, ainda não tomada.

## Usuários e tarefas
| Usuário | Situação | Tarefa principal | Modo |
|---|---|---|---|
| Candidato | Celular, pouca paciência, dados sensíveis | Candidatar-se, acompanhar o chamado, enviar documentos | Operate (portal de vagas é Persuade leve) |
| Analista de RH / DP | Desktop, fila longa, o dia todo | Triar a fila, aprovar ou recusar documento com motivo, respeitar SLA | Operate |
| Gestor / admin **(inferido)** | Ocasional | Ver indicadores e exportar | Operate |

## Mecanismo diferente
Não compete com a Gupy (atrair e triar). Cuida do trecho **aprovação até funcionário cadastrado no ERP**. O chamado só vira "Admitido" depois que o ERP confirma.

## Fatos que o design precisa preservar
- 10 status por chamado; dois retornos visíveis: **documento recusado** (volta ao candidato, com motivo) e **erro no ERP** (volta à fila do DP, com mensagem).
- SLA tem três estados: no prazo, vencendo, atrasado.
- Documento tem três estados: pendente, aprovado, recusado.
- Autorização humana antes do envio ao ERP.
- LGPD: dados sensíveis (saúde, dependentes, bancários). Tela de consentimento, direito de acesso e exclusão.
- Demo sem comprador: custo zero, só free tier e local. **Sem CDN, sem fonte externa, CSP `style-src 'self'`.**

## Restrições de acessibilidade
Meta: WCAG 2.2 AA. Português do Brasil (`lang="pt-BR"`), com acentuação correta.

## Voz
Direta, sem jargão de RH, sem caixa-alta decorativa. Erro diz o que houve e o que fazer.

## Decisões em aberto
- Confirmar os usuários marcados **(inferido)**.
- Migração de stack (ver Stack).
- Dark mode: não existe hoje; não decidido.
