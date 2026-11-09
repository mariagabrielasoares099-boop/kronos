import { z } from 'zod';
import { ROLES_KEY } from '../auth/auth.decorators.js';
import { CriarChamadoSchema, TransicaoSchema } from '../chamados/chamados.schemas.js';
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
      schemas: { ChamadoView, Erro },
    },
  };
}
