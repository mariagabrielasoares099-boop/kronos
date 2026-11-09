import { createHash } from 'node:crypto';
import type { MimeDocumento } from '../domain/documento.js';

export const TAMANHO_MAXIMO_BYTES = 5 * 1024 * 1024;

export class ArquivoInvalidoError extends Error {}

export interface ArquivoValidado {
  mime: MimeDocumento;
  tamanhoBytes: number;
  sha256: string;
}

const startsWith = (b: Buffer, sig: number[]) => sig.every((v, i) => b[i] === v);

/** Descobre o tipo real pelo conteudo (magic bytes), ignorando extensao e Content-Type enviados. */
export function detectarMime(b: Buffer): MimeDocumento | null {
  if (startsWith(b, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(b, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf'; // %PDF-
  return null;
}

export function validarArquivo(b: Buffer, maximo = TAMANHO_MAXIMO_BYTES): ArquivoValidado {
  if (b.length === 0) throw new ArquivoInvalidoError('Arquivo vazio');
  if (b.length > maximo) throw new ArquivoInvalidoError('Arquivo acima do tamanho maximo');
  const mime = detectarMime(b);
  if (!mime) throw new ArquivoInvalidoError('Tipo nao permitido: envie JPG, PNG ou PDF');
  return { mime, tamanhoBytes: b.length, sha256: createHash('sha256').update(b).digest('hex') };
}
