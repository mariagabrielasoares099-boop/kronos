import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { DbContext } from '../db/db-context.js';
import { Chamado } from '../domain/chamado.js';
import { Cpf } from '../domain/cpf.js';
import type { TicketStatus } from '../domain/ticket-status.js';
import { CandidatoJaExisteError, UNIT_OF_WORK, type UnitOfWork, type ChamadoLeitura } from './chamado.repository.js';
import type { CriarChamadoDto, TransicaoDto } from './chamados.schemas.js';

export class VagaNaoEncontradaError extends Error {}
export class ChamadoNaoEncontradoError extends Error {}
export class ConflitoConcorrenciaError extends Error {}
export { CandidatoJaExisteError };

/** O que a API devolve: sem dado pessoal do candidato (nome/CPF ficam nas telas autorizadas). */
export interface ChamadoView {
  id: string;
  protocolo: string;
  status: TicketStatus;
  jobId: string;
  erpRef: string | null;
}

const view = (c: ChamadoLeitura): ChamadoView => ({
  id: c.id, protocolo: c.protocolo, status: c.status, jobId: c.jobId, erpRef: c.erpRef,
});

@Injectable()
export class ChamadosService {
  constructor(@Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork) {}

  /** Equipe abre um chamado cadastrando o candidato (com consentimento LGPD). */
  async criar(ctx: DbContext, dto: CriarChamadoDto, agora: Date = new Date()): Promise<ChamadoView> {
    const candidatoId = randomUUID();
    // A equipe declara o candidato novo no contexto: sem isso o RETURNING do INSERT nao enxerga a linha.
    const comCandidato: DbContext = { ...ctx, candidateId: candidatoId };

    return this.uow.executar(comCandidato, async (repo) => {
      const fluxo = await repo.obterFluxoDaVaga(dto.jobId);
      if (!fluxo) throw new VagaNaoEncontradaError();

      const protocolo = await repo.proximoProtocolo(agora.getUTCFullYear());
      await repo.criarCandidato({
        id: candidatoId,
        tenantId: ctx.tenantId,
        cpf: Cpf.criar(dto.candidato.cpf).value,
        nome: dto.candidato.nome,
        email: dto.candidato.email,
        telefone: dto.candidato.telefone ?? null,
        consentimentoEm: agora,
      });
      const chamado = Chamado.abrir(
        { id: randomUUID(), tenantId: ctx.tenantId, protocolo, jobId: dto.jobId, candidateId: candidatoId, fluxo },
        ctx.userId ?? null,
        agora,
      );
      await repo.inserir(chamado);
      return view(chamado);
    });
  }

  /** Nao distingue "nao existe" de "sem permissao": o RLS simplesmente nao devolve a linha. */
  async obterPorProtocolo(ctx: DbContext, protocolo: string): Promise<ChamadoView> {
    return this.uow.executar(ctx, async (repo) => {
      const c = await repo.obterPorProtocolo(protocolo);
      if (!c) throw new ChamadoNaoEncontradoError();
      return view(c);
    });
  }

  async transicionar(ctx: DbContext, id: string, dto: TransicaoDto, agora: Date = new Date()): Promise<ChamadoView> {
    return this.uow.executar(ctx, async (repo) => {
      const c = await repo.obterPorId(id);
      if (!c) throw new ChamadoNaoEncontradoError();
      const anterior = c.status;
      const autor = ctx.userId ?? null;

      if (dto.acao === 'AVANCAR') c.avancar(autor, agora);
      else if (dto.acao === 'DEVOLVER') c.devolver(autor, dto.motivo, agora);
      else c.reprovar(autor, dto.motivo, agora);

      if (!(await repo.salvarTransicao(c, anterior))) throw new ConflitoConcorrenciaError();
      return view(c);
    });
  }
}
