import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { DbContext } from '../db/db-context.js';
import { Documento, type TipoDocumento } from '../domain/documento.js';
import { validarArquivo } from './arquivo.js';
import { DOCUMENTOS_UOW, STORAGE, type DocumentosUnitOfWork } from './documento.repository.js';
import { CHECKLIST_PADRAO, type DecisaoDto } from './documentos.schemas.js';
import type { StoragePort } from './storage.js';

export class ChamadoInacessivelError extends Error {}
export class DocumentoNaoEncontradoError extends Error {}
export class DecisaoConcorrenteError extends Error {}

/** Metadados devolvidos pela API: nunca a chave de storage nem o caminho do arquivo. */
export interface DocumentoView {
  id: string;
  chamadoId: string;
  tipo: TipoDocumento;
  status: string;
  motivo: string | null;
  mime: string;
  tamanhoBytes: number;
  enviadoEm: Date;
}

const view = (d: Documento): DocumentoView => {
  const s = d.snapshot();
  return {
    id: s.id, chamadoId: s.chamadoId, tipo: s.tipo, status: s.status, motivo: s.motivo,
    mime: s.mime, tamanhoBytes: s.tamanhoBytes, enviadoEm: s.enviadoEm,
  };
};

@Injectable()
export class DocumentosService {
  constructor(
    @Inject(DOCUMENTOS_UOW) private readonly uow: DocumentosUnitOfWork,
    @Inject(STORAGE) private readonly storage: StoragePort,
  ) {}

  /** Valida o conteudo (ArquivoInvalidoError sobe), confere acesso ao chamado, grava o arquivo e os metadados. */
  async enviar(ctx: DbContext, chamadoId: string, tipo: TipoDocumento, conteudo: Buffer, agora = new Date()): Promise<DocumentoView> {
    const arq = validarArquivo(conteudo);
    let chaveSalva: string | undefined;
    try {
      return await this.uow.executar(ctx, async (repo) => {
        if (!(await repo.chamadoVisivel(chamadoId))) throw new ChamadoInacessivelError();
        const chaveStorage = await this.storage.salvar(ctx.tenantId, conteudo);
        chaveSalva = chaveStorage;
        const doc = Documento.receber({
          id: randomUUID(), tenantId: ctx.tenantId, chamadoId, tipo, chaveStorage,
          mime: arq.mime, tamanhoBytes: arq.tamanhoBytes, sha256: arq.sha256, enviadoEm: agora,
        });
        await repo.inserir(doc);
        return view(doc);
      });
    } catch (e) {
      // A transacao tambem pode falhar depois do callback, ao efetivar o commit.
      if (chaveSalva) await this.storage.remover(chaveSalva).catch(() => undefined);
      throw e;
    }
  }

  async listar(ctx: DbContext, chamadoId: string) {
    return this.uow.executar(ctx, async (repo) => {
      if (!(await repo.chamadoVisivel(chamadoId))) throw new ChamadoInacessivelError();
      const docs = (await repo.listarPorChamado(chamadoId)).map(view);
      // Cada item do checklist mostra o status do ultimo envio daquele tipo.
      const checklist = CHECKLIST_PADRAO.map((tipo) => {
        const ultimo = docs.filter((d) => d.tipo === tipo).at(-1);
        return { tipo, enviado: !!ultimo, status: ultimo?.status ?? 'FALTANDO' };
      });
      return { documentos: docs, checklist };
    });
  }

  async baixar(ctx: DbContext, id: string): Promise<{ mime: string; conteudo: Buffer }> {
    const s = await this.uow.executar(ctx, async (repo) => (await repo.obterPorId(id))?.snapshot() ?? null);
    if (!s) throw new DocumentoNaoEncontradoError();
    return { mime: s.mime, conteudo: await this.storage.ler(s.chaveStorage) };
  }

  async decidir(ctx: DbContext, id: string, dto: DecisaoDto): Promise<DocumentoView> {
    return this.uow.executar(ctx, async (repo) => {
      const doc = await repo.obterPorId(id);
      if (!doc) throw new DocumentoNaoEncontradoError();
      const revisor = ctx.userId!; // rota restrita a equipe (@Papeis)
      if (dto.status === 'APROVADO') doc.aprovar(revisor);
      else doc.recusar(revisor, dto.motivo);
      if (!(await repo.salvarDecisao(doc))) throw new DecisaoConcorrenteError();
      return view(doc);
    });
  }
}
