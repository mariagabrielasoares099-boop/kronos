export const TipoDocumento = {
  RG: 'RG',
  CPF: 'CPF',
  COMPROVANTE_RESIDENCIA: 'COMPROVANTE_RESIDENCIA',
  CTPS: 'CTPS',
  FOTO_3X4: 'FOTO_3X4',
  OUTRO: 'OUTRO',
} as const;
export type TipoDocumento = (typeof TipoDocumento)[keyof typeof TipoDocumento];

export type StatusDocumento = 'PENDENTE' | 'APROVADO' | 'RECUSADO';

export type MimeDocumento = 'image/jpeg' | 'image/png' | 'application/pdf';

export interface DocumentoProps {
  id: string;
  tenantId: string;
  chamadoId: string;
  tipo: TipoDocumento;
  status: StatusDocumento;
  motivo: string | null;
  /** Chave opaca no storage (nunca derivada do nome enviado pelo usuario). */
  chaveStorage: string;
  mime: MimeDocumento;
  tamanhoBytes: number;
  sha256: string;
  enviadoEm: Date;
  revisadoPor: string | null;
}

export class DocumentoError extends Error {}

/** Documento do candidato. Recebe uma decisao do RH; recusado e substituido por novo envio. */
export class Documento {
  private constructor(private props: DocumentoProps) {}

  static receber(dados: Omit<DocumentoProps, 'status' | 'motivo' | 'revisadoPor'>): Documento {
    return new Documento({ ...dados, status: 'PENDENTE', motivo: null, revisadoPor: null });
  }

  static reconstituir(props: DocumentoProps): Documento {
    return new Documento({ ...props });
  }

  get id() { return this.props.id; }
  get chamadoId() { return this.props.chamadoId; }
  get tipo() { return this.props.tipo; }
  get status() { return this.props.status; }

  aprovar(revisor: string): void {
    this.exigirPendente();
    this.props.status = 'APROVADO';
    this.props.revisadoPor = revisor;
    this.props.motivo = null;
  }

  recusar(revisor: string, motivo: string): void {
    this.exigirPendente();
    if (!motivo.trim()) throw new DocumentoError('Motivo obrigatorio para recusar documento');
    this.props.status = 'RECUSADO';
    this.props.revisadoPor = revisor;
    this.props.motivo = motivo.trim();
  }

  snapshot(): Readonly<DocumentoProps> {
    return { ...this.props };
  }

  private exigirPendente(): void {
    if (this.props.status !== 'PENDENTE') {
      throw new DocumentoError(`Documento ja foi decidido (${this.props.status})`);
    }
  }
}
