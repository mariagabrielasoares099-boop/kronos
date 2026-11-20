import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assinarToken } from '../auth/token.js';
import type { DbContext } from '../db/db-context.js';

/**
 * API completa (Nest + guard + RLS) contra Postgres real e DESCARTAVEL (nao use um banco com dados seus):
 *   TEST_ADMIN_DATABASE_URL  administrador (cria e apaga os dados do teste)
 *   TEST_APP_DATABASE_URL    papel de login da API (kronos_api)
 */
const ADMIN = process.env.TEST_ADMIN_DATABASE_URL;
const APP = process.env.TEST_APP_DATABASE_URL;
const SEGREDO = 'segredo-de-teste-com-mais-de-32-caracteres';
const id = () => randomUUID();

describe.skipIf(!ADMIN || !APP)('API de chamados (HTTP + RLS)', () => {
  const T = id(), adm = id(), rhA = id(), rhX = id(), gestor = id();
  const matriz = id(), outra = id(), jobA = id(), jobX = id();

  let admin: Client;
  let app: INestApplication;
  let http: ReturnType<typeof request>;

  const tok = (c: DbContext) => `Bearer ${assinarToken(c, SEGREDO)}`;
  const tRhA = tok({ tenantId: T, userId: rhA, role: 'RECRUTADOR' });
  const tRhX = tok({ tenantId: T, userId: rhX, role: 'RECRUTADOR' });
  const tAdmin = tok({ tenantId: T, userId: adm, role: 'ADMIN' });
  const tGestor = tok({ tenantId: T, userId: gestor, role: 'GESTOR_VAGA' });

  const novo = (cpf: string, extra: object = {}) => ({
    jobId: jobA,
    candidato: { nome: 'Maria Souza', email: `m${cpf}@example.com`, cpf },
    consentimentoLgpd: true,
    ...extra,
  });
  const CPF1 = '529.982.247-25', CPF2 = '111.444.777-35';

  beforeAll(async () => {
    process.env.DATABASE_URL = APP!;
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.JWT_SECRET = SEGREDO;
    process.env.ENCRYPTION_KEY = 'k'.repeat(40);
    process.env.RATE_LIMIT_MAX = '1000';

    admin = new Client({ connectionString: ADMIN });
    await admin.connect();
    const q = (sql: string, p: unknown[] = []) => admin.query(sql, p);
    await q(`INSERT INTO tenants (id, nome) VALUES ($1, 'T')`, [T]);
    for (const [u, n, r] of [[adm, 'adm', 'ADMIN'], [rhA, 'rha', 'RECRUTADOR'], [rhX, 'rhx', 'RECRUTADOR'], [gestor, 'gestor', 'GESTOR_VAGA']] as const) {
      await q(`INSERT INTO users (id, tenant_id, nome, email, role, password_hash) VALUES ($1,$2,$3,$4,$5,'x')`, [u, T, n, `${n}-${u}@t.com`, r]);
    }
    await q(`INSERT INTO companies (id, tenant_id, cnpj, razao_social) VALUES ($1,$3,'11111111000111','A'), ($2,$3,'33333333000133','X')`, [matriz, outra, T]);
    await q(`INSERT INTO user_companies (tenant_id, user_id, company_id) VALUES ($1,$2,$3), ($1,$4,$5)`, [T, rhA, matriz, rhX, outra]);
    await q(`INSERT INTO jobs (id, tenant_id, company_id, titulo, fluxo) VALUES ($1,$3,$4,'va','{"enabled":["TESTES"]}'), ($2,$3,$5,'vx','{}')`, [jobA, jobX, T, matriz, outra]);

    const { AppModule } = await import('../app.module.js');
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    http = request(app.getHttpServer());
  }, 90_000);

  afterAll(async () => {
    await app?.close();
    if (admin) {
      // A trilha e append-only (trigger); so o administrador do banco de teste a desliga para limpar.
      try {
        await admin.query('ALTER TABLE ticket_events DISABLE TRIGGER ticket_events_immutable');
        await admin.query(`SELECT set_config('app.tenant_id', $1, false)`, [T]);
        for (const t of ['ticket_events', 'tickets', 'jobs', 'candidates', 'user_companies', 'companies', 'users', 'protocol_counters']) {
          await admin.query(`DELETE FROM ${t} WHERE tenant_id = $1`, [T]).catch(() => undefined);
        }
        await admin.query('DELETE FROM tenants WHERE id = $1', [T]).catch(() => undefined);
      } finally {
        await admin.query('ALTER TABLE ticket_events ENABLE TRIGGER ticket_events_immutable');
        await admin.end();
      }
    }
  });

  it('health e publico; o resto exige token valido', async () => {
    await http.get('/health').expect(200);
    await http.post('/chamados').send(novo(CPF1)).expect(401);
    await http.post('/chamados').set('Authorization', 'Bearer lixo').send(novo(CPF1)).expect(401);
    await http.post('/chamados').set('Authorization', `Bearer ${assinarToken({ tenantId: T, userId: rhA, role: 'RECRUTADOR' }, 'outro-segredo-qualquer-com-32-chars!!')}`).send(novo(CPF1)).expect(401);
  });

  it('papel sem permissao nao cria nem movimenta chamado', async () => {
    await http.post('/chamados').set('Authorization', tAdmin).send(novo(CPF1)).expect(403);
    await http.post('/chamados').set('Authorization', tGestor).send(novo(CPF1)).expect(403);
    await http.post('/chamados').set('Authorization', tok({ tenantId: T, candidateId: id() })).send(novo(CPF1)).expect(403);
  });

  it('valida a entrada sem devolver os valores recebidos', async () => {
    const r = await http.post('/chamados').set('Authorization', tRhA).send(novo('123.456.789-00')).expect(400);
    expect(JSON.stringify(r.body)).not.toContain('123.456.789-00');
    expect(r.body.erros[0].campo).toBe('candidato.cpf');
    await http.post('/chamados').set('Authorization', tRhA).send(novo(CPF1, { consentimentoLgpd: false })).expect(400);
    await http.post('/chamados').set('Authorization', tRhA).send(novo(CPF1, { admin: true })).expect(400);
    await http.post('/chamados').set('Authorization', tRhA).send({}).expect(400);
  });

  let protocolo1 = '', chamado1 = '';

  it('cria chamado: protocolo sequencial, TRIAGEM, sem dado pessoal na resposta', async () => {
    const r = await http.post('/chamados').set('Authorization', tRhA).send(novo(CPF1)).expect(201);
    expect(r.body).toMatchObject({ status: 'TRIAGEM', jobId: jobA, erpRef: null });
    expect(r.body.protocolo).toMatch(/^ADM-\d{4}-000001$/);
    expect(JSON.stringify(r.body)).not.toMatch(/Maria|5299822|@example/);
    protocolo1 = r.body.protocolo;
    chamado1 = r.body.id;

    const r2 = await http.post('/chamados').set('Authorization', tRhA).send(novo(CPF2)).expect(201);
    expect(r2.body.protocolo).toMatch(/-000002$/);
  });

  it('guarda candidato (CPF so digitos, consentimento) e evento de criacao', async () => {
    const c = await admin.query(`SELECT cpf, consentimento_lgpd FROM candidates WHERE tenant_id=$1 AND cpf='52998224725'`, [T]);
    expect(c.rows[0].consentimento_lgpd).not.toBeNull();
    const e = await admin.query(`SELECT tipo, autor, para FROM ticket_events WHERE ticket_id=$1`, [chamado1]);
    expect(e.rows).toEqual([{ tipo: 'CRIADO', autor: rhA, para: 'TRIAGEM' }]);
  });

  it('CPF repetido -> 409; vaga de empresa sem vinculo -> 404', async () => {
    await http.post('/chamados').set('Authorization', tRhA).send(novo(CPF1)).expect(409);
    await http.post('/chamados').set('Authorization', tRhA).send(novo('390.533.447-05', { jobId: jobX })).expect(404);
  });

  it('GET: quem tem vinculo ve; outra empresa, ADMIN e protocolo invalido nao', async () => {
    const r = await http.get(`/chamados/${protocolo1}`).set('Authorization', tRhA).expect(200);
    expect(r.body.id).toBe(chamado1);
    await http.get(`/chamados/${protocolo1}`).set('Authorization', tRhX).expect(404);
    await http.get(`/chamados/${protocolo1}`).set('Authorization', tAdmin).expect(404);
    await http.get('/chamados/ADM-2026-1').set('Authorization', tRhA).expect(400);
    await http.get(`/chamados/${protocolo1}`).expect(401);
  });

  it('o proprio candidato acompanha o chamado; outro candidato nao', async () => {
    const { rows } = await admin.query(`SELECT candidate_id FROM tickets WHERE id=$1`, [chamado1]);
    const dono = tok({ tenantId: T, candidateId: rows[0].candidate_id });
    await http.get(`/chamados/${protocolo1}`).set('Authorization', dono).expect(200);
    await http.get(`/chamados/${protocolo1}`).set('Authorization', tok({ tenantId: T, candidateId: id() })).expect(404);
  });

  it('transicoes: segue o fluxo da vaga, valida motivo e respeita permissao', async () => {
    const t = (corpo: object, auth = tRhA) => http.post(`/chamados/${chamado1}/transicoes`).set('Authorization', auth).send(corpo);
    expect((await t({ acao: 'AVANCAR' }).expect(200)).body.status).toBe('TESTES'); // vaga habilita TESTES
    expect((await t({ acao: 'AVANCAR' }).expect(200)).body.status).toBe('APROVADO'); // ENTREVISTA desligada
    await t({ acao: 'DEVOLVER', motivo: 'sem retorno neste status' }).expect(409);
    await t({ acao: 'REPROVAR' }).expect(400); // motivo obrigatorio
    await t({ acao: 'PULAR' }).expect(400);
    await t({ acao: 'AVANCAR' }, tRhX).expect(404); // outra empresa
    await t({ acao: 'AVANCAR' }, tGestor).expect(403);
    await http.post('/chamados/nao-e-uuid/transicoes').set('Authorization', tRhA).send({ acao: 'AVANCAR' }).expect(400);
  });

  it('a trilha registra cada transicao com autor, de, para', async () => {
    const e = await admin.query(`SELECT autor, de, para FROM ticket_events WHERE ticket_id=$1`, [chamado1]);
    const pares = e.rows.map((r) => `${r.de ?? '-'}>${r.para}`).sort();
    expect(pares).toEqual(['->TRIAGEM', 'TESTES>APROVADO', 'TRIAGEM>TESTES']);
    expect(e.rows.every((r) => r.autor === rhA)).toBe(true);
  });

  describe('fila e linha do tempo para a equipe (so leitura)', () => {
    const lista = (auth: string, qs = '') => http.get(`/chamados${qs}`).set('Authorization', auth);
    let protocolo2 = '', chamado2 = '';

    it('lista so os chamados das empresas da pessoa, com nomes e sem CPF nem e-mail', async () => {
      const r = await lista(tRhA).expect(200);
      expect(r.body).toHaveLength(2);
      expect(r.body.map((c: { protocolo: string }) => c.protocolo)).toContain(protocolo1);
      expect(r.body[0]).toMatchObject({ vagaTitulo: 'va', candidatoNome: 'Maria Souza', responsavelNome: null, prazoSla: null });
      expect(JSON.stringify(r.body)).not.toMatch(/5299822|11144477|@example/);
      const outro = r.body.find((c: { protocolo: string }) => c.protocolo !== protocolo1);
      protocolo2 = outro.protocolo;
      chamado2 = outro.id;
      expect((await lista(tRhX).expect(200)).body).toEqual([]); // outra empresa: o RLS esconde tudo
    });

    it('exige token de equipe: sem token 401; ADMIN e candidato 403', async () => {
      await http.get('/chamados').expect(401);
      await lista(tAdmin).expect(403);
      await lista(tok({ tenantId: T, candidateId: id() })).expect(403);
    });

    it('filtra por status e busca por protocolo, nome ou CPF; valida a querystring', async () => {
      expect((await lista(tRhA, '?status=APROVADO').expect(200)).body.map((c: { protocolo: string }) => c.protocolo)).toEqual([protocolo1]);
      expect((await lista(tRhA, `?busca=${protocolo2}`).expect(200)).body).toHaveLength(1);
      expect((await lista(tRhA, '?busca=52998224725').expect(200)).body.map((c: { protocolo: string }) => c.protocolo)).toEqual([protocolo1]);
      expect((await lista(tRhA, '?busca=529.982.247-25').expect(200)).body).toHaveLength(1);
      expect((await lista(tRhA, '?busca=maria').expect(200)).body).toHaveLength(2);
      expect((await lista(tRhA, '?busca=zzz').expect(200)).body).toEqual([]);
      expect((await lista(tRhA, '?limite=1').expect(200)).body).toHaveLength(1);
      for (const ruim of ['?status=HACK', '?limite=0', '?limite=999', '?outro=1', `?busca=${'x'.repeat(61)}`]) {
        await lista(tRhA, ruim).expect(400);
      }
    });

    it('ordena pelo prazo de SLA mais proximo e mostra o responsavel', async () => {
      await admin.query(`UPDATE tickets SET prazo_sla = now() - interval '1 hour', responsavel = $2 WHERE id = $1`, [chamado2, rhA]);
      const r = (await lista(tRhA).expect(200)).body;
      expect(r[0]).toMatchObject({ protocolo: protocolo2, responsavelNome: 'rha' });
      expect(new Date(r[0].prazoSla).getTime()).toBeLessThan(Date.now());
      expect(r[1].prazoSla).toBeNull(); // sem prazo, por ultimo
    });

    it('resumo por protocolo: so equipe com acesso; outra empresa 404; candidato 403', async () => {
      const r = await http.get(`/chamados/${protocolo1}/resumo`).set('Authorization', tRhA).expect(200);
      expect(r.body).toMatchObject({ id: chamado1, protocolo: protocolo1, status: 'APROVADO', vagaTitulo: 'va', candidatoNome: 'Maria Souza' });
      await http.get(`/chamados/${protocolo1}/resumo`).set('Authorization', tRhX).expect(404);
      await http.get(`/chamados/${protocolo1}/resumo`).set('Authorization', tok({ tenantId: T, candidateId: id() })).expect(403);
      await http.get('/chamados/ADM-2026-1/resumo').set('Authorization', tRhA).expect(400);
      await http.get('/chamados/ADM-2026-999999/resumo').set('Authorization', tRhA).expect(404);
    });

    it('linha do tempo em ordem, com autor; outra empresa 404; candidato 403; id invalido 400', async () => {
      const r = await http.get(`/chamados/${chamado1}/eventos`).set('Authorization', tRhA).expect(200);
      expect(r.body.map((e: { tipo: string; de: string | null; para: string }) => `${e.tipo}:${e.de ?? '-'}>${e.para}`)).toEqual([
        'CRIADO:->TRIAGEM', 'TRANSICAO:TRIAGEM>TESTES', 'TRANSICAO:TESTES>APROVADO',
      ]);
      expect(r.body.every((e: { autorNome: string }) => e.autorNome === 'rha')).toBe(true);
      await http.get(`/chamados/${chamado1}/eventos`).set('Authorization', tRhX).expect(404);
      await http.get(`/chamados/${chamado1}/eventos`).set('Authorization', tok({ tenantId: T, candidateId: id() })).expect(403);
      await http.get('/chamados/nao-e-uuid/eventos').set('Authorization', tRhA).expect(400);
    });
  });

  it('reprovar encerra o chamado e nada mais avanca', async () => {
    const r = await http.post('/chamados').set('Authorization', tRhA).send(novo('390.533.447-05')).expect(201);
    await http.post(`/chamados/${r.body.id}/transicoes`).set('Authorization', tRhA).send({ acao: 'REPROVAR', motivo: 'nota de corte' }).expect(200);
    await http.post(`/chamados/${r.body.id}/transicoes`).set('Authorization', tRhA).send({ acao: 'AVANCAR' }).expect(409);
  });

  it('duas transicoes simultaneas nunca deixam status e trilha inconsistentes', async () => {
    const r = await http.post('/chamados').set('Authorization', tRhA).send(novo('153.509.460-56')).expect(201);
    const res = await Promise.all([1, 2].map(() => http.post(`/chamados/${r.body.id}/transicoes`).set('Authorization', tRhA).send({ acao: 'AVANCAR' })));
    const ok = res.filter((x) => x.status === 200).length;
    expect(res.every((x) => [200, 409].includes(x.status))).toBe(true);
    const e = await admin.query(`SELECT count(*)::int AS n FROM ticket_events WHERE ticket_id=$1 AND tipo='TRANSICAO'`, [r.body.id]);
    expect(e.rows[0].n).toBe(ok);
  });
});
