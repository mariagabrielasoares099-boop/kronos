# ADR-002 — Frontend em Python (FastAPI + Jinja2 + HTMX)

- **Status:** aceito (substitui a sugestão Next.js do escopo)
- **Data:** 2026-11-04

## Contexto
O escopo sugeria Next.js + TypeScript. A decisão do projeto é ter o frontend em Python. As telas são formulários, listas, kanban e linha do tempo; a página pública de vagas precisa abrir bem no celular e ser indexável.

## Decisão
`apps/web`: FastAPI + Jinja2 (autoescape ligado) + HTMX vendorizado (sem CDN, por causa da CSP `script-src 'self'`). O frontend nunca acessa o banco: toda leitura/escrita passa pela API NestJS (`HttpGateway`, a implementar). Enquanto a API não expõe os endpoints, o `DemoGateway` em memória alimenta as telas, e o painel só existe com `DEMO_MODE=true`.

## Alternativas descartadas
- **Django + HTMX:** traz auth e admin, mas duplica o back-end já feito em NestJS/Prisma.
- **Reflex / NiceGUI:** rápido de começar, pior em SEO, celular e kanban.
- **Streamlit:** adequado a protótipos e relatórios internos, não a portal público multiusuário.

## Consequências
- Validações de CPF/e-mail no web são só UX; a API é a autoridade (regra duplicada em dois lugares de propósito).
- Login, 2FA e sessão do RH e do candidato dependem do módulo 01 na API; até lá o painel não pode ir para produção.
- Duas stacks (Node na API, Python no web) exigem dois pipelines no CI.
