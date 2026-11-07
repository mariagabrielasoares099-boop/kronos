import {
  assertTransition,
  FlowConfig,
  nextStatus,
  returnTarget,
  TicketStatus,
  TERMINAL_STATUSES,
} from './ticket-status.js';

/** Registro da trilha de auditoria (vira uma linha append-only em ticket_events). */
export interface EventoChamado {
  tipo: 'CRIADO' | 'TRANSICAO';
  autor: string | null;
  de: TicketStatus | null;
  para: TicketStatus;
  motivo: string | null;
  em: Date;
}

/** Regra de negocio violada (o controller traduz para 409). */
export class ChamadoError extends Error {}

export interface ChamadoProps {
  id: string;
  tenantId: string;
  protocolo: string;
  jobId: string;
  candidateId: string;
  status: TicketStatus;
  /** Etapas opcionais habilitadas na vaga deste chamado. */
  fluxo: FlowConfig;
  erpRef: string | null;
}

/**
 * Agregado raiz: cada candidatura e um chamado. So ele muda o proprio status,
 * e toda mudanca gera um evento para a trilha de auditoria.
 */
export class Chamado {
  private eventos: EventoChamado[] = [];

  private constructor(private props: ChamadoProps) {}

  static abrir(
    dados: Omit<ChamadoProps, 'status' | 'erpRef'>,
    autor: string | null,
    agora: Date = new Date(),
  ): Chamado {
    const c = new Chamado({ ...dados, status: 'TRIAGEM', erpRef: null });
    c.eventos.push({ tipo: 'CRIADO', autor, de: null, para: 'TRIAGEM', motivo: null, em: agora });
    return c;
  }

  /** Reidrata do banco, sem gerar evento. */
  static reconstituir(props: ChamadoProps): Chamado {
    return new Chamado({ ...props });
  }

  get id() { return this.props.id; }
  get tenantId() { return this.props.tenantId; }
  get protocolo() { return this.props.protocolo; }
  get jobId() { return this.props.jobId; }
  get candidateId() { return this.props.candidateId; }
  get status() { return this.props.status; }
  get erpRef() { return this.props.erpRef; }
  get encerrado() { return TERMINAL_STATUSES.includes(this.props.status); }

  /** Vai para a proxima etapa ativa da vaga. */
  avancar(autor: string | null, agora: Date = new Date()): TicketStatus {
    const para = nextStatus(this.props.status, this.props.fluxo);
    if (!para) throw new ChamadoError(`Chamado ${this.props.status} nao tem proxima etapa`);
    this.mover(para, autor, null, agora);
    return para;
  }

  /** Retorno: documento recusado volta ao candidato; erro do ERP volta ao DP. */
  devolver(autor: string | null, motivo: string, agora: Date = new Date()): TicketStatus {
    const para = returnTarget(this.props.status);
    if (!para) throw new ChamadoError(`Chamado ${this.props.status} nao tem retorno`);
    this.mover(para, autor, motivo, agora);
    return para;
  }

  reprovar(autor: string | null, motivo: string, agora: Date = new Date()): void {
    this.mover('REPROVADO', autor, motivo, agora);
  }

  /** Define a referencia do ERP uma unica vez (envio idempotente). */
  registrarErpRef(ref: string): void {
    if (!ref.trim()) throw new Error('erpRef vazio');
    if (this.props.erpRef && this.props.erpRef !== ref) {
      throw new Error('Chamado ja tem erpRef diferente');
    }
    this.props.erpRef = ref;
  }

  /** Entrega e esvazia os eventos pendentes para o repositorio gravar. */
  coletarEventos(): EventoChamado[] {
    const e = this.eventos;
    this.eventos = [];
    return e;
  }

  snapshot(): Readonly<ChamadoProps> {
    return { ...this.props };
  }

  private mover(para: TicketStatus, autor: string | null, motivo: string | null, em: Date): void {
    const de = this.props.status;
    assertTransition(de, para, this.props.fluxo, motivo ?? undefined);
    this.props.status = para;
    this.eventos.push({ tipo: 'TRANSICAO', autor, de, para, motivo: motivo?.trim() || null, em });
  }
}
