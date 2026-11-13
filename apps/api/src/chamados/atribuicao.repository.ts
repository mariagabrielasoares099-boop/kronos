import type { DbContext } from '../db/db-context.js';

/** Quem pode ser atribuido a um chamado: so quem decide documentos (mesmo criterio das rotas de decisao). */
export const PAPEIS_ATRIBUIVEIS = ['RECRUTADOR', 'DP'] as const;

export interface ChamadoParaAtribuir {
  id: string;
  tenantId: string;
  companyId: string | null;
}

export interface UsuarioAtribuivel {
  id: string;
  nome: string;
  role: string;
}

/**
 * Escrita da atribuicao. Cada metodo roda sob o RLS de quem chama: chamado de outra empresa ou outro tenant
 * simplesmente nao aparece (null). O banco ainda exige vinculo do atribuido com a empresa (trigger).
 */
export interface AtribuicaoRepository {
  chamado(id: string): Promise<ChamadoParaAtribuir | null>;
  usuario(id: string): Promise<UsuarioAtribuivel | null>;
  temVinculoComEmpresa(usuarioId: string, companyId: string): Promise<boolean>;
  jaAtribuido(chamadoId: string, usuarioId: string): Promise<boolean>;
  /** Grava a atribuicao, o responsavel exibido na fila e o evento de auditoria, na mesma transacao. */
  atribuir(c: ChamadoParaAtribuir, alvo: UsuarioAtribuivel, autorId: string): Promise<void>;
}

export interface AtribuicaoUnitOfWork {
  executar<T>(ctx: DbContext, fn: (repo: AtribuicaoRepository) => Promise<T>): Promise<T>;
}

export const ATRIBUICAO_UOW = Symbol('ATRIBUICAO_UOW');
