// Roteiro ponta a ponta contra a API em execucao (dados ficticios).
// Uso (API no ar e variaveis do apps/api/.env carregadas):  node scripts/e2e.mjs
// Usa JWT_SECRET (assina os tokens) e MIGRATE_DATABASE_URL (semeia a empresa e atribui o chamado).
// Rode so contra um banco local DESCARTAVEL: ele cria um tenant novo a cada execucao.
import { createHmac, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(process.cwd() + '/package.json');
const { Client } = require('pg');

const env = process.env;
if (!env.JWT_SECRET || !env.MIGRATE_DATABASE_URL) throw new Error('Carregue o apps/api/.env antes (JWT_SECRET e MIGRATE_DATABASE_URL).');
const BASE = env.API_URL ?? 'http://127.0.0.1:3000';
const b64 = (s) => Buffer.from(s).toString('base64url');
function token(ctx) {
  const iat = Math.floor(Date.now() / 1000);
  const dados = `${b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64(JSON.stringify({ tid: ctx.tenantId, uid: ctx.userId, role: ctx.role, cid: ctx.candidateId, iat, exp: iat + 3600 }))}`;
  return `Bearer ${dados}.${createHmac('sha256', env.JWT_SECRET).update(dados).digest().toString('base64url')}`;
}
const log = (t, ok, extra = '') => console.log(`${ok ? 'OK  ' : 'FALHA'} ${t}${extra ? '  -> ' + extra : ''}`);
let falhas = 0;
const check = (t, cond, extra) => { if (!cond) falhas++; log(t, cond, extra); };

const T = randomUUID(), rh = randomUUID(), empresa = randomUUID(), vaga = randomUUID();
const admin = new Client({ connectionString: env.MIGRATE_DATABASE_URL });
await admin.connect();
const q = (s, p = []) => admin.query(s, p);
await q(`INSERT INTO tenants (id, nome) VALUES ($1,'Empresa Exemplo (demo)')`, [T]);
await q(`INSERT INTO users (id, tenant_id, nome, email, role, password_hash) VALUES ($1,$2,'Diego (RH)','diego-${rh}@example.com','RECRUTADOR','x')`, [rh, T]);
await q(`INSERT INTO companies (id, tenant_id, cnpj, razao_social) VALUES ($1,$2,'11222333000181','Empresa Exemplo Ltda')`, [empresa, T]);
await q(`INSERT INTO user_companies (tenant_id, user_id, company_id) VALUES ($1,$2,$3)`, [T, rh, empresa]);
await q(`INSERT INTO jobs (id, tenant_id, company_id, titulo) VALUES ($1,$2,$3,'Auxiliar Administrativo')`, [vaga, T, empresa]);

const tRh = token({ tenantId: T, userId: rh, role: 'RECRUTADOR' });
const h = (t, extra = {}) => ({ Authorization: t, ...extra });
const json = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };

check('GET /health', (await fetch(`${BASE}/health`)).status === 200);
check('sem token => 401', (await fetch(`${BASE}/chamados`, { method: 'POST' })).status === 401);

let r = await fetch(`${BASE}/chamados`, { method: 'POST', headers: h(tRh, { 'content-type': 'application/json' }),
  body: JSON.stringify({ jobId: vaga, candidato: { nome: 'Maria Souza', email: 'maria@example.com', cpf: '529.982.247-25' }, consentimentoLgpd: true }) });
const ch = await json(r);
check('POST /chamados => 201 (TRIAGEM)', r.status === 201 && ch.status === 'TRIAGEM', `${ch.protocolo}`);

r = await fetch(`${BASE}/chamados/${ch.protocolo}`, { headers: h(tRh) });
check('GET /chamados/:protocolo => 200', r.status === 200);

for (const acao of ['AVANCAR', 'AVANCAR', 'AVANCAR']) {
  r = await fetch(`${BASE}/chamados/${ch.id}/transicoes`, { method: 'POST', headers: h(tRh, { 'content-type': 'application/json' }), body: JSON.stringify({ acao }) });
}
const st = await json(r);
check('3 transicoes ate VALIDACAO_DP', r.status === 200 && st.status === 'VALIDACAO_DP', st.status);

// Atribui o chamado ao RH (documentos exigem vinculo com a empresa E atribuicao).
await q(`SELECT set_config('app.tenant_id', $1, false)`, [T]);
await q(`INSERT INTO ticket_assignments (tenant_id, ticket_id, user_id) VALUES ($1,$2,$3)`, [T, ch.id, rh]);
const cand = (await q(`SELECT id FROM candidates WHERE tenant_id=$1`, [T])).rows[0].id;
const tCand = token({ tenantId: T, candidateId: cand });

const PDF = Buffer.from('%PDF-1.7\nconteudo ficticio de teste');
const form = (tipo, buf, nome) => { const f = new FormData(); f.set('tipo', tipo); f.set('arquivo', new Blob([buf]), nome); return f; };

r = await fetch(`${BASE}/chamados/${ch.id}/documentos`, { method: 'POST', headers: h(tCand), body: form('RG', PDF, 'rg.pdf') });
const doc = await json(r);
check('candidato envia RG => 201 PENDENTE', r.status === 201 && doc.status === 'PENDENTE', `${doc.mime}, ${doc.tamanhoBytes} bytes`);

r = await fetch(`${BASE}/chamados/${ch.id}/documentos`, { method: 'POST', headers: h(tCand), body: form('CPF', Buffer.from('MZ\x90\x00'), 'cpf.pdf') });
check('.exe renomeado para .pdf => 400', r.status === 400);

r = await fetch(`${BASE}/chamados/${ch.id}/documentos`, { method: 'POST', headers: h(tCand), body: form('CPF', Buffer.alloc(5 * 1024 * 1024 + 10, 0x25), 'grande.pdf') });
check('arquivo acima de 5 MB => 413', r.status === 413);

const outro = token({ tenantId: T, candidateId: randomUUID() });
r = await fetch(`${BASE}/chamados/${ch.id}/documentos`, { headers: h(outro) });
check('outro candidato nao enxerga => 404', r.status === 404);

r = await fetch(`${BASE}/chamados/${ch.id}/documentos`, { headers: h(tRh) });
const lista = await json(r);
check('RH lista documentos + checklist', r.status === 200 && lista.checklist?.length === 3, lista.checklist?.map((c) => `${c.tipo}:${c.status}`).join(' '));

r = await fetch(`${BASE}/documentos/${doc.id}/arquivo`, { headers: h(tRh) });
const baixado = Buffer.from(await r.arrayBuffer());
check('download devolve os mesmos bytes (anexo, nosniff)', r.status === 200 && baixado.equals(PDF) && /attachment/.test(r.headers.get('content-disposition')) && r.headers.get('x-content-type-options') === 'nosniff');

r = await fetch(`${BASE}/documentos/${doc.id}`, { method: 'PATCH', headers: h(tCand, { 'content-type': 'application/json' }), body: JSON.stringify({ status: 'APROVADO' }) });
check('candidato nao aprova o proprio documento => 403', r.status === 403);

r = await fetch(`${BASE}/documentos/${doc.id}`, { method: 'PATCH', headers: h(tRh, { 'content-type': 'application/json' }), body: JSON.stringify({ status: 'RECUSADO' }) });
check('recusar sem motivo => 400', r.status === 400);

r = await fetch(`${BASE}/documentos/${doc.id}`, { method: 'PATCH', headers: h(tRh, { 'content-type': 'application/json' }), body: JSON.stringify({ status: 'APROVADO' }) });
check('RH aprova => 200 APROVADO', r.status === 200 && (await json(r)).status === 'APROVADO');

r = await fetch(`${BASE}/documentos/${doc.id}`, { method: 'PATCH', headers: h(tRh, { 'content-type': 'application/json' }), body: JSON.stringify({ status: 'RECUSADO', motivo: 'tarde demais' }) });
check('decidir de novo => 409', r.status === 409);

r = await fetch(`${BASE}/chamados/${ch.id}/transicoes`, { method: 'POST', headers: h(tRh, { 'content-type': 'application/json' }), body: JSON.stringify({ acao: 'AVANCAR' }) });
{ const b = await json(r); check('chamado avanca => ENVIO_ERP (ASSINATURA e opcional e a vaga nao a habilita)', r.status === 200 && b.status === 'ENVIO_ERP', b.status); }

const ev = (await q(`SELECT tipo, de, para FROM ticket_events WHERE tenant_id=$1 AND ticket_id=$2 ORDER BY created_at`, [T, ch.id])).rows;
check('trilha ticket_events registrou as mudancas', ev.length >= 4, `${ev.length} eventos`);

const spec = await fetch(`${BASE}/openapi.json`);
check('GET /openapi.json', spec.status === 200);

console.log(falhas === 0 ? '\nTUDO OK' : `\n${falhas} FALHA(S)`);
await admin.end();
process.exit(falhas === 0 ? 0 : 1);
