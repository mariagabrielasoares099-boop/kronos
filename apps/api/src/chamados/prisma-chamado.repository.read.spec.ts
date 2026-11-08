import { describe, expect, it, vi } from 'vitest';
import type { Tx } from '../db/db.service.js';
import { PrismaChamadoRepository } from './prisma-chamado.repository.js';

describe('consulta de chamado pelo candidato', () => {
  const chamado = {
    id: '00000000-0000-0000-0000-000000000001',
    protocolo: 'ADM-2026-000001',
    status: 'TRIAGEM',
    jobId: '00000000-0000-0000-0000-000000000002',
    erpRef: null,
  };

  const repoCom = (registro: typeof chamado | null) => new PrismaChamadoRepository({
    ticket: { findFirst: async () => registro },
  } as unknown as Tx);

  it('devolve o chamado mesmo sem acesso aos dados da vaga', async () => {
    // Prisma rejeita uma relacao obrigatoria quando o RLS oculta a vaga.
    const findFirst = vi.fn(async (consulta: { select: Record<string, unknown> }) => {
      if ('job' in consulta.select) throw new Error('Vaga oculta pelo RLS');
      return chamado;
    });
    const repo = new PrismaChamadoRepository({ ticket: { findFirst } } as unknown as Tx);
    await expect(repo.obterPorProtocolo(chamado.protocolo)).resolves.toEqual(chamado);
    expect(findFirst).toHaveBeenCalledWith({
      where: { protocolo: chamado.protocolo },
      select: { id: true, protocolo: true, status: true, jobId: true, erpRef: true },
    });
  });

  it('nao devolve registro ocultado pelo RLS nem status desconhecido', async () => {
    await expect(repoCom(null).obterPorProtocolo(chamado.protocolo)).resolves.toBeNull();
    await expect(repoCom({ ...chamado, status: 'DESCONHECIDO' })
      .obterPorProtocolo(chamado.protocolo)).resolves.toBeNull();
  });
});
