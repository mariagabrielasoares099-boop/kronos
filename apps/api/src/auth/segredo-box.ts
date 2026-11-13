import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/** AES-256-GCM para segredos em repouso (ex.: totp_secret). Formato: v1.iv.tag.cifrado (base64url). */
const chave = (mestre: string): Buffer => Buffer.from(hkdfSync('sha256', mestre, '', 'kronos:segredo-box:v1', 32));

export function cifrar(texto: string, mestre: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', chave(mestre), iv);
  const dados = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), dados.toString('base64url')].join('.');
}

export function decifrar(valor: string, mestre: string): string {
  const [v, iv, tag, dados] = valor.split('.');
  if (v !== 'v1' || !iv || !tag || !dados) throw new Error('segredo invalido');
  const d = createDecipheriv('aes-256-gcm', chave(mestre), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(dados, 'base64url')), d.final()]).toString('utf8');
}
