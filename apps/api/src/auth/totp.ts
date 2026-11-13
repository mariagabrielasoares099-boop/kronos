import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** TOTP (RFC 6238): HMAC-SHA1, 6 digitos, passo de 30 s. Compativel com Google/Microsoft Authenticator. */
const PASSO_S = 30;
const DIGITOS = 6;
const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0, valor = 0, out = '';
  for (const b of buf) {
    valor = (valor << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALFABETO[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALFABETO[(valor << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  let bits = 0, valor = 0;
  const out: number[] = [];
  for (const ch of s.replace(/=+$/, '').toUpperCase()) {
    const i = ALFABETO.indexOf(ch);
    if (i < 0) throw new Error('base32 invalido');
    valor = (valor << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((valor >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const novoSegredoTotp = (): string => base32Encode(randomBytes(20));

export function codigoTotp(segredoBase32: string, passo: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(passo));
  const h = createHmac('sha1', base32Decode(segredoBase32)).update(msg).digest();
  const off = h[h.length - 1]! & 15;
  const n = (h.readUInt32BE(off) & 0x7fffffff) % 10 ** DIGITOS;
  return n.toString().padStart(DIGITOS, '0');
}

export const passoDe = (agora = Date.now()): number => Math.floor(agora / 1000 / PASSO_S);

/** Devolve o passo aceito (para o chamador impedir reuso do mesmo codigo) ou null. Tolera 1 passo de relogio. */
export function verificarTotp(segredoBase32: string, codigo: string, agora = Date.now()): number | null {
  if (!/^\d{6}$/.test(codigo)) return null;
  const atual = passoDe(agora);
  let aceito: number | null = null;
  for (const p of [atual - 1, atual, atual + 1]) {
    const esperado = Buffer.from(codigoTotp(segredoBase32, p));
    if (timingSafeEqual(esperado, Buffer.from(codigo)) && aceito === null) aceito = p;
  }
  return aceito;
}

/** URI para QR code de cadastro no aplicativo autenticador. */
export function uriTotp(segredo: string, conta: string, emissor = 'KRONOS'): string {
  const e = encodeURIComponent(emissor);
  return `otpauth://totp/${e}:${encodeURIComponent(conta)}?secret=${segredo}&issuer=${e}&digits=${DIGITOS}&period=${PASSO_S}`;
}
