import { describe, expect, it } from 'vitest';
import type { DbContext } from '../db/db-context.js';
import type { Documento } from '../domain/documento.js';
import { DocumentoError } from '../domain/documento.js';
import { ArquivoInvalidoError } from './arquivo.js';
import { EnvioNegadoError, type DocumentoRepository, type DocumentosUnitOfWork } from './documento.repository.js';
import {
  ChamadoInacessivelError, DecisaoConcorrenteError, DocumentoNaoEncontradoError, DocumentosService,
} from './documentos.service.js';
import type { StoragePort } from './storage.js';

const T = '11111111-1111-4111-8111-111111111111';
const U = '22222222-2222-4222-8222-222222222222';
const CH = '33333333-3333-4333-8333-333333333333';
const ctx: DbContext = { tenantId: T, userId: U, role: 'RECRUTADOR' };
const PDF = Buffer.from('%PDF-1.7\nconteudo');

function montar(opcoes: { visivel?: boolean; gravaDecisao?: boolean } = {}) {
  const docs = new Map<string, Documento>();
  const salvos: Buffer[] = [];
  const removidos: number[] = [];
  const repo: DocumentoRepository = {
    chamadoVisivel: async () => opcoes.visivel ?? true,
    inserir: async (d) => void docs.set(d.id, d),
    listarPorChamado: async () => [...docs.values()],
    obterPorId: async (id) => docs.get(id) ?? null,
    salvarDecisao: async () => opcoes.gravaDecisao ?? true,
  };
  const uow: DocumentosUnitOfWork = { executar: (_c, fn) => fn(repo) };
  const storage: StoragePort = {
    salvar: async (_t, c) => (salvos.push(c), `${T}/44444444-4444-4444-8444-444444444444`),
    ler: async () => PDF,
    remover: async () => void removidos.push(1),
  };
  return { service: new DocumentosService(uow, storage), salvos, removidos, repo };
}

describe('DocumentosService', () => {
  it('envia: grava no storage e devolve metadados sem a chave', async () => {
    const { service, salvos } = montar();
    const v = await service.enviar(ctx, CH, 'RG', PDF);
    expect(v).toMatchObject({ tipo: 'RG', status: 'PENDENTE', mime: 'application/pdf', chamadoId: CH });
    expect(JSON.stringify(v)).not.toContain('chaveStorage');
    expect(salvos).toHaveLength(1);
  });

  it('rejeita conteudo invalido antes de tocar no storage', async () => {
    const { service, salvos } = montar();
    await expect(service.enviar(ctx, CH, 'RG', Buffer.from('MZ\x90'))).rejects.toThrow(ArquivoInvalidoError);
    expect(salvos).toHaveLength(0);
  });

  it('chamado invisivel: nao grava arquivo nenhum', async () => {
    const { service, salvos } = montar({ visivel: false });
    await expect(service.enviar(ctx, CH, 'RG', PDF)).rejects.toThrow(ChamadoInacessivelError);
    await expect(service.listar(ctx, CH)).rejects.toThrow(ChamadoInacessivelError);
    expect(salvos).toHaveLength(0);
  });

  it('se o banco recusar o envio, remove o arquivo ja gravado', async () => {
    const { service, repo, removidos } = montar();
    repo.inserir = async () => { throw new EnvioNegadoError(); };
    await expect(service.enviar(ctx, CH, 'RG', PDF)).rejects.toThrow(EnvioNegadoError);
    expect(removidos).toHaveLength(1);
  });

  it('checklist mostra FALTANDO e o status do ultimo envio', async () => {
    const { service } = montar();
    await service.enviar(ctx, CH, 'RG', PDF);
    const { checklist } = await service.listar(ctx, CH);
    expect(checklist).toEqual([
      { tipo: 'RG', enviado: true, status: 'PENDENTE' },
      { tipo: 'CPF', enviado: false, status: 'FALTANDO' },
      { tipo: 'COMPROVANTE_RESIDENCIA', enviado: false, status: 'FALTANDO' },
    ]);
  });

  it('aprova e recusa; nao decide duas vezes', async () => {
    const { service } = montar();
    const a = await service.enviar(ctx, CH, 'RG', PDF);
    expect(await service.decidir(ctx, a.id, { status: 'APROVADO' })).toMatchObject({ status: 'APROVADO' });
    await expect(service.decidir(ctx, a.id, { status: 'APROVADO' })).rejects.toThrow(DocumentoError);
    const b = await service.enviar(ctx, CH, 'CPF', PDF);
    expect(await service.decidir(ctx, b.id, { status: 'RECUSADO', motivo: 'ilegivel' })).toMatchObject({
      status: 'RECUSADO', motivo: 'ilegivel',
    });
  });

  it('decisao concorrente e documento inexistente', async () => {
    const { service } = montar({ gravaDecisao: false });
    const a = await service.enviar(ctx, CH, 'RG', PDF);
    await expect(service.decidir(ctx, a.id, { status: 'APROVADO' })).rejects.toThrow(DecisaoConcorrenteError);
    await expect(service.decidir(ctx, U, { status: 'APROVADO' })).rejects.toThrow(DocumentoNaoEncontradoError);
    await expect(service.baixar(ctx, U)).rejects.toThrow(DocumentoNaoEncontradoError);
  });
});
