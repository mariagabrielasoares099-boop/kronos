import { z } from 'zod';
import { ROLES_KEY } from '../auth/auth.decorators.js';
import { AtribuicaoSchema, CriarChamadoSchema, ListarChamadosSchema, TransicaoSchema } from '../chamados/chamados.schemas.js';
import { ChamadosController } from '../chamados/chamados.controller.js';
import { TicketStatus } from '../domain/ticket-status.js';

/**
 * Documento OpenAPI 3.1 gerado a partir dos MESMOS schemas Zod que validam a entrada
 * (uma fonte so: a documentacao nao diverge da validacao). Sem dependencia extra.
 */

type Json = Record<string, unknown>;

/** Schema JSON da entrada, sem o `$schema` (o OpenAPI 3.1 ja usa JSON Schema 2020-12). */
function entrada(schema: z.ZodType): Json {
  const { $schema: _ignorado, ...resto } = z.toJSONSchema(schema, { io: 'input' }) as Json;
  return resto;
}

const ChamadoView: Json = {
  type: 'object',
  description: 'Resumo do chamado. Nao traz dado pessoal do candidato.',
  required: ['id', 'protocolo', 'status', 'jobId', 'erpRef'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    protocolo: { type: 'string', pattern: '^ADM-\\d{4}-\\d{6}$', examples: ['ADM-2026-000001'] },
    status: { type: 'string', enum: Object.values(TicketStatus) },
    jobId: { type: 'string', format: 'uuid' },
    erpRef: { type: ['string', 'null'], description: 'Referencia no ERP, preenchida apos o envio.' },
  },
  additionalProperties: false,
};

const ChamadoResumoView: Json = {
  type: 'object',
  description: 'Linha da fila da equipe. Nomes vem null quando o RLS esconde a vaga ou a pessoa; sem CPF nem e-mail.',
  required: ['id', 'protocolo', 'status', 'vagaTitulo', 'candidatoNome', 'responsavelNome', 'prazoSla', 'criadoEm'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    protocolo: { type: 'string', pattern: '^ADM-\d{4}-\d{6}$' },
    status: { type: 'string', enum: Object.values(TicketStatus) },
    vagaTitulo: { type: ['string', 'null'] },
    candidatoNome: { type: ['string', 'null'] },
    responsavelNome: { type: ['string', 'null'] },
    prazoSla: { type: ['string', 'null'], format: 'date-time' },
    criadoEm: { type: 'string', format: 'date-time' },
  },
  additionalProperties: false,
};

const EventoView: Json = {
  type: 'object',
  description: 'Item da linha do tempo do chamado.',
  required: ['tipo', 'de', 'para', 'motivo', 'detalhe', 'autorNome', 'em'],
  properties: {
    tipo: { type: 'string' },
    de: { type: ['string', 'null'] },
    para: { type: ['string', 'null'] },
    motivo: { type: ['string', 'null'] },
    detalhe: { type: ['string', 'null'], description: 'Texto pronto de eventos sem status, como a atribuicao.' },
    autorNome: { type: ['string', 'null'] },
    em: { type: 'string', format: 'date-time' },
  },
  additionalProperties: false,
};

const AtribuicaoView: Json = {
  type: 'object',
  description: 'Resultado da atribuicao. `jaAtribuido: true` = nada foi gravado de novo.',
  required: ['chamadoId', 'usuarioId', 'usuarioNome', 'jaAtribuido'],
  properties: {
    chamadoId: { type: 'string', format: 'uuid' },
    usuarioId: { type: 'string', format: 'uuid' },
    usuarioNome: { type: 'string' },
    jaAtribuido: { type: 'boolean' },
  },
  additionalProperties: false,
};

const Erro: Json = {
  type: 'object',
  description: 'Erro padrao. Em 400, `erros` lista campo e problema, nunca o valor recebido.',
  required: ['message'],
  // A validacao Zod usa um corpo customizado com erros, sem statusCode.
  anyOf: [{ required: ['statusCode'] }, { required: ['erros'] }],
  properties: {
    statusCode: { type: 'integer' },
    message: { type: 'string' },
    error: { type: 'string' },
    erros: {
      type: 'array',
      items: {
        type: 'object',
        required: ['campo', 'problema'],
        properties: { campo: { type: 'string' }, problema: { type: 'string' } },
      },
    },
  },
};

const ref = (nome: string) => ({ $ref: `#/components/schemas/${nome}` });
const resposta = (descricao: string, schema = 'Erro') => ({
  description: descricao,
  content: { 'application/json': { schema: ref(schema) } },
});

/** Papeis permitidos, lidos do mesmo metadado que o AuthGuard usa. */
function papeisDe(metodo: keyof ChamadosController): string[] {
  const p = Reflect.getMetadata(ROLES_KEY, ChamadosController.prototype[metodo]) as string[] | undefined;
  return p ?? [];
}

const descricaoPapeis = (metodo: keyof ChamadosController, semRestricao: string) => {
  const p = papeisDe(metodo);
  return p.length ? `Papeis permitidos: ${p.join(', ')}.` : semRestricao;
};

const comuns = {
  '401': resposta('Token ausente ou invalido'),
  '429': resposta('Limite de requisicoes excedido'),
};

/** Parametros de querystring a partir do schema Zod (objeto simples). */
function queryDe(schema: z.ZodType): Json[] {
  const { properties = {}, required = [] } = entrada(schema) as { properties?: Record<string, Json>; required?: string[] };
  return Object.entries(properties).map(([name, sch]) => ({ name, in: 'query', required: required.includes(name), schema: sch }));
}

export function construirOpenApi(): Json {
  const protocolo = { name: 'protocolo', in: 'path', required: true, schema: { type: 'string', pattern: '^ADM-\\d{4}-\\d{6}$' } };
  const id = { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } };

  return {
    openapi: '3.1.0',
    info: {
      title: 'KRONOS API',
      version: '0.0.1',
      description:
        'Admissao sem digitacao. Autenticacao por token Bearer; o acesso a cada chamado e decidido pelo banco (RLS), '
        + 'entao um chamado que a pessoa nao pode ver responde 404, igual a um chamado inexistente.',
    },
    servers: [{ url: 'http://localhost:3000', description: 'Desenvolvimento local' }],
    security: [{ bearerAuth: [] }],
    tags: [{ name: 'chamados' }, { name: 'sistema' }],
    paths: {
      '/health': {
        get: {
          tags: ['sistema'],
          summary: 'Verifica se a API esta no ar',
          security: [],
          responses: {
            '200': {
              description: 'API no ar',
              content: {
                'application/json': {
                  schema: { type: 'object', required: ['status'], properties: { status: { const: 'ok' } } },
                },
              },
            },
          },
        },
      },
      '/chamados': {
        get: {
          tags: ['chamados'],
          summary: 'Fila da equipe: lista chamados por prazo de SLA',
          description: `${descricaoPapeis('listar', 'Somente equipe.')} Filtros: \`status\`, \`busca\` (protocolo, nome ou CPF) e \`limite\`. Mais urgentes primeiro.`,
          parameters: queryDe(ListarChamadosSchema),
          responses: {
            '200': { description: 'Chamados visiveis para a pessoa', content: { 'application/json': { schema: { type: 'array', items: ref('ChamadoResumoView') } } } },
            '400': resposta('Filtro invalido'),
            ...comuns,
            '403': resposta('Papel sem permissao'),
          },
        },
        post: {
          tags: ['chamados'],
          summary: 'Abre um chamado cadastrando o candidato',
          description: `${descricaoPapeis('criar', 'Qualquer pessoa autenticada.')} O candidato so e cadastrado com o consentimento LGPD (\`consentimentoLgpd: true\`).`,
          requestBody: { required: true, content: { 'application/json': { schema: entrada(CriarChamadoSchema) } } },
          responses: {
            '201': resposta('Chamado aberto', 'ChamadoView'),
            '400': resposta('Requisicao invalida'),
            ...comuns,
            '403': resposta('Papel sem permissao'),
            '404': resposta('Vaga nao encontrada'),
            '409': resposta('Ja existe candidato com este CPF'),
          },
        },
      },
      '/chamados/{protocolo}/resumo': {
        get: {
          tags: ['chamados'],
          summary: 'Resumo do chamado para a equipe (vaga, pessoa, responsavel, SLA)',
          description: descricaoPapeis('resumo', 'Somente equipe.'),
          parameters: [protocolo],
          responses: {
            '200': resposta('Resumo do chamado', 'ChamadoResumoView'),
            '400': resposta('Protocolo em formato invalido'),
            ...comuns,
            '403': resposta('Papel sem permissao'),
            '404': resposta('Chamado nao encontrado (ou sem permissao para ve-lo)'),
          },
        },
      },
      '/chamados/{id}/eventos': {
        get: {
          tags: ['chamados'],
          summary: 'Linha do tempo do chamado',
          description: descricaoPapeis('eventos', 'Somente equipe.'),
          parameters: [id],
          responses: {
            '200': { description: 'Eventos em ordem cronologica', content: { 'application/json': { schema: { type: 'array', items: ref('EventoView') } } } },
            '400': resposta('Identificador invalido'),
            ...comuns,
            '403': resposta('Papel sem permissao'),
            '404': resposta('Chamado nao encontrado (ou sem permissao para ve-lo)'),
          },
        },
      },
      '/chamados/{protocolo}': {
        get: {
          tags: ['chamados'],
          summary: 'Consulta um chamado pelo protocolo',
          description: descricaoPapeis('obter', 'Qualquer pessoa autenticada, inclusive o candidato com o proprio chamado; o RLS filtra o que cada uma ve.'),
          parameters: [protocolo],
          responses: {
            '200': resposta('Chamado encontrado', 'ChamadoView'),
            '400': resposta('Protocolo em formato invalido'),
            ...comuns,
            '404': resposta('Chamado nao encontrado (ou sem permissao para ve-lo)'),
          },
        },
      },
      '/chamados/{id}/atribuicao': {
        post: {
          tags: ['chamados'],
          summary: 'Atribui o chamado a uma pessoa da equipe (por padrao, a quem chama)',
          description: `${descricaoPapeis('atribuir', 'Somente equipe.')} Documentos so aparecem e so sao decididos por quem esta atribuido. `
            + 'O atribuido precisa ser RECRUTADOR ou DP e ter vinculo com a empresa do chamado; o RLS exige que o chamado seja visivel a quem atribui. '
            + 'Registra o evento `ATRIBUICAO` (autor, destino e data) na linha do tempo. Repetir e idempotente.',
          parameters: [id],
          requestBody: { required: false, content: { 'application/json': { schema: entrada(AtribuicaoSchema) } } },
          responses: {
            '200': resposta('Atribuido (ou ja estava)', 'AtribuicaoView'),
            '400': resposta('Requisicao invalida'),
            ...comuns,
            '403': resposta('Papel sem permissao'),
            '404': resposta('Chamado ou usuario nao encontrado (ou sem permissao para ve-los)'),
            '409': resposta('Usuario sem vinculo com a empresa do chamado ou com papel que nao opera documentos'),
          },
        },
      },
      '/chamados/{id}/transicoes': {
        post: {
          tags: ['chamados'],
          summary: 'Avanca, devolve ou reprova o chamado',
          description: `${descricaoPapeis('transicionar', 'Qualquer pessoa autenticada.')} \`DEVOLVER\` e \`REPROVAR\` exigem \`motivo\`.`,
          parameters: [id],
          requestBody: { required: true, content: { 'application/json': { schema: entrada(TransicaoSchema) } } },
          responses: {
            '200': resposta('Transicao aplicada', 'ChamadoView'),
            '400': resposta('Requisicao invalida'),
            ...comuns,
            '403': resposta('Papel sem permissao'),
            '404': resposta('Chamado nao encontrado'),
            '409': resposta('Transicao nao permitida ou chamado alterado por outra pessoa'),
          },
        },
      },
    },
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
      schemas: { ChamadoView, ChamadoResumoView, EventoView, AtribuicaoView, Erro },
    },
  };
}
