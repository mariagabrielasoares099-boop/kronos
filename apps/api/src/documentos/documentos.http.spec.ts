import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assinarToken } from '../auth/token.js';
import type { DbContext } from '../db/db-context.js';

/**
 * Upload/download/decisao de documentos (HTTP + RLS) contra Postgres DESCARTAVEL:
 *   TEST_ADMIN_DATABASE_URL (administrador) e TEST_APP_DATABASE_URL (papel da API).
 */
const ADMIN = process.env.TEST_ADMIN_DATABASE_URL;
const APP = process.env.TEST_APP_DATABASE_URL;
const SEGREDO = 'segredo-de-teste-com-mais-de-32-caracteres';
const id = () => randomUUID();

const PDF = Buffer.from('%PDF-1.7\nconteudo de teste');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0]);

describe.skipIf(!ADMIN || !APP)('API de documentos (HTTP + RLS)', () => {
  const T = id(), T2 = id(), rhA = id(), rhB = id(), rhOutroTenant = id(), gestor = id();
  const matriz = id(), matriz2 = id(), jobA = id(), job2 = id(), cand = id(), cand2 = id(), cand3 = id();
  const chamado = id(), chamado2 = id(), chamadoOutroCandidato = id();

  let admin: Client;
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let dir: string;

  const tok = (c: DbContext) => `Bearer ${assinarToken(c, SEGREDO)}`;
  const tRhA = tok({ tenantId: T, userId: rhA, role: 'RECRUTADOR' });
  const tRhB = tok({ tenantId: T, userId: rhB, role: 'RECRUTADOR' }); // sem atribuicao ao chamado
  const tOutroTenant = tok({ tenantId: T2, userId: rhOutroTenant, role: 'RECRUTADOR' });
  const tGestor = tok({ tenantId: T, userId: gestor, role: 'GESTOR_VAGA' });
  const tCand = tok({ tenantId: T, candidateId: cand });
  const tCandOutro = tok({ tenantId: T, candidateId: cand3 });

  const enviar = (token: string, chamadoId: string, tipo: string, arq: Buffer, nome = 'rg.pdf') =>
    http.post(`/chamados/${chamadoId}/documentos`).set('Authorization', token).field('tipo', tipo).attach('arquivo', arq, nome);

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'kronos-docs-'));
    process.env.DATABASE_URL = APP!;
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.JWT_SECRET = SEGREDO;
    process.env.ENCRYPTION_KEY = 'k'.repeat(40);
    process.env.RATE_LIMIT_MAX = '1000';
    process.env.STORAGE_DIR = dir;

    admin = new Client({ connectionString: ADMIN });
    await admin.connect();
    const q = (sql: string, p: unknown[] = []) => admin.query(sql, p);
    await q(`INSERT INTO tenants (id, nome) VALUES ($1,'T'), ($2,'T2')`, [T, T2]);
    for (const [u, t, n, r] of [
      [rhA, T, 'rha', 'RECRUTADOR'], [rhB, T, 'rhb', 'RECRUTADOR'], [gestor, T, 'gestor', 'GESTOR_VAGA'], [rhOutroTenant, T2, 'rht2', 'RECRUTADOR'],
    ] as const) {
      await q(`INSERT INTO users (id, tenant_id, nome, email, role, password_hash) VALUES ($1,$2,$3,$4,$5,'x')`, [u, t, n, `${n}-${u}@t.com`, r]);
    }
    await q(`INSERT INTO companies (id, tenant_id, cnpj, razao_social) VALUES ($1,$3,'11111111000111','A'), ($2,$4,'33333333000133','X')`, [matriz, matriz2, T, T2]);
    await q(`INSERT INTO user_companies (tenant_id, user_id, company_id) VALUES ($1,$2,$3), ($1,$4,$3), ($5,$6,$7)`, [T, rhA, matriz, rhB, T2, rhOutroTenant, matriz2]);
    await q(`INSERT INTO jobs (id, tenant_id, company_id, titulo) VALUES ($1,$3,$4,'va'), ($2,$5,$6,'v2')`, [jobA, job2, T, matriz, T2, matriz2]);
    for (const [c, t, n, cpf] of [[cand, T, 'c1', '52998224725'], [cand3, T, 'c3', '11144477735'], [cand2, T2, 'c2', '39053344705']] as const) {
      await q(`INSERT INTO candidates (id, tenant_id, cpf, nome, email, consentimento_lgpd) VALUES ($1,$2,$3,$4,$5, now())`, [c, t, cpf, n, `${n}@example.com`]);
    }
    for (const [tk, t, p, j, c] of [
      [chamado, T, 'ADM-2026-000001', jobA, cand], [chamadoOutroCandidato, T, 'ADM-2026-000002', jobA, cand3], [chamado2, T2, 'ADM-2026-000001', job2, cand2],
    ] as const) {
      await q(`INSERT INTO tickets (id, tenant_id, protocolo, job_id, candidate_id, status) VALUES ($1,$2,$3,$4,$5,'TRIAGEM')`, [tk, t, p, j, c]);
    }
    // Somente rhA esta atribuido ao chamado (documentos exigem vinculo com a empresa E atribuicao).
    // A trigger de atribuicao consulta o vinculo pelo tenant da sessao.
    await q(`SELECT set_config('app.tenant_id', $1, false)`, [T]);
    await q(`INSERT INTO ticket_assignments (tenant_id, ticket_id, user_id) VALUES ($1,$2,$3)`, [T, chamado, rhA]);

    const { AppModule } = await import('../app.module.js');
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    http = request(app.getHttpServer());
  }, 90_000);

  afterAll(async () => {
    await app?.close();
    if (admin) {
      try {
        await admin.query('ALTER TABLE ticket_events DISABLE TRIGGER ticket_events_immutable').catch(() => undefined);
        for (const t of ['documents', 'ticket_assignments', 'ticket_events', 'tickets', 'jobs', 'candidates', 'user_companies', 'companies', 'users', 'protocol_counters']) {
          await admin.query(`DELETE FROM ${t} WHERE tenant_id = ANY($1)`, [[T, T2]]).catch(() => undefined);
        }
        await admin.query('DELETE FROM tenants WHERE id = ANY($1)', [[T, T2]]).catch(() => undefined);
      } finally {
        await admin.query('ALTER TABLE ticket_events ENABLE TRIGGER ticket_events_immutable').catch(() => undefined);
        await admin.end();
      }
    }
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  let docId = '';

  it('exige token', async () => {
    await http.get(`/chamados/${chamado}/documentos`).expect(401);
    await http.post(`/chamados/${chamado}/documentos`).expect(401);
  });

  it('candidato envia o proprio documento: PENDENTE, sem vazar a chave de storage', async () => {
    const r = await enviar(tCand, chamado, 'RG', PDF).expect(201);
    expect(r.body).toMatchObject({ tipo: 'RG', status: 'PENDENTE', mime: 'application/pdf', chamadoId: chamado });
    expect(JSON.stringify(r.body)).not.toMatch(/chave|storage/i);
    docId = r.body.id;
  });

  it('o tipo vem do conteudo, nao do nome nem do Content-Type', async () => {
    const r = await enviar(tCand, chamado, 'CPF', PNG, 'foto.pdf').expect(201);
    expect(r.body.mime).toBe('image/png');
  });

  it('rejeita executavel disfarcado, arquivo vazio, acima do limite, tipo desconhecido e falta de arquivo', async () => {
    await enviar(tCand, chamado, 'RG', Buffer.from('MZ\x90\x00'), 'x.pdf').expect(400);
    await enviar(tCand, chamado, 'RG', Buffer.alloc(0)).expect(400);
    await enviar(tCand, chamado, 'RG', Buffer.concat([PDF, Buffer.alloc(5 * 1024 * 1024)])).expect(413);
    await enviar(tCand, chamado, 'PASSAPORTE', PDF).expect(400);
    await http.post(`/chamados/${chamado}/documentos`).set('Authorization', tCand).field('tipo', 'RG').expect(400);
  });

  it('isolamento: outro candidato, outro tenant e equipe sem atribuicao nao enxergam nem enviam', async () => {
    await enviar(tCandOutro, chamado, 'RG', PDF).expect(404);
    await enviar(tOutroTenant, chamado, 'RG', PDF).expect(404);
    await enviar(tRhB, chamado, 'RG', PDF).expect(404);
    for (const t of [tCandOutro, tOutroTenant, tRhB]) {
      await http.get(`/chamados/${chamado}/documentos`).set('Authorization', t).expect(404);
      await http.get(`/documentos/${docId}/arquivo`).set('Authorization', t).expect(404);
      await http.patch(`/documentos/${docId}`).set('Authorization', t).send({ status: 'APROVADO' }).expect(t === tCandOutro ? 403 : 404); // candidato nem chega a consultar
    }
  });

  it('lista com checklist (RG pendente, CPF pendente, comprovante faltando)', async () => {
    const r = await http.get(`/chamados/${chamado}/documentos`).set('Authorization', tRhA).expect(200);
    expect(r.body.documentos).toHaveLength(2);
    expect(r.body.checklist).toEqual([
      { tipo: 'RG', enviado: true, status: 'PENDENTE' },
      { tipo: 'CPF', enviado: true, status: 'PENDENTE' },
      { tipo: 'COMPROVANTE_RESIDENCIA', enviado: false, status: 'FALTANDO' },
    ]);
  });

  it('download autenticado devolve os mesmos bytes, como anexo e sem sniffing', async () => {
    const r = await http.get(`/documentos/${docId}/arquivo`).set('Authorization', tRhA).buffer(true).parse((res, cb) => {
      const partes: Buffer[] = [];
      res.on('data', (c: Buffer) => partes.push(c));
      res.on('end', () => cb(null, Buffer.concat(partes)));
    }).expect(200);
    expect(Buffer.compare(r.body, PDF)).toBe(0);
    expect(r.headers['content-type']).toContain('application/pdf');
    expect(r.headers['content-disposition']).toMatch(/^attachment/);
    expect(r.headers['x-content-type-options']).toBe('nosniff');
  });

  it('candidato nao decide; papel sem permissao recebe 403', async () => {
    await http.patch(`/documentos/${docId}`).set('Authorization', tCand).send({ status: 'APROVADO' }).expect(403);
    await http.patch(`/documentos/${docId}`).set('Authorization', tGestor).send({ status: 'APROVADO' }).expect(403);
  });

  it('valida a decisao: recusa exige motivo e campos extras sao rejeitados', async () => {
    await http.patch(`/documentos/${docId}`).set('Authorization', tRhA).send({ status: 'RECUSADO' }).expect(400);
    await http.patch(`/documentos/${docId}`).set('Authorization', tRhA).send({ status: 'APROVADO', revisadoPor: id() }).expect(400);
    await http.patch(`/documentos/${docId}`).set('Authorization', tRhA).send({ status: 'PENDENTE' }).expect(400);
  });

  it('RH aprova; decidir de novo da 409; recusa grava o motivo', async () => {
    const ok = await http.patch(`/documentos/${docId}`).set('Authorization', tRhA).send({ status: 'APROVADO' }).expect(200);
    expect(ok.body).toMatchObject({ status: 'APROVADO', motivo: null });
    await http.patch(`/documentos/${docId}`).set('Authorization', tRhA).send({ status: 'RECUSADO', motivo: 'ilegivel' }).expect(409);

    const outro = await enviar(tCand, chamado, 'COMPROVANTE_RESIDENCIA', PDF).expect(201);
    const rec = await http.patch(`/documentos/${outro.body.id}`).set('Authorization', tRhA).send({ status: 'RECUSADO', motivo: 'Conta antiga' }).expect(200);
    expect(rec.body).toMatchObject({ status: 'RECUSADO', motivo: 'Conta antiga' });
  });

  it('id malformado vira 400 e inexistente vira 404', async () => {
    await http.get('/documentos/nao-e-uuid/arquivo').set('Authorization', tRhA).expect(400);
    await http.get(`/documentos/${id()}/arquivo`).set('Authorization', tRhA).expect(404);
  });
});
