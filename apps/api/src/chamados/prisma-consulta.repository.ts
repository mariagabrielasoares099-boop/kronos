import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import type { DbContext } from '../db/db-context.js';
import { DbService, Tx } from '../db/db.service.js';
import { TicketStatus } from '../domain/ticket-status.js';
import type { ChamadoResumo, ConsultaChamados, ConsultaUnitOfWork, EventoLeitura, FiltroChamados } from './consulta.repository.js';

const STATUS_VALIDOS = new Set<string>(Object.values(TicketStatus));
const unicos = <T>(xs: (T | null | undefined)[]): T[] => [...new Set(xs.filter((x): x is T => x != null))];

interface TicketLinha {
  id: string;
  protocolo: string;
  status: string;
  jobId: string;
  candidateId: string;
  responsavel: string | null;
  prazoSla: Date | null;
  createdAt: Date;
}

const SELECAO = {
  id: true, protocolo: true, status: true, jobId: true, candidateId: true, responsavel: true, prazoSla: true, createdAt: true,
} as const;

export class PrismaConsultaChamados implements ConsultaChamados {
  constructor(private readonly tx: Tx) {}

  /**
   * Vaga, pessoa e responsavel em consultas separadas (nao em relacao obrigatoria do Prisma): o RLS pode ocultar
   * uma delas, e isso nao pode derrubar a linha inteira. Cada consulta ja passa pelo RLS do chamador.
   */
  private async resumir(linhas: TicketLinha[]): Promise<ChamadoResumo[]> {
    const [jobs, candidatos, usuarios] = await Promise.all([
      this.tx.job.findMany({ where: { id: { in: unicos(linhas.map((l) => l.jobId)) } }, select: { id: true, titulo: true } }),
      this.tx.candidate.findMany({ where: { id: { in: unicos(linhas.map((l) => l.candidateId)) } }, select: { id: true, nome: true } }),
      this.tx.user.findMany({ where: { id: { in: unicos(linhas.map((l) => l.responsavel)) } }, select: { id: true, nome: true } }),
    ]);
    const vaga = new Map(jobs.map((j) => [j.id, j.titulo]));
    const pessoa = new Map(candidatos.map((c) => [c.id, c.nome]));
    const resp = new Map(usuarios.map((u) => [u.id, u.nome]));
    return linhas
      .filter((l) => STATUS_VALIDOS.has(l.status))
      .map((l) => ({
        id: l.id,
        protocolo: l.protocolo,
        status: l.status as TicketStatus,
        vagaTitulo: vaga.get(l.jobId) ?? null,
        candidatoNome: pessoa.get(l.candidateId) ?? null,
        responsavelNome: l.responsavel ? (resp.get(l.responsavel) ?? null) : null,
        prazoSla: l.prazoSla,
        criadoEm: l.createdAt,
      }));
  }

  async listar(f: FiltroChamados): Promise<ChamadoResumo[]> {
    const busca = f.busca?.trim();
    const digitos = busca?.replace(/\D/g, '');
    const ou: Prisma.TicketWhereInput[] = busca
      ? [
          { protocolo: { contains: busca, mode: 'insensitive' } },
          { candidate: { is: { nome: { contains: busca, mode: 'insensitive' } } } },
          ...(digitos?.length === 11 ? [{ candidate: { is: { cpf: digitos } } }] : []),
        ]
      : [];
    const linhas = await this.tx.ticket.findMany({
      where: { ...(f.status ? { status: f.status } : {}), ...(ou.length ? { OR: ou } : {}) },
      select: SELECAO,
      // Mais urgentes primeiro: prazo mais proximo; sem prazo por ultimo; empate pelo mais novo.
      orderBy: [{ prazoSla: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: f.limite,
    });
    return this.resumir(linhas);
  }

  async resumoPorProtocolo(protocolo: string): Promise<ChamadoResumo | null> {
    const t = await this.tx.ticket.findFirst({ where: { protocolo }, select: SELECAO });
    return t ? ((await this.resumir([t]))[0] ?? null) : null;
  }

  async listarEventos(chamadoId: string): Promise<EventoLeitura[] | null> {
    const visivel = await this.tx.ticket.findFirst({ where: { id: chamadoId }, select: { id: true } });
    if (!visivel) return null;
    const eventos = await this.tx.ticketEvent.findMany({
      where: { ticketId: chamadoId },
      orderBy: { createdAt: 'asc' },
      select: { tipo: true, de: true, para: true, motivo: true, payload: true, autor: true, createdAt: true },
    });
    const autores = await this.tx.user.findMany({
      where: { id: { in: unicos(eventos.map((e) => e.autor)).filter((a) => /^[0-9a-f-]{36}$/i.test(a)) } },
      select: { id: true, nome: true },
    });
    const nome = new Map(autores.map((u) => [u.id, u.nome]));
    return eventos.map((e) => ({
      tipo: e.tipo, de: e.de, para: e.para, motivo: e.motivo, payload: e.payload, autorNome: e.autor ? (nome.get(e.autor) ?? null) : null, em: e.createdAt,
    }));
  }
}

@Injectable()
export class PrismaConsultaUnitOfWork implements ConsultaUnitOfWork {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  executar<T>(ctx: DbContext, fn: (consulta: ConsultaChamados) => Promise<T>): Promise<T> {
    return this.db.run(ctx, (tx) => fn(new PrismaConsultaChamados(tx)));
  }
}
