import { Inject, Injectable } from '@nestjs/common';
import type { DbContext } from '../db/db-context.js';
import { DbService, Tx } from '../db/db.service.js';
import { Documento, type MimeDocumento, type StatusDocumento, type TipoDocumento } from '../domain/documento.js';
import { EnvioNegadoError, type DocumentoRepository, type DocumentosUnitOfWork } from './documento.repository.js';

type Linha = NonNullable<Awaited<ReturnType<Tx['document']['findFirst']>>>;

const paraDominio = (l: Linha): Documento =>
  Documento.reconstituir({
    id: l.id, tenantId: l.tenantId, chamadoId: l.ticketId, tipo: l.tipo as TipoDocumento,
    status: l.status as StatusDocumento, motivo: l.motivo, chaveStorage: l.chaveStorage,
    mime: l.mime as MimeDocumento, tamanhoBytes: l.tamanhoBytes, sha256: l.sha256,
    enviadoEm: l.enviadoEm, revisadoPor: l.revisadoPor,
  });

/** Procura o SQLSTATE 42501 (insufficient_privilege) ou a mensagem do RLS na cadeia de causas do erro. */
function violouRls(e: unknown, nivel = 0): boolean {
  if (!e || typeof e !== 'object' || nivel > 5) return false;
  const o = e as { code?: unknown; originalCode?: unknown; message?: unknown; cause?: unknown; meta?: unknown };
  if (o.code === '42501' || o.originalCode === '42501') return true;
  if (typeof o.message === 'string' && /row-level security|42501/i.test(o.message)) return true;
  return violouRls(o.cause, nivel + 1) || violouRls(o.meta, nivel + 1) || violouRls((o.meta as { driverAdapterError?: unknown } | undefined)?.driverAdapterError, nivel + 1);
}

export class PrismaDocumentoRepository implements DocumentoRepository {
  constructor(private readonly tx: Tx) {}

  async chamadoVisivel(chamadoId: string): Promise<boolean> {
    // Ver o chamado nao basta: documentos exigem atribuicao da equipe.
    // Usa as mesmas funcoes da politica RLS antes de gravar qualquer arquivo.
    const [acesso] = await this.tx.$queryRaw<{ permitido: boolean }[]>`
      SELECT (
        (staff_sees_ticket(${chamadoId}::uuid) AND is_assigned(${chamadoId}::uuid))
        OR candidate_owns_ticket(${chamadoId}::uuid)
      ) AS permitido
    `;
    return acesso?.permitido === true;
  }

  async inserir(doc: Documento): Promise<void> {
    const s = doc.snapshot();
    try {
      await this.tx.document.create({
        data: {
          id: s.id, tenantId: s.tenantId, ticketId: s.chamadoId, tipo: s.tipo, status: s.status,
          chaveStorage: s.chaveStorage, mime: s.mime, tamanhoBytes: s.tamanhoBytes, sha256: s.sha256, enviadoEm: s.enviadoEm,
        },
        select: { id: true },
      });
    } catch (e) {
      // Equipe que ve o chamado mas nao esta atribuida a ele: o RLS barra o INSERT (42501).
      if (violouRls(e)) throw new EnvioNegadoError();
      throw e;
    }
  }

  async listarPorChamado(chamadoId: string): Promise<Documento[]> {
    const linhas = await this.tx.document.findMany({ where: { ticketId: chamadoId }, orderBy: { enviadoEm: 'asc' } });
    return linhas.map(paraDominio);
  }

  async obterPorId(id: string): Promise<Documento | null> {
    const l = await this.tx.document.findFirst({ where: { id } });
    return l ? paraDominio(l) : null;
  }

  async salvarDecisao(doc: Documento): Promise<boolean> {
    const s = doc.snapshot();
    // Otimista: so decide quem ainda encontra o documento PENDENTE.
    const r = await this.tx.document.updateMany({
      where: { id: s.id, status: 'PENDENTE' },
      data: { status: s.status, motivo: s.motivo, revisadoPor: s.revisadoPor },
    });
    return r.count === 1;
  }
}

@Injectable()
export class PrismaDocumentosUnitOfWork implements DocumentosUnitOfWork {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  executar<T>(ctx: DbContext, fn: (repo: DocumentoRepository) => Promise<T>): Promise<T> {
    return this.db.run(ctx, (tx) => fn(new PrismaDocumentoRepository(tx)));
  }
}
