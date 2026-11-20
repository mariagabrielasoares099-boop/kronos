import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (senha: string, sal: Buffer, tam: number, opts: object) => Promise<Buffer>;

/** scrypt (OWASP: N=2^17, r=8, p=1). Formato: scrypt$N$r$p$sal$hash (base64url). */
const N = 2 ** 17, R = 8, P = 1, TAM = 32;
const OPTS = { N, r: R, p: P, maxmem: 256 * 1024 * 1024 };

export async function hashSenha(senha: string): Promise<string> {
  const sal = randomBytes(16);
  const h = await scrypt(senha.normalize('NFKC'), sal, TAM, OPTS);
  return ['scrypt', N, R, P, sal.toString('base64url'), h.toString('base64url')].join('$');
}

/** Falso para qualquer formato invalido; nunca lanca por causa do hash armazenado. */
export async function verificarSenha(senha: string, armazenado: string): Promise<boolean> {
  const p = armazenado.split('$');
  if (p.length !== 6 || p[0] !== 'scrypt') return false;
  const [n, r, par] = [Number(p[1]), Number(p[2]), Number(p[3])];
  if (n !== N || r !== R || par !== P) return false; // parametros fixos: impede custo arbitrario vindo do banco
  const sal = Buffer.from(p[4]!, 'base64url');
  const esperado = Buffer.from(p[5]!, 'base64url');
  if (esperado.length !== TAM || sal.length === 0) return false;
  const h = await scrypt(senha.normalize('NFKC'), sal, TAM, OPTS);
  return timingSafeEqual(h, esperado);
}


