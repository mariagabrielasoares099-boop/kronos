# 5. Usar o KRONOS no celular

O KRONOS é um site responsivo: funciona no navegador do celular, sem aplicativo.

## Como abrir no telefone

1. Suba o servidor escutando na rede: `python -m uvicorn app.main:app --host 0.0.0.0 --port 8000`.
2. No computador, descubra o IP (`ipconfig` no Windows, procure "Endereço IPv4").
3. No celular, conectado à **mesma rede Wi-Fi**, abra `http://<IP>:8000`.
4. Se não abrir, libere a porta 8000 no Firewall do Windows para redes privadas.

Alternativa sem celular: no Chrome do computador, `F12` → ícone de celular (**Ctrl+Shift+M**) para simular a tela.

Use só em rede de confiança: o demo não tem proteção de acesso por padrão.

## O que foi verificado

Teste automatizado no navegador, com telas de **390 px** (celular comum) e **320 px** (celular pequeno), em 11 telas: vagas, vaga, chamado, quadro, fila, detalhe do chamado, visão do analista, base de conhecimento (3 abas) e uso e custos.

| Verificação | Resultado |
|---|---|
| Rolagem horizontal da página | nenhuma, em todas as telas e nas duas larguras |
| Tag de viewport para celular | presente |
| Texto menor que 12 px | nenhum (corrigido: havia `small` com 11,7 px) |
| Alvos de toque menores que 24 px | nenhum (corrigido: link "Todas as vagas" e caixa de consentimento) |
| Alvos de toque de 44 px | aplicado em botões, links da barra e campos na tela de celular; restam 2 a 3 itens menores por tela (como a caixa de consentimento, 24 px e o logotipo) |
| Acessibilidade automática (AccessLint) | 0 violações nas telas escaneadas |

Como se comporta no celular:

- O **menu lateral do RH** vira uma faixa de abas que rola para o lado. Itens como "Base de conhecimento" e "Uso e custos" ficam depois da borda: deslize a faixa.
- A **faixa de etapas** do chamado e as **tabelas** rolam para o lado dentro do próprio quadro, sem mover a página.
- A **câmera**: no campo de arquivo do candidato o celular oferece tirar foto do documento.

## O que não foi verificado

- Não testado em aparelho físico (iPhone ou Android) nem em Safari; o teste usou o Chrome com tela reduzida.
- Não testado o uso da câmera, o envio de foto grande por rede móvel nem o teclado do celular cobrindo campos.
- Rotação da tela (modo paisagem) não foi medida.
