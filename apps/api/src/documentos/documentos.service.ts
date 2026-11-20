import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { DbContext } from '../db/db-context.js';
import { Documento, type MimeDocumento, type StatusDocumento, TipoDocumento } from '../domain/documento.js';
import { validarArquivo } from './arquivo.js';
import { DOCUMENTOS_UOW, type DocumentosUnitOfWork } from './documento.repository.js';
import type { DecisaoDto } from './documentos.schemas.js';
import { STORAGE, type StoragePort } from './storage.js';

export class ChamadoNaoEncontradoError extends Error {}
export class DocumentoNaoEncontradoError extends Error {}
export class LimiteDocumentosError extends Error {}
export class DecisaoConcorrenteError extends Error {}

/** Passo 3: teto de envios por chamado (cada recusa gera um reenvio; 30 cobre o fluxo com folga). */
export const MAX_DOCUMENTOS_POR_CHAMADO = 30;

/** Checklist mockado igual para toda vaga ate o modulo 03 configurar por vaga. */
export const CHECKLIST_PADRAO: readonly TipoDocumento[] = [
  TipoDocumento.RG, TipoDocumento.CPF, TipoDocumento.COMPROVANTE_RESIDENCIA,
];

/** O que a API devolve. Sem a chave do storage: o arquivo so sai pela rota de download autenticada. */
export interface DocumentoView {
  id: string;
  chamadoId: string;
  tipo: TipoDocumento;
  status: StatusDocumento;
  motivo: string | null;
  mime: MimeDocumento;
  tamanhoBytes: number;
  enviadoEm: string;
}

export type SituacaoChecklist = StatusDocumento | 'FALTANDO';

export interface DocumentosDoChamado {
  checklist: { tipo: TipoDocumento; situacao: SituacaoChecklist }[];
  documentos: DocumentoView[];
}

export interface ArquivoParaDownload {
  conteudo: Buffer;
  mime: MimeDocumento;
  nome: string;
}

const EXTENSAO: Record<MimeDocumento, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf' };

const view = (d: Documento): DocumentoView => {
  const s = d.snapshot();
  return {
    id: s.id, chamadoId: s.chamadoId, tipo: s.tipo, status: s.status, motivo: s.motivo, mime: s.mime,
    tamanhoBytes: s.tamanhoBytes, enviadoEm: s.enviadoEm.toISOString(),
  };
};

/** Situacao de cada item: vale o envio mais recente daquele tipo (um recusado e substituido pelo reenvio). */
export function montarChecklist(docs: Documento[]): DocumentosDoChamado['checklist'] {
  return CHECKLIST_PADRAO.map((tipo) => {
    const doTipo = docs.filter((d) => d.tipo === tipo);
    const ultimo = doTipo[doTipo.length - 1];
    return { tipo, situacao: ultimo ? ultimo.status : 'FALTANDO' };
  });
}

@Injectable()
export class DocumentosService {
  constructor(
    @Inject(DOCUMENTOS_UOW) private readonly uow: DocumentosUnitOfWork,
    @Inject(STORAGE) private readonly storage: StoragePort,
  ) {}

  /** Candidato (no proprio chamado) ou equipe atribuida envia um documento; nasce PENDENTE. */
  async enviar(ctx: DbContext, chamadoId: string, tipo: TipoDocumento, conteudo: Buffer, agora = new Date()): Promise<DocumentoView> {
    // Valida pelo conteudo antes de tocar no banco ou no disco.
    const arquivo = validarArquivo(conteudo);
    let chave: string | undefined;
    try {
      return await this.uow.executar(ctx, async (repo) => {
        if (!(await repo.podeAcessar(chamadoId))) throw new ChamadoNaoEncontradoError();
        if ((await repo.contarPorChamado(chamadoId)) >= MAX_DOCUMENTOS_POR_CHAMADO) throw new LimiteDocumentosError();
        chave = await this.storage.salvar(ctx.tenantId, conteudo);
        const doc = Documento.receber({
          id: randomUUID(), tenantId: ctx.tenantId, chamadoId, tipo, chaveStorage: chave, enviadoEm: agora, ...arquivo,
        });
        await repo.inserir(doc);
        return view(doc);
      });
    } catch (e) {
      // Banco recusou (ou a transacao caiu): o arquivo gravado nao pode ficar orfao no disco.
      if (chave) await this.storage.remover(chave).catch(() => undefined);
      throw e;
    }
  }

  async listar(ctx: DbContext, chamadoId: string): Promise<DocumentosDoChamado> {
    return this.uow.executar(ctx, async (repo) => {
      if (!(await repo.podeAcessar(chamadoId))) throw new ChamadoNaoEncontradoError();
      const docs = await repo.listarPorChamado(chamadoId);
      return { checklist: montarChecklist(docs), documentos: docs.map(view) };
    });
  }

  /** O RLS decide quem le; o arquivo e lido fora da transacao para nao segurar conexao durante o I/O. */
  async baixar(ctx: DbContext, id: string): Promise<ArquivoParaDownload> {
    const doc = await this.uow.executar(ctx, (repo) => repo.obter(id));
    if (!doc) throw new DocumentoNaoEncontradoError();
    const s = doc.snapshot();
    return { conteudo: await this.storage.ler(s.chaveStorage), mime: s.mime, nome: `documento-${s.id}.${EXTENSAO[s.mime]}` };
  }

  /** RH aprova ou recusa (com motivo). A decisao vai para a trilha do chamado. */
  async decidir(ctx: DbContext, id: string, dto: DecisaoDto, agora = new Date()): Promise<DocumentoView> {
    const revisor = ctx.userId;
    if (!revisor) throw new DocumentoNaoEncontradoError(); // so a equipe chega aqui (@Papeis)
    return this.uow.executar(ctx, async (repo) => {
      const doc = await repo.obter(id);
      if (!doc) throw new DocumentoNaoEncontradoError();
      if (dto.acao === 'APROVAR') doc.aprovar(revisor);
      else doc.recusar(revisor, dto.motivo);
      const ok = await repo.salvarDecisao(doc, {
        tipo: dto.acao === 'APROVAR' ? 'DOCUMENTO_APROVADO' : 'DOCUMENTO_RECUSADO',
        autor: revisor,
        motivo: dto.acao === 'RECUSAR' ? dto.motivo : null,
        em: agora,
      });
      if (!ok) throw new DecisaoConcorrenteError();
      return view(doc);
    });
  }
}
