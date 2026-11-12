import type { DbContext } from '../db/db-context.js';
import type { Documento } from '../domain/documento.js';

/** O banco (RLS) recusou o envio: o chamador ve o chamado mas nao pode anexar a ele. */
export class EnvioNegadoError extends Error {}

export interface DocumentoRepository {
  /** O chamador pode acessar os documentos do chamado (dono ou equipe atribuida, conforme RLS)? */
  chamadoVisivel(chamadoId: string): Promise<boolean>;
  inserir(doc: Documento): Promise<void>;
  listarPorChamado(chamadoId: string): Promise<Documento[]>;
  obterPorId(id: string): Promise<Documento | null>;
  /** Grava a decisao; false se outra pessoa decidiu antes (concorrencia). */
  salvarDecisao(doc: Documento): Promise<boolean>;
}

export interface DocumentosUnitOfWork {
  executar<T>(ctx: DbContext, fn: (repo: DocumentoRepository) => Promise<T>): Promise<T>;
}

export const DOCUMENTOS_UOW = Symbol('DOCUMENTOS_UOW');
export const STORAGE = Symbol('STORAGE');
