import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verificarToken } from '../auth/token.js';
import type { EmailMensagem, EmailPort } from './email.js';
import { EntradaInvalidaError, PortalRepository, PortalService, TTL_LINK_S, TTL_TOKEN_CANDIDATO_S } from './portal.service.js';

const SEGREDO = 'segredo-de-teste-com-mais-de-32-caracteres';
const BASE = 'https://portal.exemplo.com.br';
const config = { get: (k: string) => (k === 'JWT_SECRET' ? SEGREDO : BASE + '/') } as never;
const tenantId = randomUUID();
const candidateId = randomUUID();
const CPF = '52998224725';

/** Banco falso: guarda so o hash (como o real) e consome uma unica vez. */
function repo() {
  const guardados = new Map<string, { usado: boolean; expira: Date }>();
  const pedidos: string[][] = [];
  const r: PortalRepository & { guardados: typeof guardados; pedidos: typeof pedidos } = {
    guardados,
    pedidos,
    async solicitarLink(protocolo, cpf, hash, expira) {
      pedidos.push([protocolo, cpf]);
      if (protocolo !== 'ADM-2026-000001' || cpf !== CPF) return null;
      guardados.set(hash, { usado: false, expira });
      return { email: 'maria@example.com', nome: 'Maria' };
    },
    async consumirLink(hash) {
      const l = guardados.get(hash);
      if (!l || l.usado || l.expira.getTime() <= Date.now()) return null;
      l.usado = true;
      return { tenantId, candidateId };
    },
  };
  return r;
}

function email(falha = false) {
  const enviados: EmailMensagem[] = [];
  const e: EmailPort & { enviados: EmailMensagem[] } = {
    enviados,
    async enviar(m) {
      if (falha) throw new Error('smtp fora do ar');
      enviados.push(m);
    },
  };
  return e;
}

const codigoDe = (m: EmailMensagem) => /\/acesso\/([A-Za-z0-9_-]{43})/.exec(m.texto)![1]!;

describe('PortalService.solicitarLink', () => {
  it('envia ao e-mail cadastrado um link com codigo aleatorio e guarda so o hash', async () => {
    const r = repo(), e = email();
    await new PortalService(r, e, config).solicitarLink('ADM-2026-000001', '529.982.247-25');
    expect(e.enviados).toHaveLength(1);
    const m = e.enviados[0]!;
    expect(m.para).toBe('maria@example.com');
    expect(m.texto).toContain(`${BASE}/chamado/ADM-2026-000001/acesso/`);
    const codigo = codigoDe(m);
    expect(r.guardados.has(codigo)).toBe(false); // o codigo em si nunca e gravado
    expect(r.guardados.has(createHash('sha256').update(codigo).digest('hex'))).toBe(true);
  });

  it('cada pedido gera um codigo diferente', async () => {
    const r = repo(), e = email();
    const s = new PortalService(r, e, config);
    await s.solicitarLink('ADM-2026-000001', CPF);
    await s.solicitarLink('ADM-2026-000001', CPF);
    expect(codigoDe(e.enviados[0]!)).not.toBe(codigoDe(e.enviados[1]!));
  });

  it('o link expira em 15 minutos', async () => {
    const r = repo(), e = email();
    const agora = Date.now();
    await new PortalService(r, e, config).solicitarLink('ADM-2026-000001', CPF, agora);
    const expira = [...r.guardados.values()][0]!.expira;
    expect(expira.getTime()).toBe(agora + TTL_LINK_S * 1000);
    expect(TTL_LINK_S).toBe(900);
  });

  it('nao envia nada e nao da erro para CPF invalido, CPF errado ou protocolo inexistente', async () => {
    const r = repo(), e = email();
    const s = new PortalService(r, e, config);
    await expect(s.solicitarLink('ADM-2026-000001', '111.111.111-11')).resolves.toBeUndefined();
    expect(r.pedidos).toHaveLength(0); // CPF invalido nem consulta o banco
    await expect(s.solicitarLink('ADM-2026-000001', '11144477735')).resolves.toBeUndefined();
    await expect(s.solicitarLink('ADM-2026-999999', CPF)).resolves.toBeUndefined();
    expect(e.enviados).toHaveLength(0);
  });

  it('falha no envio do e-mail nao vira erro (nao revela que o protocolo existe)', async () => {
    await expect(new PortalService(repo(), email(true), config).solicitarLink('ADM-2026-000001', CPF)).resolves.toBeUndefined();
  });
});

describe('PortalService.entrar', () => {
  async function comLink() {
    const r = repo(), e = email();
    const s = new PortalService(r, e, config);
    await s.solicitarLink('ADM-2026-000001', CPF);
    return { s, r, codigo: codigoDe(e.enviados[0]!) };
  }

  it('o codigo do e-mail gera token so com tenant e candidato (sem papel de equipe)', async () => {
    const { s, codigo } = await comLink();
    const agora = Date.now();
    const r = await s.entrar(codigo, agora);
    const ctx = verificarToken(r.token, SEGREDO, agora + 1000);
    expect(ctx).toEqual({ tenantId, candidateId });
    expect(ctx.role).toBeUndefined();
    expect(ctx.userId).toBeUndefined();
    expect(r.expiraEm).toBe(Math.floor(agora / 1000) + TTL_TOKEN_CANDIDATO_S);
    expect(() => verificarToken(r.token, SEGREDO, agora + (TTL_TOKEN_CANDIDATO_S + 1) * 1000)).toThrow();
  });

  it('o codigo so funciona uma vez', async () => {
    const { s, codigo } = await comLink();
    await s.entrar(codigo);
    await expect(s.entrar(codigo)).rejects.toBeInstanceOf(EntradaInvalidaError);
  });

  it('codigo vencido, inventado ou fora do formato dao o mesmo erro; protocolo + CPF nao bastam', async () => {
    const { s, r } = await comLink();
    const [hash] = [...r.guardados.keys()];
    r.guardados.get(hash!)!.expira = new Date(Date.now() - 1000);
    const vencido = 'A'.repeat(43);
    const erros = await Promise.all(
      [vencido, 'curto', 'ADM-2026-000001', CPF].map((c) => s.entrar(c).catch((e: Error) => e)),
    );
    for (const e of erros) expect(e).toBeInstanceOf(EntradaInvalidaError);
    expect(new Set(erros.map((e) => (e as Error).message)).size).toBe(1);
  });
});
