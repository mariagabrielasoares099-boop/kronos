import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assinarToken } from '../auth/token.js';
import type { DbContext } from '../db/db-context.js';
import { TAMANHO_MAXIMO_BYTES } from './arquivo.js';
import { MAX_DOCUMENTOS_POR_CHAMADO } from './documentos.service.js';

/**
 * Documentos ponta a ponta (Nest + multer + RLS + disco) contra Postgres DESCARTAVEL.
 * Mesmas variaveis do teste de chamados: TEST_ADMIN_DATABASE_URL e TEST_APP_DATABASE_URL.
 */
const ADMIN = process.env.TEST_ADMIN_DATABASE_URL;
const APP = process.env.TEST_APP_DATABASE_URL;
const SEGREDO = 'segredo-de-teste-com-mais-de-32-caracteres';
const id = () => randomUUID();

const PDF = Buffer.from('%PDF-1.7\nconteudo de teste\n%%EOF');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const HTML_DISFARCADO = Buffer.from('<html><script>alert(1)</script></html>');

/** Contagem de arquivos no storage (para provar que nada fica orfao). */
async function arquivosEm(dir: string): Promise<number> {
  const tenants = await readdir(dir).catch(() => [] as string[]);
  let n = 0;
  for (const t of tenants) n += (await readdir(join(dir, t))).length;
  return n;
}

describe.skipIf(!ADMIN || !APP)('API de documentos (HTTP + RLS + storage)', () => {
  const T = id(), T2 = id();
  const rhA = id(), rhB = id(), dp = id(), gestor = id(), adm = id(), rhOutro = id();
  const matriz = id(), empresa2 = id(), jobA = id(), job2 = id();

  let admin: Client;
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let storageDir = '';

  const tok = (c: DbContext) => `Bearer ${assinarToken(c, SEGREDO)}`;
  const tRhA = tok({ tenantId: T, userId: rhA, role: 'RECRUTADOR' });
  const tRhB = tok({ tenantId: T, userId: rhB, role: 'RECRUTADOR' }); // mesma empresa, nao atribuido
  const tDp = tok({ tenantId: T, userId: dp, role: 'DP' });
  const tGestor = tok({ tenantId: T, userId: gestor, role: 'GESTOR_VAGA' });
  const tAdmin = tok({ tenantId: T, userId: adm, role: 'ADMIN' });
  const tOutroTenant = tok({ tenantId: T2, userId: rhOutro, role: 'RECRUTADOR' });

  let chamado = '', chamado2 = '', tCandidato = '', tCandidato2 = '';

  /** O trigger de atribuicao confere o vinculo usando o tenant da sessao (app_tenant()). */
  const atribuir = async (ticket: string, ...users: string[]) => {
    await admin.query(`SELECT set_config('app.tenant_id', $1, false)`, [T]);
    for (const u of users) {
      await admin.query(`INSERT INTO ticket_assignments (tenant_id, ticket_id, user_id) VALUES ($1,$2,$3)`, [T, ticket, u]);
    }
  };

  const abrir = async (cpf: string) => {
    const r = await http.post('/chamados').set('Authorization', tRhA).send({
      jobId: jobA, candidato: { nome: 'Joana Lima', email: `j${cpf}@example.com`, cpf }, consentimentoLgpd: true,
    }).expect(201);
    const { rows } = await admin.query(`SELECT candidate_id FROM tickets WHERE id=$1`, [r.body.id]);
    return { id: r.body.id as string, token: tok({ tenantId: T, candidateId: rows[0].candidate_id }) };
  };

  const enviar = (auth: string, chamadoId: string, tipo: string, conteudo: Buffer, nome = 'doc.pdf') =>
    http.post(`/chamados/${chamadoId}/documentos`).set('Authorization', auth).field('tipo', tipo).attach('arquivo', conteudo, nome);

  beforeAll(async () => {
    storageDir = await mkdtemp(join(tmpdir(), 'kronos-docs-'));
    process.env.DATABASE_URL = APP!;
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.JWT_SECRET = SEGREDO;
    process.env.ENCRYPTION_KEY = 'k'.repeat(40);
    process.env.RATE_LIMIT_MAX = '1000';
    process.env.STORAGE_DIR = storageDir;

    admin = new Client({ connectionString: ADMIN });
    await admin.connect();
    const q = (sql: string, p: unknown[] = []) => admin.query(sql, p);
    await q(`INSERT INTO tenants (id, nome) VALUES ($1, 'T'), ($2, 'T2')`, [T, T2]);
    const usuarios = [[rhA, 'RECRUTADOR'], [rhB, 'RECRUTADOR'], [dp, 'DP'], [gestor, 'GESTOR_VAGA'], [adm, 'ADMIN']] as const;
    for (const [u, r] of usuarios) {
      await q(`INSERT INTO users (id, tenant_id, nome, email, role, password_hash) VALUES ($1,$2,'u',$3,$4,'x')`, [u, T, `${u}@t.com`, r]);
    }
    await q(`INSERT INTO users (id, tenant_id, nome, email, role, password_hash) VALUES ($1,$2,'u',$3,'RECRUTADOR','x')`, [rhOutro, T2, `${rhOutro}@t.com`]);
    await q(`INSERT INTO companies (id, tenant_id, cnpj, razao_social) VALUES ($1,$2,'11111111000111','A')`, [matriz, T]);
    await q(`INSERT INTO companies (id, tenant_id, cnpj, razao_social) VALUES ($1,$2,'22222222000122','B')`, [empresa2, T2]);
    for (const u of [rhA, rhB, dp, gestor, adm]) {
      await q(`INSERT INTO user_companies (tenant_id, user_id, company_id) VALUES ($1,$2,$3)`, [T, u, matriz]);
    }
    await q(`INSERT INTO user_companies (tenant_id, user_id, company_id) VALUES ($1,$2,$3)`, [T2, rhOutro, empresa2]);
    await q(`INSERT INTO jobs (id, tenant_id, company_id, titulo, fluxo) VALUES ($1,$2,$3,'va','{}')`, [jobA, T, matriz]);
    await q(`INSERT INTO jobs (id, tenant_id, company_id, titulo, fluxo) VALUES ($1,$2,$3,'v2','{}')`, [job2, T2, empresa2]);

    const { AppModule } = await import('../app.module.js');
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    http = request(app.getHttpServer());

    const c1 = await abrir('529.982.247-25');
    const c2 = await abrir('111.444.777-35');
    chamado = c1.id; tCandidato = c1.token;
    chamado2 = c2.id; tCandidato2 = c2.token;
    await atribuir(chamado, rhA, dp, gestor);
    await atribuir(chamado2, rhA);
  }, 90_000);

  afterAll(async () => {
    await app?.close();
    if (admin) {
      try {
        await admin.query('ALTER TABLE ticket_events DISABLE TRIGGER ticket_events_immutable');
        for (const t of [T, T2]) {
          await admin.query(`SELECT set_config('app.tenant_id', $1, false)`, [t]);
          for (const tab of ['documents', 'ticket_assignments', 'ticket_events', 'tickets', 'jobs', 'candidates',
            'user_companies', 'companies', 'users', 'protocol_counters']) {
            await admin.query(`DELETE FROM ${tab} WHERE tenant_id = $1`, [t]).catch(() => undefined);
          }
          await admin.query('DELETE FROM tenants WHERE id = $1', [t]).catch(() => undefined);
        }
      } finally {
        await admin.query('ALTER TABLE ticket_events ENABLE TRIGGER ticket_events_immutable');
        await admin.end();
      }
    }
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
  });

  let docRg = '';

  it('o candidato envia o proprio documento: nasce PENDENTE e a resposta nao expoe o storage', async () => {
    const r = await enviar(tCandidato, chamado, 'RG', PDF).expect(201);
    expect(r.body).toMatchObject({ chamadoId: chamado, tipo: 'RG', status: 'PENDENTE', motivo: null, mime: 'application/pdf', tamanhoBytes: PDF.length });
    expect(JSON.stringify(r.body)).not.toMatch(/chave|storage|sha256/i);
    docRg = r.body.id;
    expect(await arquivosEm(storageDir)).toBe(1);
  });

  it('confere o tipo pelo conteudo, valida campos e exige o arquivo', async () => {
    await enviar(tCandidato, chamado, 'RG', HTML_DISFARCADO, 'rg.pdf').expect(400);
    await enviar(tCandidato, chamado, 'PASSAPORTE', PDF).expect(400);
    await enviar(tCandidato, chamado, 'RG', Buffer.alloc(0)).expect(400);
    await http.post(`/chamados/${chamado}/documentos`).set('Authorization', tCandidato).field('tipo', 'RG').expect(400);
    await http.post(`/chamados/${chamado}/documentos`).set('Authorization', tCandidato)
      .field('tipo', 'RG').field('status', 'APROVADO').attach('arquivo', PDF, 'a.pdf').expect(400);
    await enviar(tCandidato, 'nao-e-uuid', 'RG', PDF).expect(400);
    await http.post(`/chamados/${chamado}/documentos`).field('tipo', 'RG').attach('arquivo', PDF, 'a.pdf').expect(401);
    expect(await arquivosEm(storageDir)).toBe(1);
  });

  it('arquivo acima do limite responde 413 e nao grava nada', async () => {
    const grande = Buffer.concat([PDF, Buffer.alloc(TAMANHO_MAXIMO_BYTES)]);
    await enviar(tCandidato, chamado, 'CPF', grande).expect(413);
    expect(await arquivosEm(storageDir)).toBe(1);
  });

  it('quem nao pode enviar recebe 404 e o arquivo nao fica orfao', async () => {
    await enviar(tCandidato2, chamado, 'RG', PDF).expect(404); // candidato de outro chamado
    await enviar(tRhB, chamado, 'RG', PDF).expect(404); // equipe sem atribuicao
    await enviar(tAdmin, chamado, 'RG', PDF).expect(404);
    await enviar(tOutroTenant, chamado, 'RG', PDF).expect(404);
    await enviar(tRhA, id(), 'RG', PDF).expect(404); // chamado inexistente
    expect(await arquivosEm(storageDir)).toBe(1);
  });

  it('a equipe atribuida tambem envia', async () => {
    const r = await enviar(tRhA, chamado, 'CPF', PNG, 'cpf.png').expect(201);
    expect(r.body.mime).toBe('image/png');
  });

  it('lista com checklist; so equipe atribuida e o proprio candidato veem', async () => {
    const r = await http.get(`/chamados/${chamado}/documentos`).set('Authorization', tRhA).expect(200);
    expect(r.body.checklist).toEqual([
      { tipo: 'RG', situacao: 'PENDENTE' },
      { tipo: 'CPF', situacao: 'PENDENTE' },
      { tipo: 'COMPROVANTE_RESIDENCIA', situacao: 'FALTANDO' },
    ]);
    expect(r.body.documentos.map((d: { tipo: string }) => d.tipo)).toEqual(['RG', 'CPF']);
    await http.get(`/chamados/${chamado}/documentos`).set('Authorization', tCandidato).expect(200);
    for (const t of [tRhB, tAdmin, tOutroTenant, tCandidato2]) {
      await http.get(`/chamados/${chamado}/documentos`).set('Authorization', t).expect(404);
    }
  });

  it('download autenticado devolve o arquivo como anexo, sem cache; os demais recebem 404', async () => {
    for (const t of [tCandidato, tRhA]) {
      const r = await http.get(`/documentos/${docRg}/arquivo`).set('Authorization', t)
        .buffer(true).parse((res, cb) => {
          const partes: Buffer[] = [];
          res.on('data', (c: Buffer) => partes.push(c));
          res.on('end', () => cb(null, Buffer.concat(partes)));
        })
        .expect(200);
      expect((r.body as Buffer).equals(PDF)).toBe(true);
      expect(r.headers['content-type']).toMatch(/^application\/pdf/);
      expect(r.headers['content-disposition']).toBe(`attachment; filename="documento-${docRg}.pdf"`);
      expect(r.headers['cache-control']).toBe('private, no-store');
      expect(r.headers['x-content-type-options']).toBe('nosniff');
    }
    for (const t of [tRhB, tAdmin, tOutroTenant, tCandidato2]) {
      await http.get(`/documentos/${docRg}/arquivo`).set('Authorization', t).expect(404);
    }
    await http.get(`/documentos/${docRg}/arquivo`).expect(401);
    await http.get('/documentos/nao-e-uuid/arquivo').set('Authorization', tRhA).expect(400);
  });

  it('decidir e so do RH atribuido; recusa exige motivo', async () => {
    const d = (corpo: object, auth = tRhA, doc = docRg) => http.patch(`/documentos/${doc}`).set('Authorization', auth).send(corpo);
    await d({ acao: 'APROVAR' }, tCandidato).expect(403);
    await d({ acao: 'APROVAR' }, tGestor).expect(403);
    await d({ acao: 'APROVAR' }, tRhB).expect(404);
    await d({ acao: 'APROVAR' }, tOutroTenant).expect(404);
    await d({ acao: 'RECUSAR' }).expect(400);
    await d({ acao: 'APROVAR', status: 'APROVADO' }).expect(400);
    await d({ acao: 'APROVAR' }, tRhA, id()).expect(404);

    const r = await d({ acao: 'RECUSAR', motivo: 'Foto ilegivel' }).expect(200);
    expect(r.body).toMatchObject({ status: 'RECUSADO', motivo: 'Foto ilegivel' });
    await d({ acao: 'APROVAR' }, tDp).expect(409); // ja decidido
  });

  it('a decisao entra na trilha do chamado com autor e motivo', async () => {
    const { rows } = await admin.query(
      `SELECT tipo, autor, motivo, payload FROM ticket_events WHERE ticket_id=$1 AND tipo LIKE 'DOCUMENTO_%'`, [chamado]);
    expect(rows).toEqual([{ tipo: 'DOCUMENTO_RECUSADO', autor: rhA, motivo: 'Foto ilegivel', payload: { documentoId: docRg, tipoDocumento: 'RG' } }]);
  });

  it('reenvio apos recusa: o checklist passa a valer o envio mais novo', async () => {
    const r = await enviar(tCandidato, chamado, 'RG', PNG, 'rg.png').expect(201);
    await http.patch(`/documentos/${r.body.id}`).set('Authorization', tDp).send({ acao: 'APROVAR' }).expect(200);
    const l = await http.get(`/chamados/${chamado}/documentos`).set('Authorization', tCandidato).expect(200);
    expect(l.body.checklist[0]).toEqual({ tipo: 'RG', situacao: 'APROVADO' });
    expect(l.body.documentos.find((x: { id: string }) => x.id === docRg).motivo).toBe('Foto ilegivel');
  });

  it('duas decisoes simultaneas: so uma vence', async () => {
    const r = await enviar(tCandidato, chamado, 'COMPROVANTE_RESIDENCIA', PDF).expect(201);
    const res = await Promise.all([tRhA, tDp].map((t) => http.patch(`/documentos/${r.body.id}`).set('Authorization', t).send({ acao: 'APROVAR' })));
    expect(res.map((x) => x.status).sort((a, b) => a - b)).toEqual([200, 409]);
    const { rows } = await admin.query(`SELECT count(*)::int AS n FROM ticket_events WHERE payload->>'documentoId' = $1`, [r.body.id]);
    expect(rows[0].n).toBe(1);
  });

  it('limite de documentos por chamado responde 409 sem gravar arquivo', async () => {
    await admin.query(`SELECT set_config('app.tenant_id', $1, false)`, [T]);
    await admin.query(
      `INSERT INTO documents (id, tenant_id, ticket_id, tipo, chave_storage, mime, tamanho_bytes, sha256)
       SELECT gen_random_uuid(), $1, $2, 'OUTRO', 'x/' || g, 'application/pdf', 1, repeat('a', 64)
       FROM generate_series(1, $3::int) g`,
      [T, chamado2, MAX_DOCUMENTOS_POR_CHAMADO]);
    const antes = await arquivosEm(storageDir);
    await enviar(tCandidato2, chamado2, 'RG', PDF).expect(409);
    expect(await arquivosEm(storageDir)).toBe(antes);
  });
});
