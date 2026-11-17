import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Documento, DocumentoError } from '../domain/documento.js';
import { ArquivoInvalidoError, detectarMime, validarArquivo } from './arquivo.js';
import { LocalDiskStorage } from './storage.js';

const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const PDF = Buffer.from('%PDF-1.7\n...');

describe('validarArquivo', () => {
  it('reconhece JPG, PNG e PDF pelo conteudo', () => {
    expect(detectarMime(JPG)).toBe('image/jpeg');
    expect(detectarMime(PNG)).toBe('image/png');
    expect(detectarMime(PDF)).toBe('application/pdf');
  });

  it('devolve mime, tamanho e sha256', () => {
    const v = validarArquivo(PDF);
    expect(v).toMatchObject({ mime: 'application/pdf', tamanhoBytes: PDF.length });
    expect(v.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejeita executavel e HTML mesmo que o nome diga .pdf', () => {
    expect(() => validarArquivo(Buffer.from('MZ\x90\x00'))).toThrow(ArquivoInvalidoError);
    expect(() => validarArquivo(Buffer.from('<html><script>'))).toThrow(ArquivoInvalidoError);
  });

  it('rejeita vazio e acima do limite', () => {
    expect(() => validarArquivo(Buffer.alloc(0))).toThrow(/vazio/);
    expect(() => validarArquivo(Buffer.concat([JPG, Buffer.alloc(10)]), 5)).toThrow(/tamanho/);
  });
});

describe('Documento', () => {
  const novo = () =>
    Documento.receber({
      id: 'd1', tenantId: 't1', chamadoId: 'c1', tipo: 'RG', chaveStorage: 'k',
      mime: 'image/jpeg', tamanhoBytes: 10, sha256: 'x', enviadoEm: new Date(),
    });

  it('nasce PENDENTE', () => expect(novo().status).toBe('PENDENTE'));

  it('aprova e registra o revisor', () => {
    const d = novo();
    d.aprovar('dp-1');
    expect(d.status).toBe('APROVADO');
    expect(d.snapshot().revisadoPor).toBe('dp-1');
  });

  it('recusa exige motivo', () => {
    const d = novo();
    expect(() => d.recusar('dp-1', '  ')).toThrow(DocumentoError);
    expect(d.status).toBe('PENDENTE');
    d.recusar('dp-1', 'ilegivel');
    expect(d.snapshot()).toMatchObject({ status: 'RECUSADO', motivo: 'ilegivel' });
  });

  it('nao decide duas vezes', () => {
    const d = novo();
    d.aprovar('dp-1');
    expect(() => d.recusar('dp-2', 'x')).toThrow(/ja foi decidido/);
  });
});

describe('LocalDiskStorage', () => {
  const dirs: string[] = [];
  const T = '00000000-0000-0000-0000-00000000000a';
  const criar = async () => {
    const d = await mkdtemp(join(tmpdir(), 'kronos-'));
    dirs.push(d);
    return new LocalDiskStorage(d);
  };
  afterAll(async () => {
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  });

  it('grava e le de volta', async () => {
    const s = await criar();
    const chave = await s.salvar(T, PDF);
    expect(chave.startsWith(`${T}/`)).toBe(true);
    expect((await s.ler(chave)).equals(PDF)).toBe(true);
  });

  it('remove o arquivo e nao falha se ele ja nao existe', async () => {
    const s = await criar();
    const chave = await s.salvar(T, PDF);
    await s.remover(chave);
    await expect(s.ler(chave)).rejects.toThrow();
    await expect(s.remover(chave)).resolves.toBeUndefined();
    await expect(s.remover('../../x')).rejects.toThrow(/invalida/);
  });

  it('bloqueia path traversal na leitura', async () => {
    const s = await criar();
    await expect(s.ler('../../etc/passwd')).rejects.toThrow(/invalida/);
    await expect(s.ler(`${T}/../../x`)).rejects.toThrow(/invalida/);
  });

  it('rejeita identificadores sem o formato UUID antes de acessar o disco', async () => {
    const s = await criar();
    const invalido = '-'.repeat(36);
    await expect(s.salvar(invalido, PDF)).rejects.toThrow(/invalida/);
    await expect(s.ler(`${T}/${invalido}`)).rejects.toThrow(/invalida/);
    await expect(s.ler(`${'a'.repeat(36)}/${T}`)).rejects.toThrow(/invalida/);
  });
});
