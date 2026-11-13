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
 * Atribuicao de chamados (HTTP + RLS + auditoria) contra Postgres DESCARTAVEL:
 *   TEST_ADMIN_DATABASE_URL (administrador) e TEST_APP_DATABASE_URL (papel da API).
 */
const ADMIN = process.env.TEST_ADMIN_DATABASE_URL;
const APP = process.env.TEST_APP_DATABASE_URL;
const SEGREDO = 'segredo-de-teste-com-mais-de-32-caracteres';
const id = () => randomUUID();

describe.skipIf(!ADMIN || !APP)('Atribuicao de chamados (HTTP + RLS)', () => {
  const T = id(), T2 = id();
  const dpA = id(), recA2 = id(), rhB = id(), gestor = id(), rhT2 = id(), admin1 = id();
  const empA = id(), empB = id(), empT2 = id(), jobA = id(), jobT2 = id(), cand = id(), cand2 = id(), candT2 = id();
  const chamado = id(), chamadoPre = id(), chamadoT2 = id();

  let adm: Client;
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let dir: string;

  const tok = (c: DbContext) => `Bearer ${assinarToken(c, SEGREDO)}`;
  const tDp = tok({ tenantId: T, userId: dpA, role: 'DP' });
  const tRecA2 = tok({ tenantId: T, userId: recA2, role: 'RECRUTADOR' });
  const tRhB = tok({ tenantId: T, userId: rhB, role: 'RECRUTADOR' }); // vinculado so a OUTRA empresa
  const tGestor = tok({ tenantId: T, userId: gestor, role: 'GESTOR_VAGA' });
  const tAdmin = tok({ tenantId: T, userId: admin1, role: 'ADMIN' });
  const tCand = tok({ tenantId: T, candidateId: cand });
  const tT2 = tok({ tenantId: T2, userId: rhT2, role: 'RECRUTADOR' });

  const atribuir = (token: string, chamadoId: string, corpo?: object) =>
    http.post(`/chamados/${chamadoId}/atribuicao`).set('Authorization', token).send(corpo ?? {});
  const q = (sql: string, p: unknown[] = []) => adm.query(sql, p);

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'kronos-atrib-'));
    process.env.DATABASE_URL = APP!;
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.JWT_SECRET = SEGREDO;
    process.env.ENCRYPTION_KEY = 'k'.repeat(40);
    process.env.RATE_LIMIT_MAX = '1000';
    process.env.STORAGE_DIR = dir;

    adm = new Client({ connectionString: ADMIN });
    await adm.connect();
    await q(`INSERT INTO tenants (id, nome) VALUES ($1,'T'), ($2,'T2')`, [T, T2]);
    for (const [u, t, n, r] of [
      [dpA, T, 'dpa', 'DP'], [recA2, T, 'reca2', 'RECRUTADOR'], [rhB, T, 'rhb', 'RECRUTADOR'], [gestor, T, 'gestor', 'GESTOR_VAGA'],
      [admin1, T, 'adm', 'ADMIN'], [rhT2, T2, 'rht2', 'RECRUTADOR'],
    ] as const) {
      await q(`INSERT INTO users (id, tenant_id, nome, email, role, password_hash) VALUES ($1,$2,$3,$4,$5,'x')`, [u, t, n, `${n}-${u}@t.com`, r]);
    }
    await q(`INSERT INTO companies (id, tenant_id, cnpj, razao_social) VALUES ($1,$4,'11111111000111','A'), ($2,$4,'22222222000122','B'), ($3,$5,'33333333000133','X')`, [empA, empB, empT2, T, T2]);
    // dpA, recA2 e gestor so na empresa A; rhB so na B; rhT2 na empresa do outro tenant.
    await q(`INSERT INTO user_companies (tenant_id, user_id, company_id) VALUES ($1,$2,$3), ($1,$4,$3), ($1,$5,$3), ($1,$6,$7), ($8,$9,$10)`,
      [T, dpA, empA, recA2, gestor, rhB, empB, T2, rhT2, empT2]);
    await q(`INSERT INTO jobs (id, tenant_id, company_id, titulo) VALUES ($1,$3,$4,'va'), ($2,$5,$6,'vt2')`, [jobA, jobT2, T, empA, T2, empT2]);
    for (const [c, t, n, cpf] of [[cand, T, 'c1', '52998224725'], [cand2, T, 'c2', '11144477735'], [candT2, T2, 'c3', '39053344705']] as const) {
      await q(`INSERT INTO candidates (id, tenant_id, cpf, nome, email, consentimento_lgpd) VALUES ($1,$2,$3,$4,$5, now())`, [c, t, cpf, n, `${n}@example.com`]);
    }
    for (const [tk, t, p, j, c] of [
      [chamado, T, 'ADM-2026-000001', jobA, cand], [chamadoPre, T, 'ADM-2026-000002', jobA, cand2], [chamadoT2, T2, 'ADM-2026-000001', jobT2, candT2],
    ] as const) {
      await q(`INSERT INTO tickets (id, tenant_id, protocolo, job_id, candidate_id, status) VALUES ($1,$2,$3,$4,$5,'TRIAGEM')`, [tk, t, p, j, c]);
    }
    const { AppModule } = await import('../app.module.js');
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    http = request(app.getHttpServer());
  }, 90_000);

  afterAll(async () => {
    await app?.close();
    if (adm) {
      try {
        await adm.query('ALTER TABLE ticket_events DISABLE TRIGGER ticket_events_immutable').catch(() => undefined);
        for (const t of ['documents', 'ticket_assignments', 'ticket_events', 'tickets', 'jobs', 'candidates', 'user_companies', 'companies', 'users', 'protocol_counters']) {
          await adm.query(`DELETE FROM ${t} WHERE tenant_id = ANY($1)`, [[T, T2]]).catch(() => undefined);
        }
        await adm.query('DELETE FROM tenants WHERE id = ANY($1)', [[T, T2]]).catch(() => undefined);
      } finally {
        await adm.query('ALTER TABLE ticket_events ENABLE TRIGGER ticket_events_immutable').catch(() => undefined);
        await adm.end();
      }
    }
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  const atribuicoes = async (ticket: string) =>
    (await q('SELECT user_id FROM ticket_assignments WHERE ticket_id = $1', [ticket])).rows.map((r) => r.user_id as string);
  const eventosAtrib = async (ticket: string) =>
    (await q(`SELECT autor, payload FROM ticket_events WHERE ticket_id = $1 AND tipo = 'ATRIBUICAO' ORDER BY created_at`, [ticket])).rows;

  it('exige token de equipe com papel RECRUTADOR/DP: sem token 401; candidato, gestor e ADMIN 403', async () => {
    await http.post(`/chamados/${chamado}/atribuicao`).send({}).expect(401);
    await atribuir(tCand, chamado).expect(403);
    await atribuir(tGestor, chamado).expect(403);
    await atribuir(tAdmin, chamado).expect(403);
    expect(await atribuicoes(chamado)).toEqual([]);
  });

  it('antes de atribuir, quem ve o chamado nao ve os documentos (404); a fila ja mostra o chamado', async () => {
    await http.get(`/chamados/${chamado}/documentos`).set('Authorization', tDp).expect(404);
    expect((await http.get('/chamados').set('Authorization', tDp).expect(200)).body.length).toBeGreaterThan(0);
  });

  it('quem chama assume o chamado: grava atribuicao, responsavel e evento de auditoria', async () => {
    const r = await atribuir(tDp, chamado).expect(200);
    expect(r.body).toEqual({ chamadoId: chamado, usuarioId: dpA, usuarioNome: 'dpa', jaAtribuido: false });
    expect(await atribuicoes(chamado)).toEqual([dpA]);
    expect((await q('SELECT responsavel FROM tickets WHERE id = $1', [chamado])).rows[0].responsavel).toBe(dpA);
    const ev = await eventosAtrib(chamado);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ autor: dpA, payload: { usuarioId: dpA, usuarioNome: 'dpa' } });
    // Agora os documentos aparecem para quem foi atribuido.
    await http.get(`/chamados/${chamado}/documentos`).set('Authorization', tDp).expect(200);
  });

  it('e idempotente: repetir nao duplica atribuicao nem evento', async () => {
    const r = await atribuir(tDp, chamado).expect(200);
    expect(r.body.jaAtribuido).toBe(true);
    expect(await atribuicoes(chamado)).toEqual([dpA]);
    expect(await eventosAtrib(chamado)).toHaveLength(1);
  });

  it('atribui outra pessoa da mesma empresa; o autor no evento e quem atribuiu', async () => {
    await http.get(`/chamados/${chamado}/documentos`).set('Authorization', tRecA2).expect(404); // ainda nao atribuido
    const r = await atribuir(tDp, chamado, { usuarioId: recA2 }).expect(200);
    expect(r.body).toMatchObject({ usuarioId: recA2, usuarioNome: 'reca2', jaAtribuido: false });
    expect((await atribuicoes(chamado)).sort()).toEqual([dpA, recA2].sort());
    const ev = await eventosAtrib(chamado);
    expect(ev[1]).toMatchObject({ autor: dpA, payload: { usuarioId: recA2, usuarioNome: 'reca2' } });
    expect((await q('SELECT responsavel FROM tickets WHERE id = $1', [chamado])).rows[0].responsavel).toBe(recA2);
    await http.get(`/chamados/${chamado}/documentos`).set('Authorization', tRecA2).expect(200);
  });

  it('a linha do tempo mostra a atribuicao com autor e destino, so para a equipe', async () => {
    const r = await http.get(`/chamados/${chamado}/eventos`).set('Authorization', tDp).expect(200);
    const atrib = r.body.filter((e: { tipo: string }) => e.tipo === 'ATRIBUICAO');
    expect(atrib.map((e: { detalhe: string }) => e.detalhe)).toEqual(['Atribuido a dpa', 'Atribuido a reca2']);
    expect(atrib[0]).toMatchObject({ autorNome: 'dpa', para: null });
    await http.get(`/chamados/${chamado}/eventos`).set('Authorization', tCand).expect(403);
  });

  it('nega atribuir a quem nao tem vinculo com a empresa do chamado, ou papel sem permissao de documentos (409)', async () => {
    await atribuir(tDp, chamadoPre, { usuarioId: rhB }).expect(409); // vinculado a outra empresa do mesmo tenant
    await atribuir(tDp, chamadoPre, { usuarioId: gestor }).expect(409); // GESTOR_VAGA nao decide documentos
    await atribuir(tDp, chamadoPre, { usuarioId: admin1 }).expect(409);
    expect(await atribuicoes(chamadoPre)).toEqual([]);
    expect(await eventosAtrib(chamadoPre)).toEqual([]);
  });

  it('nega pelo RLS: outro tenant, usuario inexistente e chamado de outra empresa/tenant respondem 404', async () => {
    await atribuir(tDp, chamadoPre, { usuarioId: rhT2 }).expect(404); // usuario de outro tenant nao existe para este
    await atribuir(tDp, chamadoPre, { usuarioId: id() }).expect(404);
    await atribuir(tDp, chamadoT2).expect(404); // chamado de outro tenant
    await atribuir(tT2, chamado).expect(404); // e o inverso
    await atribuir(tRhB, chamadoPre).expect(404); // RECRUTADOR de outra empresa nem enxerga o chamado
    await atribuir(tRhB, chamadoPre, { usuarioId: rhB }).expect(404); // nem se atribui sozinho a ele
    expect(await atribuicoes(chamadoPre)).toEqual([]);
    expect(await atribuicoes(chamadoT2)).toEqual([]);
  });

  it('valida a entrada: id invalido, usuarioId invalido e campo extra respondem 400', async () => {
    await atribuir(tDp, 'nao-e-uuid').expect(400);
    await atribuir(tDp, chamadoPre, { usuarioId: 'x' }).expect(400);
    await atribuir(tDp, chamadoPre, { usuarioId: recA2, extra: 1 }).expect(400);
    expect(await atribuicoes(chamadoPre)).toEqual([]);
  });

  it('quem nao foi atribuido continua sem acesso aos documentos', async () => {
    await http.get(`/chamados/${chamadoPre}/documentos`).set('Authorization', tDp).expect(404);
    await http.get(`/chamados/${chamado}/documentos`).set('Authorization', tRhB).expect(404);
  });
});
