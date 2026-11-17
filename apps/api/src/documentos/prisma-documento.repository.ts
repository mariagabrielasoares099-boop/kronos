import { Inject, Injectable } from '@nestjs/common';
import type { DbContext } from '../db/db-context.js';
import { DbService, Tx } from '../db/db.service.js';
import { Documento, MimeDocumento, StatusDocumento, TipoDocumento } from '../domain/documento.js';
import type { DocumentoRepository, DocumentosUnitOfWork, EventoDecisao } from './documento.repository.js';

const COLUNAS = {
  id: true, tenantId: true, ticketId: true, tipo: true, status: true, motivo: true, chaveStorage: true,
  mime: true, tamanhoBytes: true, sha256: true, enviadoEm: true, revisadoPor: true,
} as const;

type Linha = {
  id: string; tenantId: string; ticketId: string; tipo: string; status: string; motivo: string | null;
  chaveStorage: string; mime: string; tamanhoBytes: number; sha256: string; enviadoEm: Date; revisadoPor: string | null;
};

/** Os valores ja sao garantidos pelos CHECKs da tabela. */
const paraDominio = (l: Linha): Documento =>
  Documento.reconstituir({
    id: l.id, tenantId: l.tenantId, chamadoId: l.ticketId, tipo: l.tipo as TipoDocumento,
    status: l.status as StatusDocumento, motivo: l.motivo, chaveStorage: l.chaveStorage, mime: l.mime as MimeDocumento,
    tamanhoBytes: l.tamanhoBytes, sha256: l.sha256, enviadoEm: l.enviadoEm, revisadoPor: l.revisadoPor,
  });

export class PrismaDocumentoRepository implements DocumentoRepository {
  constructor(private readonly tx: Tx) {}

  async podeAcessar(chamadoId: string): Promise<boolean> {
    const r = await this.tx.$queryRaw<{ pode: boolean }[]>`
      SELECT ((staff_sees_ticket(${chamadoId}::uuid) AND is_assigned(${chamadoId}::uuid))
              OR candidate_owns_ticket(${chamadoId}::uuid)) AS pode`;
    return r[0]?.pode === true;
  }

  contarPorChamado(chamadoId: string): Promise<number> {
    return this.tx.document.count({ where: { ticketId: chamadoId } });
  }

  async inserir(d: Documento): Promise<void> {
    const s = d.snapshot();
    await this.tx.document.create({
      data: {
        id: s.id, tenantId: s.tenantId, ticketId: s.chamadoId, tipo: s.tipo, status: s.status, motivo: s.motivo,
        chaveStorage: s.chaveStorage, mime: s.mime, tamanhoBytes: s.tamanhoBytes, sha256: s.sha256,
        enviadoEm: s.enviadoEm, revisadoPor: s.revisadoPor,
      },
      select: { id: true },
    });
  }

  async listarPorChamado(chamadoId: string): Promise<Documento[]> {
    const linhas = await this.tx.document.findMany({
      where: { ticketId: chamadoId },
      select: COLUNAS,
      orderBy: [{ enviadoEm: 'asc' }, { id: 'asc' }],
    });
    return linhas.map(paraDominio);
  }

  async obter(id: string): Promise<Documento | null> {
    const l = await this.tx.document.findUnique({ where: { id }, select: COLUNAS });
    return l ? paraDominio(l) : null;
  }

  async salvarDecisao(d: Documento, e: EventoDecisao): Promise<boolean> {
    const s = d.snapshot();
    // Otimista: so grava se ainda esta PENDENTE (dois revisores ao mesmo tempo nao sobrescrevem).
    const r = await this.tx.document.updateMany({
      where: { id: s.id, status: 'PENDENTE' },
      data: { status: s.status, motivo: s.motivo, revisadoPor: s.revisadoPor },
    });
    if (r.count === 0) return false;
    await this.tx.ticketEvent.create({
      data: {
        tenantId: s.tenantId, ticketId: s.chamadoId, tipo: e.tipo, autor: e.autor, motivo: e.motivo,
        payload: { documentoId: s.id, tipoDocumento: s.tipo }, createdAt: e.em,
      },
      select: { id: true },
    });
    return true;
  }
}

@Injectable()
export class PrismaDocumentosUnitOfWork implements DocumentosUnitOfWork {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  executar<T>(ctx: DbContext, fn: (repo: DocumentoRepository) => Promise<T>): Promise<T> {
    return this.db.run(ctx, (tx) => fn(new PrismaDocumentoRepository(tx)));
  }
}
