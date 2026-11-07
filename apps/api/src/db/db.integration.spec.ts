import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DbService, RlsDesativadoError } from './db.service.js';

/**
 * Integracao com Postgres real, ja migrado (nao roda sem as variaveis):
 *   TEST_ADMIN_DATABASE_URL  administrador (cria e apaga os dados do teste)
 *   TEST_APP_DATABASE_URL    papel de login da API (kronos_api, ver prisma/dev/app-role.sql)
 */
const ADMIN = process.env.TEST_ADMIN_DATABASE_URL;
const APP = process.env.TEST_APP_DATABASE_URL;

const cfg = (url: string) => ({ get: () => url }) as unknown as ConfigService<never, true>;
const id = () => randomUUID();

describe.skipIf(!ADMIN || !APP)('DbService com RLS real', () => {
  const T = id(), outroTenant = id();
  const adm = id(), rhMatriz = id(), rhFilial = id(), rhOutra = id(), rhSemAtrib = id();
  const matriz = id(), filial = id(), outra = id();
  const jobFilial = id(), jobOutra = id();
  const cand1 = id(), cand2 = id();
  const t1 = id(), t2 = id(), doc1 = id();

  let admin: Client;
  let db: DbService;

  beforeAll(async () => {
    admin = new Client({ connectionString: ADMIN });
    await admin.connect();
    const q = (sql: string, params: unknown[] = []) => admin.query(sql, params);

    await q(`INSERT INTO tenants (id, nome) VALUES ($1,'T'), ($2,'Outro')`, [T, outroTenant]);
    for (const [u, n, r] of [
      [adm, 'adm', 'ADMIN'], [rhMatriz, 'matriz', 'RECRUTADOR'], [rhFilial, 'filial', 'RECRUTADOR'],
      [rhOutra, 'outra', 'RECRUTADOR'], [rhSemAtrib, 'sematrib', 'RECRUTADOR'],
    ] as const) {
      await q(`INSERT INTO users (id, tenant_id, nome, email, role, password_hash) VALUES ($1,$2,$3,$4,$5,'x')`,
        [u, T, n, `${n}-${u}@t.com`, r]);
    }
    await q(`INSERT INTO companies (id, tenant_id, cnpj, razao_social) VALUES ($1,$3,'11111111000111','Matriz'), ($2,$3,'33333333000133','Outra')`, [matriz, outra, T]);
    await q(`INSERT INTO companies (id, tenant_id, cnpj, razao_social, matriz_id) VALUES ($1,$2,'11111111000222','Filial',$3)`, [filial, T, matriz]);
    for (const [u, c] of [[rhMatriz, matriz], [rhSemAtrib, matriz], [rhFilial, filial], [rhOutra, outra]]) {
      await q(`INSERT INTO user_companies (tenant_id, user_id, company_id) VALUES ($1,$2,$3)`, [T, u, c]);
    }
    await q(`INSERT INTO jobs (id, tenant_id, company_id, titulo) VALUES ($1,$3,$4,'v1'), ($2,$3,$5,'v2')`, [jobFilial, jobOutra, T, filial, outra]);
    await q(`INSERT INTO candidates (id, tenant_id, cpf, nome, email) VALUES ($1,$3,'12345678901','C1','c1@x.com'), ($2,$3,'98765432100','C2','c2@x.com')`, [cand1, cand2, T]);
    await q(`INSERT INTO tickets (id, tenant_id, protocolo, job_id, candidate_id) VALUES ($1,$3,'ADM-2026-900001',$4,$5), ($2,$3,'ADM-2026-900002',$6,$7)`, [t1, t2, T, jobFilial, cand1, jobOutra, cand2]);
    await q(`SELECT set_config('app.tenant_id', $1, false)`, [T]); // o trigger de atribuicao confere o vinculo no tenant
    await q(`INSERT INTO ticket_assignments (tenant_id, ticket_id, user_id) VALUES ($1,$2,$3), ($1,$2,$4), ($1,$5,$6)`, [T, t1, rhMatriz, rhFilial, t2, rhOutra]);
    await q(`INSERT INTO documents (id, tenant_id, ticket_id, tipo, chave_storage, mime, tamanho_bytes, sha256) VALUES ($1,$2,$3,'RG',$4,'image/png',10,repeat('a',64))`, [doc1, T, t1, `${T}/${doc1}`]);

    db = new DbService(cfg(APP!));
    await db.onModuleInit();
  }, 60_000);

  afterAll(async () => {
    await db?.onModuleDestroy();
    if (admin) {
      const q = (sql: string) => admin.query(sql, [T]).catch(() => undefined);
      for (const t of ['documents', 'ticket_assignments', 'tickets', 'jobs', 'candidates', 'user_companies', 'companies', 'users']) {
        await q(`DELETE FROM ${t} WHERE tenant_id = $1`);
      }
      await admin.query(`DELETE FROM tenants WHERE id = ANY($1)`, [[T, outroTenant]]).catch(() => undefined);
      await admin.end();
    }
  });

  const contar = (ctx: unknown) =>
    db.run(ctx, async (tx) => ({
      empresas: await tx.company.count(),
      chamados: await tx.ticket.count(),
      candidatos: await tx.candidate.count(),
      documentos: await tx.document.count(),
    }));

  it('matriz enxerga matriz e filial; filial enxerga so a propria', async () => {
    expect(await contar({ tenantId: T, userId: rhMatriz, role: 'RECRUTADOR' })).toMatchObject({ empresas: 2, chamados: 1 });
    const filialVe = await db.run({ tenantId: T, userId: rhFilial, role: 'RECRUTADOR' }, (tx) => tx.company.findMany());
    expect(filialVe.map((c) => c.id)).toEqual([filial]);
  });

  it('empresa sem vinculo nao ve chamado, candidato nem documento de outra', async () => {
    expect(await contar({ tenantId: T, userId: rhOutra, role: 'RECRUTADOR' })).toMatchObject({ empresas: 1, chamados: 1, candidatos: 1, documentos: 0 });
    const vaza = await db.run({ tenantId: T, userId: rhOutra, role: 'RECRUTADOR' }, (tx) => tx.ticket.findUnique({ where: { id: t1 } }));
    expect(vaza).toBeNull();
  });

  it('ADMIN gere cadastro mas nao ve chamados, candidatos nem documentos', async () => {
    expect(await contar({ tenantId: T, userId: adm, role: 'ADMIN' })).toEqual({ empresas: 3, chamados: 0, candidatos: 0, documentos: 0 });
  });

  it('documento exige atribuicao ao chamado', async () => {
    expect((await contar({ tenantId: T, userId: rhSemAtrib, role: 'RECRUTADOR' })).documentos).toBe(0);
    expect((await contar({ tenantId: T, userId: rhMatriz, role: 'RECRUTADOR' })).documentos).toBe(1);
  });

  it('candidato ve so o que e dele; sem usuario nem candidato nao ve nada', async () => {
    expect(await contar({ tenantId: T, candidateId: cand1 })).toEqual({ empresas: 0, chamados: 1, candidatos: 1, documentos: 1 });
    expect(await contar({ tenantId: T })).toEqual({ empresas: 0, chamados: 0, candidatos: 0, documentos: 0 });
  });

  it('outro tenant nao ve nada deste', async () => {
    expect(await contar({ tenantId: outroTenant, userId: rhMatriz, role: 'RECRUTADOR' })).toEqual({ empresas: 0, chamados: 0, candidatos: 0, documentos: 0 });
  });

  it('o contexto nao vaza para a transacao seguinte (mesma conexao do pool)', async () => {
    await contar({ tenantId: T, userId: rhMatriz, role: 'RECRUTADOR' });
    expect(await contar({ tenantId: T })).toMatchObject({ chamados: 0, empresas: 0 });
  });

  it('contextos concorrentes nao se misturam', async () => {
    const resultados = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        i % 2 === 0
          ? contar({ tenantId: T, userId: rhMatriz, role: 'RECRUTADOR' })
          : contar({ tenantId: T, userId: rhOutra, role: 'RECRUTADOR' }),
      ),
    );
    resultados.forEach((r, i) => expect(r.empresas).toBe(i % 2 === 0 ? 2 : 1));
  });

  it('escrita fora do vinculo e recusada pelo banco', async () => {
    await expect(
      db.run({ tenantId: T, userId: rhOutra, role: 'RECRUTADOR' }, (tx) =>
        tx.ticket.create({ data: { tenantId: T, protocolo: 'ADM-2026-900099', jobId: jobFilial, candidateId: cand2 } }),
      ),
    ).rejects.toThrow();
  });

  it('contexto invalido nem chega ao banco', async () => {
    await expect(db.run({ tenantId: 'x' }, async () => 1)).rejects.toThrow(/Contexto invalido/);
  });

  it('o boot recusa conexao que ignora o RLS (administrador)', async () => {
    const bypass = new DbService(cfg(ADMIN!));
    await expect(bypass.assertRlsAtivo()).rejects.toThrow(RlsDesativadoError);
    await bypass.onModuleDestroy();
  });
});
