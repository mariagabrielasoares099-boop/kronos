# Usuários de teste (modo demonstração)

O demo não tem login: qualquer pessoa se candidata pelo formulário e o RH é aberto direto. Tudo é **fictício** e guardado em memória; reiniciar o servidor volta ao estado inicial.

## Cadastro automático

```powershell
cd apps/web
python scripts/semear_candidatos.py http://127.0.0.1:8000
```

Cria 5 candidaturas de teste pelo formulário público e imprime o link do chamado de cada uma. Rodar de novo cria outras 5 (duplicadas, de propósito).

| Candidato | Vaga | E-mail | CPF (só dígito verificador válido) |
|---|---|---|---|
| Teste Aline Prado | v1 Auxiliar Administrativo | aline.prado@exemplo.test | 390.533.447-05 |
| Teste Breno Salles | v1 Auxiliar Administrativo | breno.salles@exemplo.test | 111.444.777-35 |
| Teste Camila Rocha | v2 Operador de Logística | camila.rocha@exemplo.test | 123.456.789-09 |
| Teste Davi Moura | v3 Assistente de RH | davi.moura@exemplo.test | 246.813.579-28 |
| Teste Elisa Ventura | v4 Motorista Entregador | elisa.ventura@exemplo.test | 864.209.753-10 |

Os CPFs foram gerados só para passar na validação e não pertencem a ninguém. `exemplo.test` é um domínio reservado que nunca entrega e-mail. Há ainda o CPF `529.982.247-25`, usado no roteiro do `docs/DEMO.md`.

## Cadastro manual

1. `http://127.0.0.1:8000/` → escolha a vaga → **Candidatar-se** (nome, e-mail, CPF e o consentimento LGPD).
2. Você cai em `/chamado/ADM-2026-0000NN`: essa é a **visão do candidato** (etapas, checklist de documentos, envio de arquivo, histórico).
3. Envie um PDF ou imagem de teste em "RG": o item vira **Em análise**.

## Ver do lado do RH

| O que ver | Endereço |
|---|---|
| Visão do analista (fila + abas) | `/rh/dashboard` |
| Fila de chamados com SLA | `/painel/fila` |
| Quadro de etapas | `/painel` |
| Base de conhecimento (RAG) | `/rh/conhecimento` |
| Uso e custos | `/rh/gastos` |

Fluxo de ponta a ponta: candidate-se → envie o RG → no RH, abra o chamado, **aprove** o documento (ou **recuse** com motivo) → volte ao chamado do candidato e veja o status mudar → avance as etapas até **Admitido**.

## Chamados que já vêm prontos

`ADM-2026-000001` (Ana Souza, validação do DP, 3 documentos para decidir) e outros 11 em etapas variadas, com documentos aprovados, pendentes e recusados.

## Login de equipe para exposição

Por padrão o demo é aberto (sem login). Para uma exposição, em que visitantes veem o portal do candidato livremente mas a área do RH pede login, suba o servidor com:

```powershell
$env:DEMO_MODE = 'true'; $env:EXPO_LOGIN = 'true'
python -m uvicorn app.main:app --port 8000
```

| Campo | Valor padrão |
|---|---|
| E-mail | `equipe.teste@exemplo.test` |
| Senha | `kronos-expo-2026` |

- A tela `/login` mostra essa conta de teste para o visitante. Troque com `EXPO_EMAIL` e `EXPO_SENHA`; se for expor fora da sua rede, **troque a senha** (o padrão está neste repositório).
- Só vale com `DEMO_MODE=true`: com dados reais (`DEMO_MODE=false`) a variável é ignorada e o login passa a ser o da API (e-mail, senha e 2FA).
- Protege `/painel`, `/rh/*` (inclui Base de conhecimento e Uso e custos) e as ações do RH. O portal do candidato (`/`, `/vagas`, `/chamado/...`) continua público.
- Sessão de 8 horas em cookie assinado (`HttpOnly`, `SameSite=Lax`); o botão **Sair** encerra. Sem 2FA, só para a exposição.
- Tudo é fictício: não use essa conta nem esse modo com dados de pessoas reais.

## Fora do demo

Com a API real (`DEMO_MODE=false`) o candidato entra por link enviado ao e-mail e a equipe entra em `/login` com e-mail, senha e código 2FA. Esse fluxo depende da API NestJS e do banco; os usuários de teste dele não existem neste repositório de demo.
