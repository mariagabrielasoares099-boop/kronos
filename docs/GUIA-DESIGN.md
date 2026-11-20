# Guia de design do KRONOS: as skills, mescladas

Fonte de verdade visual: `DESIGN.md`. Fonte de verdade do produto: `PRODUCT.md`. Este guia diz **qual skill usar para quê**, porque várias fazem o mesmo trabalho e foram escritas para React/Tailwind, e o KRONOS é FastAPI + Jinja2 + HTMX com CSP `style-src 'self'` e custo zero.

## Quem lidera cada trabalho

| Trabalho | Skill que lidera | Apoio | Observação |
|---|---|---|---|
| Direção e critique de tela | `impeccable` (`critique`, `polish`, `layout`, `typeset`, `clarify`) | `frontend-design` | Impeccable tem comandos e lê `PRODUCT.md`/`DESIGN.md`. Frontend-design só como apoio de direção de arte. |
| Biblioteca de decisões (paletas, fontes, UX) | `ui-ux-pro-max` | `design-system` | Usar como **consulta**, não como fonte de estilo: a identidade já está definida pela logo. |
| Auditoria de UX/HTML | `web-design-guidelines` | | Funciona em qualquer HTML. |
| Acessibilidade (WCAG 2.2) | `accessibility-scan` → `accessibility-inspect` → `accessibility-fix`; `accessibility-diff` como portão antes de commit | `accessibility-audit` para o relatório geral | Precisa de Chrome com a app rodando. |
| E2E | `playwright-cli` para explorar; `pw-new-test-cli`, `pw-coverage-planner`, `pw-test-audit`, `pw-debug-test` | `pw-init`, `pw-refactor-into-pom` | O repositório ainda não tem Playwright configurado (`pw-init` cria). Usa Node; o front é Python, então o E2E fica em pasta própria. |
| Processo | `test-driven-development` | | Já existem `pytest` em `apps/web/tests`. |
| Protótipo rápido | `web-artifacts-builder` | | Só para explorar uma tela fora do repositório. |

## Skills que não se aplicam hoje
`shadcn`, `ui-styling`, `migrate-radix-to-base`, `vercel-react-best-practices`, `vercel-composition-patterns`: exigem React/Tailwind e `components.json`. Só valem se você decidir migrar o front (decisão em aberto em `PRODUCT.md`). Até lá, os princípios de composição viram classes CSS e *partials* Jinja. `banner-design`, `brand`, `slides`, `design`: marketing, fora do produto.

## Fluxo recomendado para uma tela nova ou alterada
1. `impeccable shape` (planejar) lendo `PRODUCT.md` e `DESIGN.md`.
2. Escrever o teste primeiro (`test-driven-development`), em `apps/web/tests`.
3. Implementar com os tokens de `app.css`.
4. `impeccable critique` e `polish`.
5. `accessibility-scan` na página e `accessibility-diff` antes do commit.
6. Se o fluxo mudou, E2E (`pw-new-test-cli`).

## Estado das correções (2026-11-20)
Verificado no navegador (Playwright) e com `accessibility-scan` (94 regras): 0 violações em `/`, `/vagas`, `/vagas/v1`, `/chamado/{protocolo}`, `/painel`, `/painel/fila`, `/painel/chamado/{protocolo}` e `/rh/dashboard`.

| # | Item | Situação |
|---|---|---|
| 1 | Fontes de 8 a 11px em `hr.css` | Corrigido: piso de 12px |
| 2 | Contraste de textos em `hr.css` (cinzas, tags, avatares) | Corrigido: 32 cores ajustadas, mínimo 4,6:1 |
| 3 | Tokens duplicados `--hr-*` | Corrigido: apontam para `--fg/--brand/--line/--muted` |
| 4 | Link "pular para o conteúdo" | Corrigido em `base.html` |
| 5 | Abas do dashboard a 10px | Corrigido junto com o item 1 (12px, rolagem lateral se faltar espaço) |
| 6 | Acentos em `base.html` | Corrigido. Outros templates ainda têm texto sem acento ("Situacao atual", "Validacao do DP", "Demonstracao: ...") |
| 7 | Botão secundário neutro | Pendente |

Também corrigidos: indicadores "Atualizando fila…" / "Carregando chamado…" ficavam sempre visíveis; faixa de etapas do candidato agora é região rolável acessível por teclado; título `h1` oculto no detalhe do RH; link "Todas as vagas" sublinhado; alvo de toque de "Abrir ficha completa".

## Inspeção manual (accessibility-inspect, feita com Playwright)
- ● Ordem de foco: 24 controles focáveis no dashboard, todos recebem foco e têm indicador (outline ou sombra).
- ● Reflow a 320px: sem rolagem horizontal da página em `/rh/dashboard`, `/painel/fila`, `/vagas/v1` e `/chamado/{protocolo}`. Em `/painel/fila` os cabeçalhos da tabela passam da borda, mas a página não rola na horizontal (provável contêiner com rolagem; não confirmado).
- ● Link de salto: recebe foco com Tab, Enter leva o foco a `#conteudo`.
- ◐ Cor como único sinal (SLA e status de documento): os rótulos têm texto, mas confirme visualmente.
- ○ Leitor de tela (NVDA/VoiceOver): não testado. `role="status"` e `aria-current="step"` estão presentes, mas o que é anunciado não foi verificado.
- Não exercidos: zoom real de 200%, teclas dentro do painel lateral de recusa, formulário de upload e de candidatura, mensagens de erro de formulário.

## O que ainda não foi feito
- Entrevista de produto do `impeccable init`: `PRODUCT.md` foi escrito só a partir do repositório.
- Scripts do `impeccable` (`context`, `shot`) não foram executados: o lançador baixa um binário na primeira execução.
- Telas de login real (`/login`, `/chamado/.../acesso/...`) só existem fora do modo demo e não foram escaneadas.
- Nada foi commitado.
