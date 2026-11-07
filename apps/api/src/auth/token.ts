import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { DbContext, parseContext } from '../db/db-context.js';

/**
 * Token HS256 minimo, assinado com JWT_SECRET. Transporta so o contexto de acesso do RLS.
 * E a ponte ate o login do modulo 01: quem emite o token passa a ser o login, o resto nao muda.
 */
const HEADER = JSON.stringify({ alg: 'HS256', typ: 'JWT' });

const claimsSchema = z
  .object({
    tid: z.uuid(),
    uid: z.uuid().optional(),
    role: z.string().optional(),
    cid: z.uuid().optional(),
    iat: z.number().int(),
    exp: z.number().int(),
  })
  .strict();

export class TokenInvalidoError extends Error {}

const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64url');
const assinar = (dados: string, segredo: string) => createHmac('sha256', segredo).update(dados).digest();

export function assinarToken(ctx: DbContext, segredo: string, ttlSegundos = 8 * 3600, agora = Date.now()): string {
  const iat = Math.floor(agora / 1000);
  const corpo = JSON.stringify({
    tid: ctx.tenantId, uid: ctx.userId, role: ctx.role, cid: ctx.candidateId, iat, exp: iat + ttlSegundos,
  });
  const dados = `${b64(HEADER)}.${b64(corpo)}`;
  return `${dados}.${b64(assinar(dados, segredo))}`;
}

/** Valida assinatura, algoritmo, expiracao e formato; devolve o contexto do RLS. Nunca detalha o motivo. */
export function verificarToken(token: string, segredo: string, agora = Date.now()): DbContext {
  const partes = token.split('.');
  if (partes.length !== 3) throw new TokenInvalidoError();
  const [h, p, s] = partes as [string, string, string];
  // Exige o cabecalho exato: rejeita alg=none e troca de algoritmo.
  if (Buffer.from(h, 'base64url').toString() !== HEADER) throw new TokenInvalidoError();
  const esperado = assinar(`${h}.${p}`, segredo);
  const recebido = Buffer.from(s, 'base64url');
  if (recebido.length !== esperado.length || !timingSafeEqual(recebido, esperado)) throw new TokenInvalidoError();
  let claims;
  try {
    claims = claimsSchema.parse(JSON.parse(Buffer.from(p, 'base64url').toString()));
  } catch {
    throw new TokenInvalidoError();
  }
  if (claims.exp * 1000 <= agora) throw new TokenInvalidoError();
  try {
    return parseContext({ tenantId: claims.tid, userId: claims.uid, role: claims.role, candidateId: claims.cid });
  } catch {
    throw new TokenInvalidoError();
  }
}
