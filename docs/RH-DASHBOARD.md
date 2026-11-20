# Visão do analista de RH

Interface em `/rh/dashboard`, com CSS e JavaScript locais, Jinja2 e HTMX.
O painel anterior em `/painel/fila` continua disponível. Não usa Tailwind CDN,
SDK de IA ou exceções de CSP. Não há novas migrations.

## Executar

No diretório `apps/web`, use o ambiente Python habitual do projeto:

```powershell
$env:DEMO_MODE = 'true'
python -m uvicorn app.main:app --reload
```

Abra `http://localhost:8000/rh/dashboard`. Para usar a API real, configure
`DEMO_MODE=false`, `API_BASE_URL` e `SESSION_SECRET`, e entre em `/login`.
O token da equipe segue nas chamadas da API, que aplica papel, tenant,
empresa e atribuição. É possível assumir um chamado pela nova interface.

## Escopo

- Fila com busca, filtro, SLA e seleção persistente por HTMX.
- Três abas: resumo, documentos e histórico/ERP.
- Aprovação e recusa manual com motivo, sem envio automático de mensagens.
- Download autenticado pelo fluxo existente do painel.
- IA, match, OCR e perguntas personalizadas ainda não estão implementados.
  A integração futura será centralizada no NestJS; não há scores simulados.
- A exportação é apenas uma prévia JSON, identificada como não importável,
  com campos pendentes. O layout oficial depende da issue #17.
- O histórico é somente leitura. A API continua sendo a fonte oficial.
- Links de chamados e abas abrem páginas completas quando não há JavaScript.

## Verificar

```powershell
python -m compileall -q app
python -m pytest -q -p no:cacheprovider
```

Conferir desktop e celular, filtros, abas, atribuição, decisões, sessão
expirada, download autenticado e prévia JSON. Não confundir testes com
API simulada com validação ponta a ponta usando o backend real.
