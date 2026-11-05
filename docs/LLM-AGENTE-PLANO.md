# Avaliação de LLM para o futuro agente do KRONOS

**Status:** proposta para revisão futura. Nenhuma integração com LLM é implementada por este documento.

Este plano deve ser revisto quando o agente do sistema entrar em desenvolvimento, especialmente os modelos disponíveis, termos de uso, limites gratuitos, licenças, hardware e requisitos de privacidade.

## Objetivo inicial

Usar o modelo para apoiar tarefas de RH, mantendo a decisão com uma pessoa. Uma primeira tarefa de baixo risco para avaliar é gerar perguntas de entrevista a partir da descrição de uma vaga fictícia. Depois, pode-se avaliar a sumarização de currículos sintéticos ou anonimizados, sempre para revisão humana.

O agente não deve aprovar, rejeitar, ordenar ou pontuar candidatos. O modelo deve apresentar informações verificáveis, indicar quando não encontrou informação e não inferir atributos pessoais.

## Opções para avaliar

### 1. Ollama local — recomendação para o protótipo sem custo por chamada

- Executar um modelo no computador de desenvolvimento, sem enviar os prompts a uma API de modelo hospedada.
- Avaliar inicialmente `qwen3.5:4b`; o pacote indicado na biblioteca do Ollama ocupa cerca de 3,3–4 GB. O uso real de memória depende do modelo, do contexto e da máquina, portanto é preciso validar o hardware disponível.
- Custo de inferência por chamada: sem cobrança de API; há custo de hardware, energia e tempo de execução.
- Ollama documenta uma API local e compatibilidade parcial com a Messages API da Anthropic. Isso pode facilitar testes com um cliente compatível, mas o modelo local continua sendo Qwen, não Claude.

Referências:
- [Biblioteca Qwen 3.5 do Ollama](https://ollama.com/library/qwen3.5)
- [Compatibilidade Anthropic no Ollama](https://docs.ollama.com/api/anthropic-compatibility)

### 2. Gemini API no nível gratuito — apenas para dados fictícios ou anonimizados

- Pode ser útil para comparar respostas sem custo inicial, dentro dos modelos e limites disponíveis no nível gratuito.
- A documentação do Google informa que o conteúdo do nível gratuito pode ser usado para melhorar produtos. Não enviar currículos reais ou outros dados de candidatos nessa configuração.
- Confirmar limites, modelos e termos vigentes antes de cada avaliação.

Referências:
- [Preços e nível gratuito da Gemini API](https://ai.google.dev/gemini-api/docs/pricing)
- [Termos adicionais do Gemini API](https://ai.google.dev/gemini-api/terms)

### 3. Claude via API — opção futura com cobrança separada

- A assinatura Claude.ai não inclui chamadas de API feitas pelo KRONOS.
- Para a aplicação, seria necessário configurar o Anthropic Console e pagar o consumo da API separadamente.
- Não criar a chave nem habilitar cobrança como parte deste plano; decidir isso explicitamente quando houver orçamento aprovado.

Referências:
- [Diferença entre assinatura Claude.ai e API](https://support.anthropic.com/en/articles/9876003-i-subscribe-to-a-paid-claude-ai-plan-why-do-i-have-to-pay-separately-for-api-usage-on-console)
- [Cobrança de uso da API](https://support.anthropic.com/en/articles/8977456-how-do-i-pay-for-my-api-usage)

## Arquitetura sugerida para implementação

- Manter as chamadas de modelo no backend NestJS em `apps/api`; o navegador nunca recebe chaves de API.
- Criar uma interface de provedor para permitir trocar entre Ollama local e Anthropic sem acoplar as regras do domínio ao SDK de um fornecedor.
- Guardar URL, modelo e credenciais em configuração de servidor. Nunca incluir chaves em commits, respostas HTTP ou logs.
- Começar com uma operação estreita e de saída estruturada, por exemplo: gerar perguntas relacionadas aos requisitos declarados da vaga.
- Colocar limites de tamanho de entrada e resposta, timeout, tratamento de falhas e rate limit; não permitir que o modelo invoque ferramentas ou execute ações no sistema nesta primeira etapa.

## Segurança do passo 2: prompt injection e sanitização

O texto de uma vaga, currículo ou documento é conteúdo não confiável. Na implementação:

- Separar instruções do sistema do texto fornecido por usuários/documentos e instruir o modelo a tratar esse texto apenas como dados, nunca como comandos.
- Não conceder ferramentas, acesso ao banco, envio de mensagens ou mudanças de estado ao modelo.
- Validar a resposta contra um schema no backend e rejeitar campos inesperados.
- Evitar enviar CPF, e-mail, telefone, dados bancários, de saúde ou outros identificadores que não sejam necessários para a tarefa.
- Não usar dados reais de candidatos no protótipo. Antes de produção, avaliar consentimento, finalidade, retenção, acesso e requisitos de privacidade com as pessoas responsáveis pelo projeto.
- Não confiar em saídas do modelo como fatos; exigir evidências no texto de origem e revisão humana.

## Avaliação antes de adotar o agente

Usar um conjunto controlado de exemplos sintéticos em português e avaliar pelo menos:

- qualidade e consistência da resposta;
- afirmações sem evidência e comportamento quando faltam dados;
- resistência a instruções maliciosas embutidas em vagas/currículos;
- tratamento de conteúdo discriminatório e de atributos pessoais;
- latência, consumo de memória, limites e custo operacional;
- clareza para o RH revisar e corrigir a resposta.

Registrar modelo e versão usados, resultados e falhas sem gravar conteúdo pessoal. Comparar Ollama com outros provedores antes de escolher a opção de produção.

## Critério para considerar concluído

A integração só deve avançar quando houver uma tarefa aprovada, provedor escolhido, responsável pelo orçamento/infraestrutura, avaliação com dados sintéticos, revisão humana definida e critérios de privacidade documentados. O agente permanece assistivo; decisões de contratação continuam sob responsabilidade humana.
