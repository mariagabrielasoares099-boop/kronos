import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EMAIL_PORT, type EmailMensagem } from './email.js';

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
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const codigoDe = (m: EmailMensagem) => /\/acesso\/([A-Za-z0-9_-]{43})/.exec(m.texto)![1]!;

describe.skipIf(!ADMIN || !APP)('Portal do candidato: entrada + upload ponta a ponta (HTTP + RLS)', () => {
  const T = id(), T2 = id(), matriz = id(), matriz2 = id(), job = id(), job2 = id();
  const cand = id(), cand2 = id(), candT2 = id();
  const chamado = id(), chamado2 = id(), chamadoT2 = id();
  // CPFs e protocolos proprios: outros specs usam o mesmo banco em paralelo e a ambiguidade (mesmo CPF + protocolo em dois tenants) e recusada de proposito.
  const CPF = '70000007919', CPF2 = '70000364274', CPF_T2 = '70003009220';

  let admin: Client;
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let dir: string;

  /** E-mails enviados: o teste le o link daqui, como o candidato leria da caixa de entrada. */
  const emails: EmailMensagem[] = [];
  const pedirLink = (protocolo: string, cpf: string) => http.post('/portal/link').send({ protocolo, cpf });
  const sessao = (codigo: string) => http.post('/portal/sessao').send({ codigo });

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
      [chamado, T, 'ADM-2026-700001', job, cand], [chamado2, T, 'ADM-2026-700002', job, cand2], [chamadoT2, T2, 'ADM-2026-700001', job2, candT2],
    ] as const) {
      await q(`INSERT INTO tickets (id, tenant_id, protocolo, job_id, candidate_id, status) VALUES ($1,$2,$3,$4,$5,'TRIAGEM')`, [tk, t, p, j, c]);
    }

    const { AppModule } = await import('../app.module.js');
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_PORT)
      .useValue({ enviar: async (m: EmailMensagem) => void emails.push(m) })
      .compile();
    app = mod.createNestApplication();
    await app.init();
    http = request(app.getHttpServer());
  }, 90_000);

  afterAll(async () => {
    await app?.close();
    if (admin) {
      try {
        await admin.query('ALTER TABLE ticket_events DISABLE TRIGGER ticket_events_immutable').catch(() => undefined);
        for (const t of ['portal_links', 'documents', 'ticket_events', 'tickets', 'jobs', 'candidates', 'companies', 'protocol_counters']) {
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
  let codigoEmail = '';
  let corpoPedidoCerto: unknown;

  it('dois pedidos concorrentes geram apenas um link para o candidato', async () => {
    const nome = `link-concorrencia-${cand2}`;
    const clientes = [0, 1].map(() => new Client({ connectionString: APP!, application_name: nome }));
    await Promise.all(clientes.map((c) => c.connect()));
    let pedidos: Promise<{ rows: unknown[] }[]> | undefined;
    try {
      await admin.query('BEGIN');
      await admin.query('SELECT id FROM candidates WHERE id = $1 FOR UPDATE', [cand2]);
      pedidos = Promise.all(clientes.map((c, i) => c.query(
        'SELECT * FROM auth_candidato_solicitar_link($1, $2, $3, $4)',
        ['ADM-2026-700002', CPF2, sha256(`concorrente-${i}`), new Date(Date.now() + 600_000)],
      )));
      // Aguarda os dois pedidos chegarem ao lock; nao depende da ordem de execucao das conexoes.
      let bloqueados = 0;
      for (let tentativa = 0; tentativa < 100 && bloqueados < 2; tentativa++) {
        await admin.query('SELECT pg_stat_clear_snapshot()');
        const r = await admin.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock'", [nome]);
        bloqueados = r.rows[0].n;
        if (bloqueados < 2) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(bloqueados).toBe(2);
      await admin.query('COMMIT');
      const resultados = await pedidos;
      expect(resultados.reduce((n, r) => n + r.rows.length, 0)).toBe(1);
      const links = await admin.query('SELECT id FROM portal_links WHERE candidate_id = $1 AND usado_em IS NULL', [cand2]);
      expect(links.rows).toHaveLength(1);
    } finally {
      await admin.query('ROLLBACK');
      if (pedidos) await Promise.allSettled([pedidos]);
      await Promise.all(clientes.map((c) => c.end()));
      await admin.query('DELETE FROM portal_links WHERE candidate_id = $1', [cand2]);
    }
  }, 10_000);

  it('nao escolhe tenant arbitrariamente quando CPF e protocolo coincidem', async () => {
    await admin.query('UPDATE candidates SET cpf = $1 WHERE id = $2', [CPF, candT2]);
    try {
      const r = await admin.query('SELECT * FROM auth_candidato($1, $2)', ['ADM-2026-700001', CPF]);
      expect(r.rows).toEqual([]);
    } finally {
      await admin.query('UPDATE candidates SET cpf = $1 WHERE id = $2', [CPF_T2, candT2]);
    }
  });

  it('a API nao executa mais a funcao antiga nem le a tabela de links (so as funcoes SECURITY DEFINER)', async () => {
    const r = await admin.query(
      `SELECT has_function_privilege('kronos_api','auth_candidato(text,text)','execute') AS antiga,
              has_table_privilege('kronos_api','portal_links','select') AS tabela,
              has_function_privilege('kronos_api','auth_candidato_consumir_link(text)','execute') AS consumir`,
    );
    expect(r.rows[0]).toEqual({ antiga: false, tabela: false, consumir: true });
  });

  it('protocolo + CPF corretos pedem o link: 202 e e-mail ao cadastrado, com o codigo so no e-mail', async () => {
    const r = await pedirLink('ADM-2026-700001', '700.000.079-19').expect(202);
    expect(JSON.stringify(r.body)).not.toMatch(/token|codigo|acesso\//i); // a resposta nao carrega o segredo
    corpoPedidoCerto = r.body;
    expect(emails).toHaveLength(1);
    expect(emails[0]!.para).toBe('c1@example.com');
    codigoEmail = codigoDe(emails[0]!);
    // O banco guarda so o hash, nunca o codigo.
    const l = await admin.query('SELECT token_hash, expira_em, usado_em FROM portal_links WHERE candidate_id = $1', [cand]);
    expect(l.rows).toHaveLength(1);
    expect(l.rows[0].token_hash).toBe(sha256(codigoEmail));
    expect(JSON.stringify(l.rows)).not.toContain(codigoEmail);
    expect(new Date(l.rows[0].expira_em).getTime() - Date.now()).toBeLessThanOrEqual(15 * 60 * 1000);
  });

  it('CPF errado e protocolo inexistente respondem igual ao pedido certo e nao enviam e-mail', async () => {
    const antes = emails.length;
    const errado = await pedirLink('ADM-2026-700001', CPF2).expect(202);
    const inexistente = await pedirLink('ADM-2026-999999', CPF).expect(202);
    expect(errado.body).toEqual(inexistente.body);
    expect(errado.body).toEqual(corpoPedidoCerto); // quem pede nao descobre se acertou
    expect(emails.length).toBe(antes);
  });

  it('pedido repetido em menos de 1 minuto nao manda outro e-mail (evita spam na caixa do candidato)', async () => {
    const antes = emails.length;
    await pedirLink('ADM-2026-700001', CPF).expect(202);
    expect(emails.length).toBe(antes);
  });

  it('protocolo + CPF sozinhos nao abrem sessao; link inventado ou mal formado da 401', async () => {
    await http.post('/portal/sessao').send({ protocolo: 'ADM-2026-700001', cpf: CPF }).expect(400);
    const a = await sessao('A'.repeat(43)).expect(401);
    const b = await sessao('curto').expect(401);
    expect(a.body).toEqual(b.body);
  });

  it('o codigo do e-mail abre a sessao uma unica vez', async () => {
    const r = await sessao(codigoEmail).expect(200);
    expect(r.body.token).toBeTypeOf('string');
    expect(r.body.expiraEm).toBeGreaterThan(Date.now() / 1000);
    bearer = `Bearer ${r.body.token}`;
    await sessao(codigoEmail).expect(401); // reuso
    const l = await admin.query('SELECT usado_em FROM portal_links WHERE token_hash = $1', [sha256(codigoEmail)]);
    expect(l.rows[0].usado_em).not.toBeNull();
  });

  it('codigo vencido nao abre sessao', async () => {
    const vencido = 'V'.repeat(43);
    await admin.query(
      `INSERT INTO portal_links (tenant_id, candidate_id, token_hash, expira_em) VALUES ($1,$2,$3, now() - interval '1 minute')`,
      [T, cand, sha256(vencido)],
    );
    await sessao(vencido).expect(401);
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

  it('um novo pedido invalida o link anterior ainda nao usado', async () => {
    const antigo = 'N'.repeat(43);
    await admin.query(
      `INSERT INTO portal_links (tenant_id, candidate_id, token_hash, expira_em) VALUES ($1,$2,$3, now() + interval '10 minutes')`,
      [T, cand, sha256(antigo)],
    );
    // Passa o intervalo minimo de 1 minuto entre pedidos.
    await admin.query(`UPDATE portal_links SET criado_em = now() - interval '5 minutes' WHERE candidate_id = $1`, [cand]);
    const antes = emails.length;
    await pedirLink('ADM-2026-700001', CPF).expect(202);
    expect(emails.length).toBe(antes + 1);
    await sessao(antigo).expect(401);
    const r = await sessao(codigoDe(emails.at(-1)!)).expect(200);
    expect(r.body.token).toBeTypeOf('string');
  });

  it('rejeita corpo invalido sem ecoar o CPF nem o codigo', async () => {
    const r = await http.post('/portal/sessao').send({ codigo: 'x'.repeat(43), cpf: CPF }).expect(400);
    expect(JSON.stringify(r.body)).not.toContain(CPF);
    expect(JSON.stringify(r.body)).not.toContain('x'.repeat(43));
  });

  it('limita pedidos de link por minuto (429)', async () => {
    // Pedidos de link ate aqui: 1 + 2 + 1 (intervalo) + 1 (invalidacao) = 5, o limite por minuto; o proximo passa.
    await pedirLink('ADM-2026-700001', CPF).expect(429);
  });
});
