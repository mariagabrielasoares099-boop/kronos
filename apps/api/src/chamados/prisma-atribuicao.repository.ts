import { Inject, Injectable } from '@nestjs/common';
import type { DbContext } from '../db/db-context.js';
import { DbService, Tx } from '../db/db.service.js';
import type {
  AtribuicaoRepository, AtribuicaoUnitOfWork, ChamadoParaAtribuir, UsuarioAtribuivel,
} from './atribuicao.repository.js';

export class PrismaAtribuicaoRepository implements AtribuicaoRepository {
  constructor(private readonly tx: Tx) {}

  async chamado(id: string): Promise<ChamadoParaAtribuir | null> {
    const t = await this.tx.ticket.findFirst({ where: { id }, select: { id: true, tenantId: true, jobId: true } });
    if (!t) return null;
    const vaga = await this.tx.job.findFirst({ where: { id: t.jobId }, select: { companyId: true } });
    return { id: t.id, tenantId: t.tenantId, companyId: vaga?.companyId ?? null };
  }

  async usuario(id: string): Promise<UsuarioAtribuivel | null> {
    return this.tx.user.findFirst({ where: { id }, select: { id: true, nome: true, role: true } });
  }

  async temVinculoComEmpresa(usuarioId: string, companyId: string): Promise<boolean> {
    // Mesma funcao que o trigger do banco usa; aqui so evita um erro 500 para o caso previsivel.
    const [r] = await this.tx.$queryRaw<{ ok: boolean }[]>`SELECT user_has_company(${usuarioId}::uuid, ${companyId}::uuid) AS ok`;
    return r?.ok === true;
  }

  async jaAtribuido(chamadoId: string, usuarioId: string): Promise<boolean> {
    const a = await this.tx.ticketAssignment.findFirst({
      where: { ticketId: chamadoId, userId: usuarioId }, select: { ticketId: true },
    });
    return a !== null;
  }

  async atribuir(c: ChamadoParaAtribuir, alvo: UsuarioAtribuivel, autorId: string): Promise<void> {
    await this.tx.ticketAssignment.create({ data: { tenantId: c.tenantId, ticketId: c.id, userId: alvo.id } });
    await this.tx.ticket.update({ where: { id: c.id }, data: { responsavel: alvo.id } });
    // Auditoria (append-only): quem atribuiu, a quem e quando. O nome vai junto porque a linha do tempo o exibe.
    await this.tx.ticketEvent.create({
      data: {
        tenantId: c.tenantId, ticketId: c.id, tipo: 'ATRIBUICAO', autor: autorId,
        payload: { usuarioId: alvo.id, usuarioNome: alvo.nome },
      },
    });
  }
}

@Injectable()
export class PrismaAtribuicaoUnitOfWork implements AtribuicaoUnitOfWork {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  executar<T>(ctx: DbContext, fn: (repo: AtribuicaoRepository) => Promise<T>): Promise<T> {
    return this.db.run(ctx, (tx) => fn(new PrismaAtribuicaoRepository(tx)));
  }
}
