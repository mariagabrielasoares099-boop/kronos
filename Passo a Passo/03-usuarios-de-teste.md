# 3. Usuários de teste

Todos os dados são **fictícios**. Os CPFs só passam na validação de dígitos (foram gerados, não pertencem a ninguém) e os e-mails usam `exemplo.test`, domínio reservado que nunca entrega mensagem.

## Cadastrar os candidatos de teste

Com o servidor no ar, na pasta `apps/web`:

```powershell
python scripts/semear_candidatos.py http://127.0.0.1:8000
```

O script cria 5 candidaturas pelo formulário público e imprime o link do chamado de cada uma. Rodar de novo cria mais 5 (duplicadas, de propósito).

| Candidato | Vaga | E-mail | CPF |
|---|---|---|---|
| Teste Aline Prado | v1 Auxiliar Administrativo | aline.prado@exemplo.test | 390.533.447-05 |
| Teste Breno Salles | v1 Auxiliar Administrativo | breno.salles@exemplo.test | 111.444.777-35 |
| Teste Camila Rocha | v2 Operador de Logística | camila.rocha@exemplo.test | 123.456.789-09 |
| Teste Davi Moura | v3 Assistente de RH | davi.moura@exemplo.test | 246.813.579-28 |
| Teste Elisa Ventura | v4 Motorista Entregador | elisa.ventura@exemplo.test | 864.209.753-10 |

Para cadastrar **à mão** (como um visitante faria), use o formulário em `/vagas/v1` e qualquer um destes CPFs. Há também o `529.982.247-25`, usado no roteiro de vídeo.

## O que cada pessoa vê

**Candidato** (não precisa de login no demo): abra o link do chamado (`/chamado/ADM-2026-0000NN`). Verá as etapas, o checklist de documentos, o formulário de envio e o histórico. Teste enviando um PDF ou imagem em "RG" e depois um arquivo inválido (um `.txt` renomeado para `.pdf`) para ver a recusa.

**RH** (sem login por padrão): abra `/rh/dashboard` ou `/painel/fila`, escolha o chamado do candidato, **aprove** ou **recuse com motivo** o documento enviado e volte à página do chamado do candidato para ver o resultado.

## Conta da equipe (modo exposição)

Só existe quando o servidor é iniciado com `EXPO_LOGIN=true` (veja o arquivo 1). Nesse modo a área do RH exige login; o portal do candidato continua aberto.

| Campo | Valor padrão |
|---|---|
| E-mail | `equipe.teste@exemplo.test` |
| Senha | `kronos-expo-2026` |

A tela `/login` exibe essas credenciais. Para trocar: `EXPO_EMAIL` e `EXPO_SENHA`. A sessão dura 8 horas; **Sair** (no canto superior) encerra. Não há 2FA nessa conta, e ela só funciona com `DEMO_MODE=true`.

## Chamados que já vêm prontos

`ADM-2026-000001` (Ana Souza, em Validação do DP, com 3 documentos esperando decisão) e mais 11 em etapas variadas, com documentos aprovados, pendentes e recusados. Servem para mostrar a fila, o SLA (atrasados, vencendo e no prazo) e o quadro de etapas sem precisar cadastrar ninguém.

## Roteiro de teste de ponta a ponta (5 minutos)

1. Em `/vagas/v1`, candidate-se como **Teste Aline Prado** (CPF acima) e anote o protocolo.
2. No chamado, envie um PDF em **RG**: o item vira **Em análise**.
3. Em `/painel/fila`, busque o protocolo, abra o chamado e **recuse** o RG com o motivo "Foto ilegível".
4. Volte ao chamado do candidato: aparece "Recusado: Foto ilegível. Envie novamente."
5. Envie outro arquivo; no RH, **aprove**.
6. No RH, clique nos botões de avanço até o chamado ficar **Admitido**.
7. Em `/rh/gastos`, veja o consumo; em `/rh/conhecimento`, pergunte "quando devo recusar um comprovante de residência?".

## Fora do demo

Com a API real (`DEMO_MODE=false`) o candidato entra por link enviado ao e-mail e a equipe entra com e-mail, senha e código 2FA. Esses usuários dependem da API e do banco e **não existem** neste repositório de demonstração.
