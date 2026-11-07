import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

/** Porta de armazenamento. Hoje disco local; trocavel por MinIO/S3 sem tocar no dominio. */
export interface StoragePort {
  /** Grava e devolve uma chave opaca. */
  salvar(tenantId: string, conteudo: Buffer): Promise<string>;
  ler(chave: string): Promise<Buffer>;
}

const CHAVE_RE = /^[0-9a-f-]{36}\/[0-9a-f-]{36}$/;

export class LocalDiskStorage implements StoragePort {
  private readonly raiz: string;

  constructor(raiz: string) {
    this.raiz = resolve(raiz);
  }

  async salvar(tenantId: string, conteudo: Buffer): Promise<string> {
    const chave = `${tenantId}/${randomUUID()}`;
    this.validarChave(chave);
    const caminho = this.caminho(chave);
    await mkdir(join(this.raiz, tenantId), { recursive: true });
    await writeFile(caminho, conteudo, { flag: 'wx' });
    return chave;
  }

  async ler(chave: string): Promise<Buffer> {
    this.validarChave(chave);
    return readFile(this.caminho(chave));
  }

  /** Chave so pode ser <uuid>/<uuid>: bloqueia path traversal vindo de dado corrompido. */
  private validarChave(chave: string): void {
    if (!CHAVE_RE.test(chave)) throw new Error('Chave de storage invalida');
  }

  private caminho(chave: string): string {
    const p = resolve(this.raiz, chave);
    if (!p.startsWith(this.raiz + sep)) throw new Error('Chave fora da raiz do storage');
    return p;
  }
}
