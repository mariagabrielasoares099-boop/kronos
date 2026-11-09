import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { DbContext } from '../db/db-context.js';
import { DbService, Tx } from '../db/db.service.js';
import { Chamado, EventoChamado } from '../domain/chamado.js';
import { formatProtocol } from '../domain/protocol.js';
import { FlowConfig, OPTIONAL_STATUSES, TicketStatus } from '../domain/ticket-status.js';
import { CandidatoJaExisteError, ChamadoRepository, NovoCandidato, UnitOfWork, type ChamadoLeitura } from './chamado.repository.js';

const STATUS_VALIDOS = new Set<string>(Object.values(TicketStatus));

/** Vaga guarda `fluxo = { enabled: [...] }`; o que nao for etapa opcional conhecida e ignorado. */
export function fluxoDaVaga(json: unknown): FlowConfig {
  const bruto = (json as { enabled?: unknown } | null)?.enabled;
  const enabled = Array.isArray(bruto)
    ? bruto.filter((s): s is TicketStatus => typeof s === 'string' && OPTIONAL_STATUSES.includes(s as TicketStatus))
    : [];
  return { enabled };
}

export class PrismaChamadoRepository implements ChamadoRepository {
  constructor(private readonly tx: Tx) {}

  async proximoProtocolo(ano: number): Promise<string> {
    const tenant = (await this.tx.$queryRaw<{ t: string }[]>`SELECT app_tenant()::text AS t`)[0]!.t;
    const rows = await this.tx.$queryRaw<{ ultimo: number }[]>`
      INSERT INTO protocol_counters (tenant_id, ano, ultimo) VALUES (${tenant}::uuid, ${ano}, 1)
      ON CONFLICT (tenant_id, ano) DO UPDATE SET ultimo = protocol_counters.ultimo + 1
      RETURNING ultimo`;
    return formatProtocol(ano, rows[0]!.ultimo);
  }

  async obterFluxoDaVaga(jobId: string): Promise<FlowConfig | null> {
    const job = await this.tx.job.findUnique({ where: { id: jobId }, select: { fluxo: true } });
    return job ? fluxoDaVaga(job.fluxo) : null;
  }

  async criarCandidato(c: NovoCandidato): Promise<void> {
    try {
      await this.tx.candidate.create({
        data: {
          id: c.id, tenantId: c.tenantId, cpf: c.cpf, nome: c.nome, email: c.email,
          telefone: c.telefone, consentimentoLgpd: c.consentimentoEm,
        },
        select: { id: true },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new CandidatoJaExisteError();
      throw e;
    }
  }

  async inserir(chamado: Chamado): Promise<void> {
    const s = chamado.snapshot();
    await this.tx.ticket.create({
      data: {
        id: s.id, tenantId: s.tenantId, protocolo: s.protocolo, jobId: s.jobId, candidateId: s.candidateId, status: s.status,
      },
      select: { id: true },
    });
    await this.gravarEventos(chamado);
  }

  async obterPorProtocolo(protocolo: string): Promise<ChamadoLeitura | null> {
    // O candidato pode ler seu chamado sem ter acesso a jobs. Nao exigir a
    // relacao obrigatoria com a vaga nesta consulta: o RLS pode ocultar a vaga.
    const t = await this.tx.ticket.findFirst({
      where: { protocolo },
      select: { id: true, protocolo: true, status: true, jobId: true, erpRef: true },
    });
    if (!t || !STATUS_VALIDOS.has(t.status)) return null;
    return { ...t, status: t.status as TicketStatus };
  }

  obterPorId(id: string): Promise<Chamado | null> {
    return this.carregar({ id });
  }

  async salvarTransicao(chamado: Chamado, statusAnterior: string): Promise<boolean> {
    // Otimista: so grava se o status ainda e o que foi lido.
    const r = await this.tx.ticket.updateMany({
      where: { id: chamado.id, status: statusAnterior },
      data: { status: chamado.status },
    });
    if (r.count === 0) return false;
    await this.gravarEventos(chamado);
    return true;
  }

  private async carregar(where: { id: string } | { protocolo: string }): Promise<Chamado | null> {
    const t = await this.tx.ticket.findFirst({
      where,
      select: {
        id: true, tenantId: true, protocolo: true, jobId: true, candidateId: true, status: true, erpRef: true,
        job: { select: { fluxo: true } },
      },
    });
    if (!t || !STATUS_VALIDOS.has(t.status)) return null;
    return Chamado.reconstituir({
      id: t.id, tenantId: t.tenantId, protocolo: t.protocolo, jobId: t.jobId, candidateId: t.candidateId,
      // O candidato ve o proprio chamado, mas nao a vaga (RLS): job vem null e o fluxo nao e usado, porque
      // so a equipe movimenta chamados e ela sempre ve a vaga (o chamado so e visivel a ela por causa dela).
      status: t.status as TicketStatus, fluxo: fluxoDaVaga(t.job?.fluxo), erpRef: t.erpRef,
    });
  }

  private async gravarEventos(chamado: Chamado): Promise<void> {
    const eventos: EventoChamado[] = chamado.coletarEventos();
    if (eventos.length === 0) return;
    await this.tx.ticketEvent.createMany({
      data: eventos.map((e) => ({
        tenantId: chamado.tenantId, ticketId: chamado.id, tipo: e.tipo, autor: e.autor,
        de: e.de, para: e.para, motivo: e.motivo, createdAt: e.em,
      })),
    });
  }
}

@Injectable()
export class PrismaUnitOfWork implements UnitOfWork {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  executar<T>(ctx: DbContext, fn: (repo: ChamadoRepository) => Promise<T>): Promise<T> {
    return this.db.run(ctx, (tx) => fn(new PrismaChamadoRepository(tx)));
  }
}
