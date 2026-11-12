# Demo do KRONOS (roteiro para vídeo)

Vídeo curto (≈ 3 min) para o GitHub e o LinkedIn. Tudo roda **local e grátis**, com dados fictícios.

## Preparação (uma vez)
```bash
cd apps/web
python -m venv .venv && .venv/Scripts/activate      # Windows; no Linux/Mac: source .venv/bin/activate
pip install -r requirements.txt
cd ../..
npm run dev:web                                     # http://localhost:8000 (modo demo, sem API nem banco)
```
Abra `http://localhost:8000` numa janela limpa (zoom 110–125%, sem outras abas). Reinicie o servidor antes de gravar: os dados do demo ficam em memória e voltam ao estado inicial.

## O que o demo mostra
O fluxo **candidato → documentos → RH decide → admissão**, no **modo demo** do front (FastAPI + HTMX). Os dados são fictícios e a regra oficial (transições, RLS, SLA) pertence à API NestJS, que aparece no bloco 8.

## Roteiro (≈ 3 min)

| # | Tempo | Tela | Fale / mostre |
|---|---|---|---|
| 1 | 0:00 | — | "O RH digita tudo duas vezes: recrutamento num lugar, admissão em outro. O KRONOS transforma cada candidato em **um chamado com protocolo único**." |
| 2 | 0:20 | `/` → vaga → candidatar | Preencha um **CPF inválido** (o erro aparece ao sair do campo, via HTMX) e depois o válido `529.982.247-25`, nome e e-mail, e marque o consentimento LGPD. Cai no chamado `ADM-2026-0000NN`. |
| 3 | 0:50 | `/chamado/ADM-2026-0000NN` | Checklist com 3 itens **Faltando**. Envie um PDF em "RG": vira **Em análise**. Tente enviar um `.exe` renomeado para `.pdf`: é **recusado pelo conteúdo**, não pela extensão. |
| 4 | 1:30 | `/painel/fila` | Fila do RH com **busca, filtro por status e SLA** (atrasado / vence em 24h / no prazo). Digite "Ana" e filtre "Validação do DP". |
| 5 | 1:50 | detalhe de `ADM-2026-000001` | Linha do tempo + 3 documentos. **Aprove** o RG; **recuse** o CPF com motivo "Foto ilegível" (sem motivo, não deixa). Tudo sem recarregar a página. |
| 6 | 2:20 | `/chamado/ADM-2026-000001` | Do lado do candidato aparece "Recusado: Foto ilegível. Envie novamente." |
| 7 | 2:35 | detalhe do RH | Clique em "Validar e seguir para assinatura" → "Enviar ao ERP" → "Confirmar admissão": status **Admitido**. |
| 8 | 2:50 | terminal | `npm test` (testes da API e do front passando) e a pasta `apps/api`: "por trás, API NestJS com PostgreSQL e **Row Level Security** — o isolamento entre empresas é garantido pelo banco." |
| 9 | 3:05 | — | Fechamento: "Próximo passo: exportar o arquivo no formato do ERP (Fortes/Totvs) para importar sem redigitar." |

### Dicas de gravação
- Grave a tela (OBS Studio ou Xbox Game Bar `Win+G`), 1080p, sem áudio do sistema; narre depois se preferir.
- Esconda a barra de favoritos e dados pessoais. Os CPFs do demo são de teste.
- Para o bloco 8 mostrar a API de verdade: `docker compose up -d` e `npm run dev:api`, depois mostre `http://localhost:3000/health` e o contrato `http://localhost:3000/openapi.json` (guia em `docs/API.md`).

## Texto sugerido para o LinkedIn
> Estou construindo o **KRONOS**, um ATS + admissão em que cada candidato é um chamado com protocolo único, da candidatura até a admissão na folha. Projeto do meu curso de IA generativa, 100% com ferramentas gratuitas.
>
> O que já funciona: candidatura com validação de CPF e consentimento LGPD, envio de documentos validados pelo **conteúdo** do arquivo, fila do RH com SLA e aprovação/recusa de documentos com motivo, e uma API NestJS com PostgreSQL e Row Level Security.
>
> Próximo passo: gerar o arquivo de importação para o ERP, para o RH não digitar nada duas vezes.
>
> Código: <link do repositório>
>
> #IA #GenAI #NestJS #FastAPI #PostgreSQL #RH #LGPD

## Para o README do GitHub
Suba o vídeo arrastando o `.mp4` (até 100 MB) para a descrição de um Release ou de uma issue e copie o link gerado, ou publique no YouTube como "não listado" e coloque o link no topo do `README.md`.
