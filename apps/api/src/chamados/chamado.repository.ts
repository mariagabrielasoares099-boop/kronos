import type { Chamado } from '../domain/chamado.js';
import type { FlowConfig } from '../domain/ticket-status.js';
import type { DbContext } from '../db/db-context.js';

export interface NovoCandidato {
  id: string;
  tenantId: string;
  cpf: string;
  nome: string;
  email: string;
  telefone: string | null;
  consentimentoEm: Date;
}

export class CandidatoJaExisteError extends Error {}

/** Leitura publica do chamado nao depende do fluxo da vaga, restrito a equipe. */
export type ChamadoLeitura = Pick<Chamado, 'id' | 'protocolo' | 'status' | 'jobId' | 'erpRef'>;

/** Porta de persistencia do agregado Chamado. Uma instancia vale por unidade de trabalho (transacao). */
export interface ChamadoRepository {
  /** Proximo protocolo ADM-AAAA-NNNNNN do tenant (contador atomico). */
  proximoProtocolo(ano: number): Promise<string>;
  /** Fluxo da vaga, ou null se ela nao existe ou o chamador nao pode ve-la. */
  obterFluxoDaVaga(jobId: string): Promise<FlowConfig | null>;
  criarCandidato(c: NovoCandidato): Promise<void>;
  /** Grava o chamado novo e seus eventos. */
  inserir(chamado: Chamado): Promise<void>;
  obterPorProtocolo(protocolo: string): Promise<ChamadoLeitura | null>;
  obterPorId(id: string): Promise<Chamado | null>;
  /** Grava o novo status e os eventos pendentes; false se alguem mudou o status antes (concorrencia). */
  salvarTransicao(chamado: Chamado, statusAnterior: string): Promise<boolean>;
}

/** Executa um bloco de trabalho atomico sob o contexto de acesso informado (RLS). */
export interface UnitOfWork {
  executar<T>(ctx: DbContext, fn: (repo: ChamadoRepository) => Promise<T>): Promise<T>;
}

export const UNIT_OF_WORK = Symbol('UNIT_OF_WORK');
