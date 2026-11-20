import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

/** Porta de armazenamento. Hoje disco local; trocavel por MinIO/S3 sem tocar no dominio. */
export interface StoragePort {
  /** Grava e devolve uma chave opaca. */
  salvar(tenantId: string, conteudo: Buffer): Promise<string>;
  ler(chave: string): Promise<Buffer>;
  /** Apaga o arquivo; nao falha se ele ja nao existe. Desfaz um envio que o banco recusou. */
  remover(chave: string): Promise<void>;
}

export const STORAGE = Symbol('STORAGE');

const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const CHAVE_RE = new RegExp(`^${UUID_PATTERN}/${UUID_PATTERN}$`);

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

  async remover(chave: string): Promise<void> {
    this.validarChave(chave);
    await rm(this.caminho(chave), { force: true });
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
