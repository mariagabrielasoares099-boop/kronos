---
name: KRONOS
description: ATS + admissão por chamado; painel de RH denso e portal do candidato leve, na paleta azul-marinho, azul, ciano, roxo e lima da logo.
colors:
  ink: "#071b38"
  brand: "#1558d6"
  brand-dark: "#0f43a8"
  cyan: "#00dceb"
  purple: "#6425d9"
  lime: "#a6d80f"
  lime-dark: "#4f7a00"
  bg: "#f4f7fb"
  fg: "#1b2a41"
  muted: "#5a6a82"
  card: "#ffffff"
  line: "#dde4f0"
  ok: "#1c7c3f"
  err: "#c0392b"
  warn: "#8a5a00"
  nav-2: "#143275"
  # Dashboard RH (hr.css): valores paralelos a unificar com os de cima
  hr-ink: "#202b42"
  hr-blue: "#315ce8"
  hr-line: "#e5e9f0"
  hr-muted: "#748198"
typography:
  display:
    fontFamily: "Sora, Segoe UI, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  heading:
    fontFamily: "Sora, Segoe UI, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Segoe UI, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
rounded:
  sm: "8px"
  md: "10px"
  lg: "14px"
  pill: "999px"
spacing:
  xs: "6px"
  sm: "10px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.brand}"
    textColor: "{colors.card}"
    rounded: "{rounded.md}"
    padding: "11px 20px"
  button-primary-hover:
    backgroundColor: "{colors.brand-dark}"
  card:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.lg}"
    padding: "18px 20px"
  input:
    backgroundColor: "{colors.card}"
    textColor: "{colors.fg}"
    rounded: "{rounded.md}"
    padding: "11px 13px"
  tag:
    backgroundColor: "#eaf0ff"
    textColor: "{colors.brand-dark}"
    rounded: "{rounded.pill}"
    padding: "3px 10px"
---

# KRONOS — Design System

> Capturado do código atual (`apps/web/app/static/app.css`, `hr.css`, `templates/`) em 2026-11-20. Descreve o que existe; o que está errado está em **Do's and Don'ts** e em `docs/GUIA-DESIGN.md`.

## Overview
Duas áreas, um sistema. **Candidato** (`body.area-candidato`): portal leve, protocolo como elemento memorável, lista de vagas sem caixas. **RH** (`body.area-rh`): menu lateral escuro, tabelas e fila densas, dashboard do analista. Modo **Operate**: legibilidade e consistência vencem expressão; a marca aparece em detalhes precisos (barra com gradiente de 3px, avatar, protocolo).

## Colors
- **Ink `#071b38`**: títulos, menu lateral, faixa demo. **Brand `#1558d6`**: ação primária, links (`brand-dark` no hover e em texto).
- **Cyan / purple / lime**: só na identidade (gradiente da barra e do progresso, foco, avatar). **Nunca como cor de texto ou fundo de texto**: ciano e lima sobre branco dão 1,69:1.
- **Semânticas**: `ok` verde, `err` vermelho, `warn` âmbar; sempre com fundo tingido claro e texto escuro (SLA e badges).
- **Neutros**: `bg` página, `card` superfície, `line` bordas, `muted` texto secundário (5,1:1 sobre `bg`, aprovado).
- Estratégia: neutros frios com um azul dominante; acento raro.

## Typography
**Sora 600/700** local (`/static/fonts`) para h1/h2/protocolo; **Segoe UI** do sistema para corpo. Escala real: 26 / 19 / 17 / 15 (corpo) / 14 / 13 / 12,5. O dashboard do RH desce a 8–11px: fora do sistema, ver Don'ts.

## Layout
Barra superior sticky (64px) + menu lateral 232px (só RH) + `main` com máximo de 1400px (RH) ou 1080px (candidato). Quebras em 900px (colapsa mestre-detalhe) e 760px (menu vira abas rolantes). O dashboard `hr.css` tem quebras próprias (1100/900/480).

## Elevation & Depth
Uma sombra única `--shadow` (`0 1px 2px` + `0 4px 14px`, azul a 6%) em cards e formulários. Lista de vagas é plana, com divisórias, e só ganha fundo branco no hover.

## Shapes
Raio 14px em cards, 10px em botões e campos, 8px em itens de menu, pílula (999px) em tags, status e links da barra.

## Components
- **Botão primário**: azul sólido, texto branco 14px/650 (contraste 6,2:1). Variantes `.btn-ok` (verde) e `.btn-err` (vermelho) para aprovar e recusar; não há variante secundária neutra.
- **Campos**: borda `#c9d4e6`, foco com borda `brand` e halo 3px.
- **Status do chamado** (`.pill-status`, `.stepper`), **SLA** (`.sla-no_prazo|vencendo|atrasado`), **documento** (`.badge-pendente|aprovado|recusado`): pílulas com fundo tingido. A informação não pode depender só da cor.
- **Fila**: tabela mestre-detalhe com HTMX; detalhe sticky.
- **Protocolo/bilhete** (`.ticket`): elemento de assinatura do portal.
- **Foco**: `:focus-visible` com contorno ciano de 2px.
- **Movimento**: transições de 150ms sob `prefers-reduced-motion: no-preference`.

## Do's and Don'ts
**Faça**
- Use sempre os tokens `--ink/--brand/...` de `app.css`; um valor novo vira token antes de virar regra.
- Texto sobre `lime`/`cyan`: escuro. Texto sobre `brand`/`ink`: branco.
- Estado = cor + texto (e ícone quando couber).
- Alvos de toque de pelo menos 44px no portal do candidato.

**Não faça**
- Fontes abaixo de 12px (o `hr.css` tem 8, 9, 10 e 11px em dezenas de regras).
- `--hr-muted #748198` como cor de texto (3,94:1 sobre branco, reprova AA).
- Segundo conjunto de tokens (`--hr-*`) duplicando o principal.
- CDN, fonte externa ou estilo inline (CSP `style-src 'self'`).
- Caixa-alta decorativa.
