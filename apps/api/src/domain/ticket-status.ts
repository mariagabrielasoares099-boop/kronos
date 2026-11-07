/**
 * Ciclo de vida do chamado: 10 status, 2 retornos.
 * ATENCAO: nomes/ordem inferidos do texto do escopo (o diagrama do PDF e imagem).
 * Conferir com o diagrama e ajustar aqui, em um unico lugar.
 */
export const TicketStatus = {
  TRIAGEM: 'TRIAGEM',
  TESTES: 'TESTES',
  ENTREVISTA: 'ENTREVISTA',
  APROVADO: 'APROVADO',
  AGUARDANDO_CANDIDATO: 'AGUARDANDO_CANDIDATO',
  VALIDACAO_DP: 'VALIDACAO_DP',
  ASSINATURA: 'ASSINATURA',
  ENVIO_ERP: 'ENVIO_ERP',
  ADMITIDO: 'ADMITIDO',
  REPROVADO: 'REPROVADO',
} as const;
export type TicketStatus = (typeof TicketStatus)[keyof typeof TicketStatus];

/** Etapas que o cliente pode desligar por vaga. ENVIO_ERP e ADMITIDO sao fixos. */
export const OPTIONAL_STATUSES: readonly TicketStatus[] = ['TESTES', 'ENTREVISTA', 'ASSINATURA'];
export const FIXED_STATUSES: readonly TicketStatus[] = ['ENVIO_ERP', 'ADMITIDO'];
export const TERMINAL_STATUSES: readonly TicketStatus[] = ['ADMITIDO', 'REPROVADO'];

const FORWARD: readonly TicketStatus[] = [
  'TRIAGEM', 'TESTES', 'ENTREVISTA', 'APROVADO', 'AGUARDANDO_CANDIDATO',
  'VALIDACAO_DP', 'ASSINATURA', 'ENVIO_ERP', 'ADMITIDO',
];

/** Retornos: documento recusado volta ao candidato; erro do ERP volta ao DP. */
const RETURNS: Partial<Record<TicketStatus, readonly TicketStatus[]>> = {
  VALIDACAO_DP: ['AGUARDANDO_CANDIDATO'],
  ENVIO_ERP: ['VALIDACAO_DP'],
};

export interface FlowConfig {
  /** Etapas opcionais habilitadas para a vaga. */
  enabled: readonly TicketStatus[];
}

/** Destino do retorno a partir de um status, ou null se ele nao tem retorno. */
export function returnTarget(from: TicketStatus): TicketStatus | null {
  return RETURNS[from]?.[0] ?? null;
}

const isActive =(s: TicketStatus, cfg: FlowConfig) =>
  !OPTIONAL_STATUSES.includes(s) || cfg.enabled.includes(s);

export function nextStatus(current: TicketStatus, cfg: FlowConfig): TicketStatus | null {
  if (TERMINAL_STATUSES.includes(current)) return null;
  const i = FORWARD.indexOf(current);
  for (let j = i + 1; j < FORWARD.length; j++) {
    const s = FORWARD[j]!;
    if (isActive(s, cfg)) return s;
  }
  return null;
}

export function canTransition(from: TicketStatus, to: TicketStatus, cfg: FlowConfig): boolean {
  if (TERMINAL_STATUSES.includes(from)) return false;
  if (to === 'REPROVADO') return !FIXED_STATUSES.includes(from);
  if (RETURNS[from]?.includes(to)) return true;
  return nextStatus(from, cfg) === to;
}

export class InvalidTransitionError extends Error {
  constructor(from: TicketStatus, to: TicketStatus) {
    super(`Transicao invalida: ${from} -> ${to}`);
  }
}

/** Retornos e reprovacao exigem motivo (vai para a trilha de auditoria). */
export function assertTransition(from: TicketStatus, to: TicketStatus, cfg: FlowConfig, reason?: string): void {
  if (!canTransition(from, to, cfg)) throw new InvalidTransitionError(from, to);
  const isReturn = RETURNS[from]?.includes(to) ?? false;
  if ((isReturn || to === 'REPROVADO') && !reason?.trim()) {
    throw new Error('Motivo obrigatorio para retorno ou reprovacao');
  }
}
