import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Criterio de pronto do M1 (etapa 2): o candidato entra no portal com protocolo + CPF, envia o documento e ele
 * aparece na API do chamado, persistido no storage; outro candidato nao enxerga. Postgres DESCARTAVEL:
 *   TEST_ADMIN_DATABASE_URL (administrador) e TEST_APP_DATABASE_URL (papel da API).
 */
const ADMIN = process.env.TEST_ADMIN_DATABASE_URL;
const APP = process.env.TEST_APP_DATABASE_URL;
const SEGREDO = 'segredo-de-teste-com-mais-de-32-caracteres';
const id = () => randomUUID();
const PDF = Buffer.from('%PDF-1.7\nconteudo de teste');

describe.skipIf(!ADMIN || !APP)('Portal do candidato: entrada + upload ponta a ponta (HTTP + RLS)', () => {
  const T = id(), T2 = id(), matriz = id(), matriz2 = id(), job = id(), job2 = id();
  const cand = id(), cand2 = id(), candT2 = id();
  const chamado = id(), chamado2 = id(), chamadoT2 = id();
  const CPF = '52998224725', CPF2 = '11144477735', CPF_T2 = '39053344705';

  let admin: Client;
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let dir: string;

  const entrar = (protocolo: string, cpf: string) => http.post('/portal/sessao').send({ protocolo, cpf });

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'kronos-portal-'));
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
    await q(`INSERT INTO companies (id, tenant_id, cnpj, razao_social) VALUES ($1,$3,'11111111000111','A'), ($2,$4,'33333333000133','X')`, [matriz, matriz2, T, T2]);
    await q(`INSERT INTO jobs (id, tenant_id, company_id, titulo) VALUES ($1,$3,$4,'va'), ($2,$5,$6,'v2')`, [job, job2, T, matriz, T2, matriz2]);
    for (const [c, t, n, cpf] of [[cand, T, 'c1', CPF], [cand2, T, 'c2', CPF2], [candT2, T2, 'c3', CPF_T2]] as const) {
      await q(`INSERT INTO candidates (id, tenant_id, cpf, nome, email, consentimento_lgpd) VALUES ($1,$2,$3,$4,$5, now())`, [c, t, cpf, n, `${n}@example.com`]);
    }
    // O mesmo protocolo existe em dois tenants (o numero e unico por tenant): so o CPF resolve de quem e.
    for (const [tk, t, p, j, c] of [
      [chamado, T, 'ADM-2026-000001', job, cand], [chamado2, T, 'ADM-2026-000002', job, cand2], [chamadoT2, T2, 'ADM-2026-000001', job2, candT2],
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
    if (admin) {
      try {
        await admin.query('ALTER TABLE ticket_events DISABLE TRIGGER ticket_events_immutable').catch(() => undefined);
        for (const t of ['documents', 'ticket_events', 'tickets', 'jobs', 'candidates', 'companies', 'protocol_counters']) {
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

  let bearer = '';

  it('protocolo + CPF corretos devolvem token; o mesmo protocolo em outro tenant e resolvido pelo CPF', async () => {
    const r = await entrar('ADM-2026-000001', '529.982.247-25').expect(200);
    expect(r.body.token).toBeTypeOf('string');
    expect(r.body.expiraEm).toBeGreaterThan(Date.now() / 1000);
    bearer = `Bearer ${r.body.token}`;
    const outro = await entrar('ADM-2026-000001', CPF_T2).expect(200);
    expect(outro.body.token).not.toBe(r.body.token);
  });

  it('CPF errado e protocolo inexistente dao a mesma resposta 401', async () => {
    const errado = await entrar('ADM-2026-000001', CPF2).expect(401);
    const inexistente = await entrar('ADM-2026-999999', CPF).expect(401);
    expect(errado.body).toEqual(inexistente.body);
  });

  it('upload com o token do candidato aparece na listagem e fica no storage', async () => {
    const enviado = await http.post(`/chamados/${chamado}/documentos`).set('Authorization', bearer)
      .field('tipo', 'RG').attach('arquivo', PDF, 'rg.pdf').expect(201);
    const lista = await http.get(`/chamados/${chamado}/documentos`).set('Authorization', bearer).expect(200);
    expect(lista.body.documentos).toHaveLength(1);
    expect(lista.body.documentos[0]).toMatchObject({ id: enviado.body.id, tipo: 'RG', status: 'PENDENTE', mime: 'application/pdf' });
    expect(lista.body.checklist.find((i: { tipo: string }) => i.tipo === 'RG')).toMatchObject({ enviado: true, status: 'PENDENTE' });
    expect(lista.body.checklist.find((i: { tipo: string }) => i.tipo === 'CPF')).toMatchObject({ enviado: false, status: 'FALTANDO' });
    // Persistido no disco (qualquer arquivo sob o diretorio de storage do teste).
    const arquivos = (await readdir(dir, { recursive: true, withFileTypes: true })).filter((e) => e.isFile());
    expect(arquivos).toHaveLength(1);
    // O download autenticado devolve o mesmo conteudo.
    const baixado = await http.get(`/documentos/${enviado.body.id}/arquivo`).set('Authorization', bearer).expect(200);
    expect(Buffer.from(baixado.body).equals(PDF)).toBe(true);
  });

  it('o token do candidato nao abre o chamado de outro candidato nem tem papel de equipe', async () => {
    await http.get(`/chamados/${chamado2}/documentos`).set('Authorization', bearer).expect(404);
    await http.post(`/chamados/${chamado2}/documentos`).set('Authorization', bearer)
      .field('tipo', 'RG').attach('arquivo', PDF, 'rg.pdf').expect(404);
    await http.get(`/chamados/${chamadoT2}/documentos`).set('Authorization', bearer).expect(404);
    await http.patch('/documentos/' + randomUUID()).set('Authorization', bearer).send({ status: 'APROVADO' }).expect(403);
  });

  it('rejeita corpo invalido sem ecoar o CPF e limita tentativas (429)', async () => {
    const r = await http.post('/portal/sessao').send({ protocolo: 'x', cpf: CPF, extra: 1 }).expect(400);
    expect(JSON.stringify(r.body)).not.toContain(CPF);
    // Ate aqui: 2 entradas ok + 2 falhas + 1 invalida = 5 chamadas na janela; a proxima passa do limite.
    await entrar('ADM-2026-000001', CPF).expect(429);
  });
});
