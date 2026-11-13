import { Inject, Injectable } from '@nestjs/common';
import type { DbContext } from '../db/db-context.js';
import { CONSULTA_UOW, type ChamadoResumo, type EventoLeitura, type ConsultaUnitOfWork, type FiltroChamados } from './consulta.repository.js';
import { ChamadoNaoEncontradoError } from './chamados.service.js';

const iso = (d: Date | null) => (d ? d.toISOString() : null);

const resumoView = (c: ChamadoResumo) => ({
  id: c.id,
  protocolo: c.protocolo,
  status: c.status,
  vagaTitulo: c.vagaTitulo,
  candidatoNome: c.candidatoNome,
  responsavelNome: c.responsavelNome,
  prazoSla: iso(c.prazoSla),
  criadoEm: c.criadoEm.toISOString(),
});
export type ChamadoResumoView = ReturnType<typeof resumoView>;

const eventoView = (e: EventoLeitura) => ({
  tipo: e.tipo, de: e.de, para: e.para, motivo: e.motivo, autorNome: e.autorNome, em: e.em.toISOString(),
});
export type EventoView = ReturnType<typeof eventoView>;

/** Leitura da fila e do detalhe para a equipe. O RLS decide quais chamados cada pessoa enxerga. */
@Injectable()
export class ConsultaService {
  constructor(@Inject(CONSULTA_UOW) private readonly uow: ConsultaUnitOfWork) {}

  listar(ctx: DbContext, filtro: FiltroChamados): Promise<ChamadoResumoView[]> {
    return this.uow.executar(ctx, async (c) => (await c.listar(filtro)).map(resumoView));
  }

  /** Nao distingue "nao existe" de "sem permissao". */
  async resumo(ctx: DbContext, protocolo: string): Promise<ChamadoResumoView> {
    return this.uow.executar(ctx, async (c) => {
      const r = await c.resumoPorProtocolo(protocolo);
      if (!r) throw new ChamadoNaoEncontradoError();
      return resumoView(r);
    });
  }

  async eventos(ctx: DbContext, chamadoId: string): Promise<EventoView[]> {
    return this.uow.executar(ctx, async (c) => {
      const e = await c.listarEventos(chamadoId);
      if (!e) throw new ChamadoNaoEncontradoError();
      return e.map(eventoView);
    });
  }
}
