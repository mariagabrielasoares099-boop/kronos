import { Inject, Injectable } from '@nestjs/common';
import type { DbContext } from '../db/db-context.js';
import { ATRIBUICAO_UOW, PAPEIS_ATRIBUIVEIS, type AtribuicaoUnitOfWork } from './atribuicao.repository.js';
import { ChamadoNaoEncontradoError } from './chamados.service.js';

export class UsuarioNaoEncontradoError extends Error {}
/** Papel sem permissao de operar documentos ou sem vinculo com a empresa do chamado (mesma resposta, de proposito). */
export class UsuarioNaoAtribuivelError extends Error {}

export interface AtribuicaoView {
  chamadoId: string;
  usuarioId: string;
  usuarioNome: string;
  /** true quando a pessoa ja estava atribuida: nada foi gravado de novo. */
  jaAtribuido: boolean;
}

@Injectable()
export class AtribuicaoService {
  constructor(@Inject(ATRIBUICAO_UOW) private readonly uow: AtribuicaoUnitOfWork) {}

  /**
   * Atribui o chamado a `usuarioId` (ou a quem chama, se omitido). A rota so deixa RECRUTADOR/DP chegar aqui;
   * o RLS exige que o chamado seja visivel a quem atribui, e o banco recusa atribuido sem vinculo com a empresa.
   */
  async atribuir(ctx: DbContext, chamadoId: string, usuarioId?: string): Promise<AtribuicaoView> {
    const autorId = ctx.userId!; // rota restrita a equipe (@Papeis)
    const alvoId = usuarioId ?? autorId;
    return this.uow.executar(ctx, async (repo) => {
      const chamado = await repo.chamado(chamadoId);
      if (!chamado) throw new ChamadoNaoEncontradoError();
      const alvo = await repo.usuario(alvoId);
      if (!alvo) throw new UsuarioNaoEncontradoError();
      const papelOk = (PAPEIS_ATRIBUIVEIS as readonly string[]).includes(alvo.role);
      if (!papelOk || !chamado.companyId || !(await repo.temVinculoComEmpresa(alvo.id, chamado.companyId))) {
        throw new UsuarioNaoAtribuivelError();
      }
      const view = { chamadoId: chamado.id, usuarioId: alvo.id, usuarioNome: alvo.nome };
      if (await repo.jaAtribuido(chamado.id, alvo.id)) return { ...view, jaAtribuido: true };
      await repo.atribuir(chamado, alvo, autorId);
      return { ...view, jaAtribuido: false };
    });
  }
}
