import 'reflect-metadata';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AuthGuard } from '../auth/auth.guard.js';
import { assinarToken } from '../auth/token.js';
import { ChamadosController } from '../chamados/chamados.controller.js';
import { ChamadosService } from '../chamados/chamados.service.js';
import { HealthController } from '../health/health.controller.js';
import { DocsController } from './docs.controller.js';
import { construirOpenApi } from './openapi.js';

type Doc = {
  openapi: string;
  paths: Record<string, Record<string, { security?: unknown[]; requestBody?: unknown; description?: string; responses: Record<string, unknown> }>>;
  components: { schemas: Record<string, { properties: Record<string, { enum?: string[] }> }> };
};
const doc = construirOpenApi() as unknown as Doc;

/** Rotas reais de um controller como "METODO /caminho/{param}". */
function rotasDe(controller: new (...a: never[]) => object): string[] {
  const base = Reflect.getMetadata(PATH_METADATA, controller) as string;
  const proto = controller.prototype as Record<string, unknown>;
  return Object.getOwnPropertyNames(proto)
    .filter((n) => n !== 'constructor' && typeof proto[n] === 'function')
    .flatMap((n) => {
      const fn = proto[n] as object;
      const metodo = Reflect.getMetadata(METHOD_METADATA, fn) as RequestMethod | undefined;
      if (metodo === undefined) return [];
      const sub = Reflect.getMetadata(PATH_METADATA, fn) as string;
      const caminho = `/${[base, sub].filter((s) => s && s !== '/').join('/')}`.replace(/:(\w+)/g, '{$1}');
      return [`${RequestMethod[metodo]} ${caminho}`];
    });
}

describe('OpenAPI', () => {
  it('e OpenAPI 3.1', () => {
    expect(doc.openapi).toBe('3.1.0');
  });

  it('documenta exatamente as rotas dos controllers (sem rota esquecida nem sobrando)', () => {
    const reais = [...rotasDe(ChamadosController), ...rotasDe(HealthController)].sort();
    const documentadas = Object.entries(doc.paths)
      .flatMap(([caminho, ops]) => Object.keys(ops).map((m) => `${m.toUpperCase()} ${caminho}`))
      .sort();
    expect(documentadas).toEqual(reais);
  });

  it('deriva o corpo da validacao Zod: campos exigidos, strict e consentimento', () => {
    const corpo = doc.paths['/chamados']!.post!.requestBody as {
      content: { 'application/json': { schema: Record<string, unknown> } };
    };
    const s = corpo.content['application/json'].schema as {
      required: string[]; additionalProperties: boolean; properties: Record<string, unknown>;
    };
    expect(s.required).toEqual(expect.arrayContaining(['jobId', 'candidato', 'consentimentoLgpd']));
    expect(s.additionalProperties).toBe(false);
    expect(s.properties.consentimentoLgpd).toMatchObject({ const: true });
    expect(s).not.toHaveProperty('$schema');
  });

  it('transicoes: uniao discriminada por acao', () => {
    const corpo = doc.paths['/chamados/{id}/transicoes']!.post!.requestBody as {
      content: { 'application/json': { schema: { oneOf?: unknown[]; anyOf?: unknown[] } } };
    };
    const s = corpo.content['application/json'].schema;
    expect((s.oneOf ?? s.anyOf)).toHaveLength(3);
  });

  it('papeis na descricao vem do mesmo metadado do guard', () => {
    expect(doc.paths['/chamados']!.post!.description).toContain('RECRUTADOR, DP');
    expect(doc.paths['/chamados/{protocolo}']!.get!.description).not.toContain('Papeis permitidos');
  });

  it('so /health e publica; as demais exigem Bearer', () => {
    expect(doc.paths['/health']!.get!.security).toEqual([]);
    expect(doc.paths['/chamados']!.post!.security).toBeUndefined();
  });

  it('status do ChamadoView lista todos os status do dominio', () => {
    expect(doc.components.schemas.ChamadoView!.properties.status!.enum).toHaveLength(10);
  });
});

describe('GET /openapi.json (guard real)', () => {
  it('abre sem token, preserva autenticacao e documenta o erro real de validacao', async () => {
    const mod = await Test.createTestingModule({
      controllers: [DocsController, ChamadosController],
      providers: [
        { provide: ChamadosService, useValue: {} },
        { provide: ConfigService, useValue: { get: () => 'segredo-de-teste-com-mais-de-32-caracteres' } },
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    }).compile();
    const app = mod.createNestApplication();
    await app.init();
    try {
      const r = await request(app.getHttpServer()).get('/openapi.json').expect(200);
      expect(r.body.openapi).toBe('3.1.0');
      expect(Object.keys(r.body.paths)).toContain('/chamados');
      await request(app.getHttpServer()).get('/chamados/ADM-2026-000001').expect(401);
      const token = assinarToken({
        tenantId: '00000000-0000-4000-8000-000000000001',
        userId: '00000000-0000-4000-8000-000000000002',
        role: 'RECRUTADOR',
      }, 'segredo-de-teste-com-mais-de-32-caracteres');
      const invalida = await request(app.getHttpServer()).post('/chamados')
        .set('Authorization', `Bearer ${token}`).send({}).expect(400);
      expect(invalida.body.erros.length).toBeGreaterThan(0);
      expect(invalida.body).not.toHaveProperty('statusCode');
      const erroSchema = r.body.components.schemas.Erro;
      for (const campo of erroSchema.required) expect(invalida.body).toHaveProperty(campo);
      expect(erroSchema.anyOf).toContainEqual({ required: ['erros'] });
    } finally {
      await app.close();
    }
  });
});
