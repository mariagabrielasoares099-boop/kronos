import type { DbContext } from '../db/db-context.js';
import type { TicketStatus } from '../domain/ticket-status.js';

/** Linha da fila do RH. Nomes vem null quando o RLS nao deixa o chamador ver a vaga/pessoa. */
export interface ChamadoResumo {
  id: string;
  protocolo: string;
  status: TicketStatus;
  vagaTitulo: string | null;
  candidatoNome: string | null;
  responsavelNome: string | null;
  prazoSla: Date | null;
  criadoEm: Date;
}

export interface EventoLeitura {
  tipo: string;
  de: string | null;
  para: string | null;
  motivo: string | null;
  autorNome: string | null;
  em: Date;
}

export interface FiltroChamados {
  status?: TicketStatus;
  /** Protocolo ou nome (parcial) ou CPF (11 digitos). */
  busca?: string;
  limite: number;
}

/** Leitura da fila e da linha do tempo para a equipe. So le; quem escreve e o ChamadoRepository. */
export interface ConsultaChamados {
  listar(filtro: FiltroChamados): Promise<ChamadoResumo[]>;
  resumoPorProtocolo(protocolo: string): Promise<ChamadoResumo | null>;
  /** null = chamado inexistente ou invisivel para o chamador. */
  listarEventos(chamadoId: string): Promise<EventoLeitura[] | null>;
}

export interface ConsultaUnitOfWork {
  executar<T>(ctx: DbContext, fn: (consulta: ConsultaChamados) => Promise<T>): Promise<T>;
}

export const CONSULTA_UOW = Symbol('CONSULTA_UOW');
