# 2. Como usar o KRONOS (regras)

No KRONOS **cada candidato vira um chamado**, com um protocolo único (por exemplo `ADM-2026-000123`), acompanhado da candidatura até a admissão. O protocolo continua valendo depois da contratação.

## Mapa de telas

| Quem | Tela | Endereço |
|---|---|---|
| Candidato | Vagas abertas | `/` ou `/vagas` |
| Candidato | Vaga e formulário de candidatura | `/vagas/v1` |
| Candidato | Acompanhar chamado e enviar documentos | `/chamado/ADM-2026-0000NN` |
| RH | Visão do analista (fila + abas) | `/rh/dashboard` |
| RH | Fila de chamados com filtros e SLA | `/painel/fila` |
| RH | Quadro de etapas | `/painel` |
| RH | Base de conhecimento (perguntar, ingestão, MCP) | `/rh/conhecimento` |
| RH | Uso e custos | `/rh/gastos` |
| Equipe | Login (só no modo exposição) | `/login` |

## O caminho do chamado

O chamado passa por 10 status. Só termina em **Admitido** depois do envio ao ERP.

```
Triagem → Testes → Entrevista → Aprovado → Aguardando candidato → Validação do DP
        → Assinatura → Envio ao ERP → Admitido          (ou Reprovado)
```

No modo demonstração o RH avança uma etapa de cada vez pelo botão da tela do chamado. Ordem: Triagem e Testes seguem para Entrevista; Entrevista para Aprovado; Aprovado para Aguardando candidato (documentos solicitados); Aguardando candidato para Validação do DP (documentos recebidos); depois Assinatura, Envio ao ERP e Admitido. **Admitido** e **Reprovado** encerram o chamado: não há mais botão nem prazo.

## Regras para o candidato

1. **Candidatar-se**: informe nome completo (mínimo 3 letras), e-mail válido e CPF válido, e marque o consentimento LGPD. Sem o consentimento a candidatura não é enviada.
2. **CPF**: o sistema confere os dígitos ao sair do campo. CPF com todos os dígitos iguais ou com dígito verificador errado é recusado.
3. **Protocolo**: ao enviar, a pessoa vai para a página do chamado. Guarde o protocolo: é a forma de acompanhar.
4. **Checklist de documentos**: RG, CPF e comprovante de residência. Cada item mostra **Faltando**, **Em análise**, **Aprovado** ou **Recusado**. Também é possível enviar CTPS, foto 3x4 e outros.
5. **Envio de arquivo**: JPG, PNG ou PDF, de até **5 MB**. O tipo é conferido pelo **conteúdo do arquivo**, não pela extensão: um `.exe` renomeado para `.pdf` é recusado. Arquivo vazio ou acima do limite também é recusado.
6. **Documento recusado**: a tela mostra "Recusado: *motivo*. Envie novamente." O candidato envia outro arquivo e o item volta para **Em análise**.
7. **Limite de tentativas**: muitas candidaturas ou envios seguidos do mesmo aparelho recebem "Muitas tentativas. Aguarde um minuto." (padrão: 10 por minuto).
8. **Privacidade**: o demo não guarda CPF nem arquivo de verdade; só o nome e o estado do chamado ficam em memória.

## Regras para o RH

1. **Fila**: lista os chamados mais urgentes primeiro (prazo mais próximo); encerrados vão para o fim. Busque por nome ou protocolo e filtre por status.
2. **SLA** (prazo): **No prazo**; **Vence em 24h** (faltam 24 horas ou menos); **Atrasado** (o prazo passou). Chamados encerrados não têm SLA.
3. **Decidir documento**: em cada documento **Em análise** (aparece como "Aguardando decisão") há **Aprovar** e **Recusar**. Para **recusar é obrigatório informar o motivo** (mínimo 3 caracteres); o candidato vê esse motivo. Um documento já decidido não pode ser decidido de novo ("Este documento já foi decidido").
4. **Avançar etapa**: botão no fim do detalhe do chamado ("Aprovar triagem", "Validar e seguir para assinatura", "Confirmar admissão" etc.).
5. **Assumir chamado**: na API real, o analista só vê os documentos de chamados atribuídos a ele ("Assumir este chamado"). No demo todos aparecem.
6. **Decisão é humana**: a IA da base de conhecimento só responde dúvidas de política com fonte. Nenhum documento ou candidato é aprovado ou recusado automaticamente.
7. **Exportação ao ERP**: na visão do analista há apenas uma **prévia JSON**, marcada como não importável; o conector real do ERP ainda não existe.

## Base de conhecimento, ingestão e custos

- **Perguntar**: escreva uma pergunta de política do RH; a resposta cita o documento de origem. Sem o Ollama, mostra os trechos encontrados, sem texto gerado.
- **Ingestão** e **MCP do KRONOS**: veja [04-ingestao-e-mcp.md](04-ingestao-e-mcp.md).
- **Uso e custos**: consumo contra a cota do plano. Os meses anteriores são fictícios; só as buscas feitas na base são medidas de verdade.

## Limites do demo (o que ainda não existe)

- Dados em memória: reiniciar o servidor apaga tudo.
- Sem envio real de e-mail, WhatsApp, assinatura digital ou integração com ERP.
- Sem OCR nem leitura automática de documentos do candidato.
- Base de conhecimento única, pensada para uma empresa.
