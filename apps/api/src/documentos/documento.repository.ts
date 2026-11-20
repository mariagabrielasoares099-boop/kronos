import type { DbContext } from '../db/db-context.js';
import type { Documento } from '../domain/documento.js';

/** Registro da decisao do RH na trilha do chamado (append-only em ticket_events). */
export interface EventoDecisao {
  tipo: 'DOCUMENTO_APROVADO' | 'DOCUMENTO_RECUSADO';
  autor: string;
  motivo: string | null;
  em: Date;
}

/** Porta de persistencia dos documentos. Uma instancia vale por unidade de trabalho (transacao). */
export interface DocumentoRepository {
  /**
   * Mesma regra do RLS de `documents`: equipe atribuida ao chamado ou o proprio candidato.
   * Falso tambem quando o chamado nao existe (nao se distingue de "sem permissao").
   */
  podeAcessar(chamadoId: string): Promise<boolean>;
  contarPorChamado(chamadoId: string): Promise<number>;
  inserir(documento: Documento): Promise<void>;
  listarPorChamado(chamadoId: string): Promise<Documento[]>;
  obter(id: string): Promise<Documento | null>;
  /** Grava a decisao e o evento; false se outra pessoa decidiu antes (concorrencia). */
  salvarDecisao(documento: Documento, evento: EventoDecisao): Promise<boolean>;
}

export interface DocumentosUnitOfWork {
  executar<T>(ctx: DbContext, fn: (repo: DocumentoRepository) => Promise<T>): Promise<T>;
}

export const DOCUMENTOS_UOW = Symbol('DOCUMENTOS_UOW');
