import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verificarToken } from '../auth/token.js';
import { EntradaInvalidaError, PortalRepository, PortalService, TTL_TOKEN_CANDIDATO_S } from './portal.service.js';

const SEGREDO = 'segredo-de-teste-com-mais-de-32-caracteres';
const config = { get: () => SEGREDO } as never;
const tenantId = randomUUID();
const candidateId = randomUUID();

function repo(): PortalRepository & { chamadas: [string, string][] } {
  const chamadas: [string, string][] = [];
  return {
    chamadas,
    async buscar(p, c) {
      chamadas.push([p, c]);
      return p === 'ADM-2026-000001' && c === '52998224725' ? { tenantId, candidateId } : null;
    },
  };
}

describe('PortalService.entrar', () => {
  it('protocolo + CPF corretos geram token so com tenant e candidato (sem papel de equipe)', async () => {
    const agora = Date.now();
    const s = new PortalService(repo(), config);
    const r = await s.entrar('ADM-2026-000001', '529.982.247-25', agora);
    const ctx = verificarToken(r.token, SEGREDO, agora + 1000);
    expect(ctx).toEqual({ tenantId, candidateId });
    expect(ctx.role).toBeUndefined();
    expect(ctx.userId).toBeUndefined();
    expect(r.expiraEm).toBe(Math.floor(agora / 1000) + TTL_TOKEN_CANDIDATO_S);
  });

  it('o token expira', async () => {
    const agora = Date.now();
    const r = await new PortalService(repo(), config).entrar('ADM-2026-000001', '52998224725', agora);
    expect(() => verificarToken(r.token, SEGREDO, agora + (TTL_TOKEN_CANDIDATO_S + 1) * 1000)).toThrow();
  });

  it('CPF invalido nem consulta o banco; CPF errado e protocolo inexistente dao o mesmo erro', async () => {
    const r = repo();
    const s = new PortalService(r, config);
    await expect(s.entrar('ADM-2026-000001', '111.111.111-11')).rejects.toBeInstanceOf(EntradaInvalidaError);
    expect(r.chamadas).toHaveLength(0);
    const errado = await s.entrar('ADM-2026-000001', '11144477735').catch((e) => e);
    const inexistente = await s.entrar('ADM-2026-999999', '52998224725').catch((e) => e);
    expect(errado).toBeInstanceOf(EntradaInvalidaError);
    expect(inexistente).toBeInstanceOf(EntradaInvalidaError);
    expect(errado.message).toBe(inexistente.message);
  });
});
