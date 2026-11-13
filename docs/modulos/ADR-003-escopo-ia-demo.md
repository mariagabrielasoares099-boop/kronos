# ADR-003 — Escopo de IA generativa na demo

- **Status:** proposto
- **Data:** 2026-11-13
- **Módulo relacionado:** [15 IA: OCR de documentos e triagem](15-ia-ocr.md)

## Contexto
O KRONOS é um protótipo para um trabalho de curso de IA generativa, sem comprador e com custo zero (ver `README.md`). Surgiu a proposta de usar modelos Llama em quatro frentes: triagem e match de currículos, OCR de documentos com visão, chatbot do candidato e geração de pareceres.

Hoje não existe código de IA no repositório. O módulo 15 trata IA como Fase 3, e o Milestone 1 (`docs/milestones/M1-admissao-sem-digitacao.md`) cobre só domínio, upload, fila do RH e exportação. A etapa de upload no portal ainda está aberta, e o OCR depende dela.

## Decisão
1. **O M1 fecha sem IA.** O critério de pronto do M1 não muda e não depende de nenhum modelo.
2. **A demo terá um pilar principal de IA: OCR com cruzamento de dados.** O candidato envia a foto do documento, o modelo de visão extrai nome, CPF e nascimento em JSON, e o sistema compara com o cadastro e sinaliza divergência ao RH. A decisão de aprovar ou recusar continua humana (LGPD, art. 20).
3. **Um pilar opcional, se sobrar tempo: parecer e feedback ao candidato.** Só geração de texto a cada transição de status.
4. **Fora do escopo da demo (próximos passos):** match semântico de currículos com roteiro de entrevista e chatbot de autoatendimento (RAG sobre `ticket_events`).
5. **Provedor atrás de uma porta.** A API fala com um `LlmPort` (protocolo compatível com OpenAI). O padrão é **Ollama local**; o Groq (free tier) é alternativa, só com dados fictícios.
6. **Falha segura.** Se o modelo falhar, demorar ou devolver JSON inválido, o documento segue para conferência manual do RH. A IA nunca bloqueia o fluxo.
7. **Dados fictícios na demo.** Nenhum documento pessoal real é enviado a um provedor externo.

## Alternativas descartadas
- **Os quatro pilares na demo:** escopo maior que o prazo, e dois deles (match e chatbot) não dependem do caminho crítico do M1.
- **OCR tradicional (Tesseract e similares):** exigiria um motor a mais para manter; o modelo de visão atende e combina com o tema do curso.
- **Provedor pago ou gateway intermediário:** quebra a regra de custo zero.

## Riscos e mitigações
| Risco | Mitigação |
|---|---|
| Privacidade: foto de RG/CPF enviada a terceiro | Ollama local por padrão; Groq só com dados fictícios; registrar a política de retenção do provedor antes de qualquer uso real |
| Prompt injection em currículos e documentos | Tratar o conteúdo como não confiável; saída só em JSON validado por esquema; sem execução de instruções vindas do arquivo |
| OCR errado em foto ruim | Conferência manual do RH; avaliar nitidez antes; conjunto pequeno de casos de teste (evals) antes de trocar modelo ou prompt |
| Limite do free tier ou modelo descontinuado | `LlmPort` permite trocar para o Ollama; ter o modelo local baixado antes da apresentação |
| Demo ao vivo falhar | Gravar um caso de sucesso e manter o fallback manual |

## Consequências
- Uma nova porta `LlmPort` na camada de aplicação, com adaptador OpenAI-compatível em `apps/api/src/integracoes/` ou `apps/api/src/ia/`.
- O OCR só começa depois do upload no portal funcionar; a ordem é: upload, fila do RH, OCR.
- Atualizar o módulo 15 e o texto da apresentação para não prometer match nem chatbot como entregues.
- Chaves de provedores de IA ficam em variáveis de ambiente fora do repositório (módulo 16).
