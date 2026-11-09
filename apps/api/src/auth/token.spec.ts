import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { assinarToken, TokenInvalidoError, verificarToken } from './token.js';

const SEGREDO = 's'.repeat(40);
const ctx = { tenantId: randomUUID(), userId: randomUUID(), role: 'DP' as const };
const b64 = (s: string) => Buffer.from(s).toString('base64url');

describe('token', () => {
  it('ida e volta preserva o contexto', () => {
    expect(verificarToken(assinarToken(ctx, SEGREDO), SEGREDO)).toEqual(ctx);
    const cand = { tenantId: ctx.tenantId, candidateId: randomUUID() };
    expect(verificarToken(assinarToken(cand, SEGREDO), SEGREDO)).toEqual(cand);
  });

  it('rejeita segredo errado e adulteracao do corpo', () => {
    const t = assinarToken(ctx, SEGREDO);
    expect(() => verificarToken(t, 'x'.repeat(40))).toThrow(TokenInvalidoError);
    const [h, , s] = t.split('.');
    const corpo = b64(JSON.stringify({ tid: ctx.tenantId, uid: ctx.userId, role: 'ADMIN', iat: 1, exp: 9999999999 }));
    expect(() => verificarToken(`${h}.${corpo}.${s}`, SEGREDO)).toThrow(TokenInvalidoError);
  });

  it('rejeita alg=none e lixo', () => {
    const corpo = b64(JSON.stringify({ tid: ctx.tenantId, iat: 1, exp: 9999999999 }));
    expect(() => verificarToken(`${b64('{"alg":"none","typ":"JWT"}')}.${corpo}.`, SEGREDO)).toThrow(TokenInvalidoError);
    expect(() => verificarToken('abc', SEGREDO)).toThrow(TokenInvalidoError);
    expect(() => verificarToken('a.b.c', SEGREDO)).toThrow(TokenInvalidoError);
  });

  it('rejeita expirado', () => {
    const t = assinarToken(ctx, SEGREDO, 60, Date.now() - 120_000);
    expect(() => verificarToken(t, SEGREDO)).toThrow(TokenInvalidoError);
  });

  it('rejeita papel desconhecido mesmo com assinatura valida', () => {
    const t = assinarToken({ ...ctx, role: 'ROOT' as never }, SEGREDO);
    expect(() => verificarToken(t, SEGREDO)).toThrow(TokenInvalidoError);
  });
});
