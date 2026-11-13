import {
  BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Inject, NotFoundException, Param, Post, Query,
} from '@nestjs/common';
import type { ZodType } from 'zod';
import { Ctx, Papeis } from '../auth/auth.decorators.js';
import type { DbContext } from '../db/db-context.js';
import { ChamadoError } from '../domain/chamado.js';
import { InvalidTransitionError } from '../domain/ticket-status.js';
import {
  CandidatoJaExisteError, ChamadoNaoEncontradoError, ChamadosService, ConflitoConcorrenciaError, VagaNaoEncontradaError,
} from './chamados.service.js';
import { CriarChamadoSchema, IdSchema, ListarChamadosSchema, ProtocoloSchema, TransicaoSchema } from './chamados.schemas.js';
import { ConsultaService } from './consulta.service.js';

/** Valida a entrada e informa SO o campo e o problema, nunca o valor recebido (pode ser dado pessoal). */
function validar<T>(schema: ZodType<T>, valor: unknown): T {
  const r = schema.safeParse(valor);
  if (r.success) return r.data;
  throw new BadRequestException({
    message: 'Requisicao invalida',
    erros: r.error.issues.map((i) => ({ campo: i.path.join('.') || '(raiz)', problema: i.message })),
  });
}

/** Traduz erros de dominio para HTTP; qualquer outro vira 500 sem detalhe. */
async function traduzir<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof VagaNaoEncontradaError) throw new NotFoundException('Vaga nao encontrada');
    if (e instanceof ChamadoNaoEncontradoError) throw new NotFoundException('Chamado nao encontrado');
    if (e instanceof CandidatoJaExisteError) throw new ConflictException('Ja existe candidato com este CPF');
    if (e instanceof ConflitoConcorrenciaError) throw new ConflictException('O chamado foi alterado por outra pessoa. Recarregue');
    if (e instanceof ChamadoError || e instanceof InvalidTransitionError) throw new ConflictException(e.message);
    throw e;
  }
}

@Controller('chamados')
export class ChamadosController {
  constructor(
    @Inject(ChamadosService) private readonly service: ChamadosService,
    @Inject(ConsultaService) private readonly consulta: ConsultaService,
  ) {}

  @Post()
  @HttpCode(201)
  @Papeis('RECRUTADOR', 'DP')
  criar(@Ctx() ctx: DbContext, @Body() body: unknown) {
    const dto = validar(CriarChamadoSchema, body);
    return traduzir(() => this.service.criar(ctx, dto));
  }

  /** Fila do RH: so a equipe (token de candidato nunca passa); o RLS filtra por empresa e atribuicao. */
  @Get()
  @Papeis('RECRUTADOR', 'DP', 'GESTOR_VAGA', 'AVALIADOR', 'ALMOXARIFADO')
  listar(@Ctx() ctx: DbContext, @Query() query: unknown) {
    return this.consulta.listar(ctx, validar(ListarChamadosSchema, query));
  }

  /** Detalhe para a equipe: nomes da vaga, da pessoa e do responsavel, e o prazo de SLA. */
  @Get(':protocolo/resumo')
  @Papeis('RECRUTADOR', 'DP', 'GESTOR_VAGA', 'AVALIADOR', 'ALMOXARIFADO')
  resumo(@Ctx() ctx: DbContext, @Param('protocolo') protocolo: string) {
    const p = validar(ProtocoloSchema, protocolo);
    return traduzir(() => this.consulta.resumo(ctx, p));
  }

  /** Linha do tempo (ticket_events, append-only). So equipe: contem motivos de devolucao/reprovacao. */
  @Get(':id/eventos')
  @Papeis('RECRUTADOR', 'DP', 'GESTOR_VAGA', 'AVALIADOR', 'ALMOXARIFADO')
  eventos(@Ctx() ctx: DbContext, @Param('id') id: string) {
    const chamadoId = validar(IdSchema, id);
    return traduzir(() => this.consulta.eventos(ctx, chamadoId));
  }

  /** Sem @Papeis: o RLS decide o que cada pessoa (inclusive o candidato) pode ver. */
  @Get(':protocolo')
  obter(@Ctx() ctx: DbContext, @Param('protocolo') protocolo: string) {
    const p = validar(ProtocoloSchema, protocolo);
    return traduzir(() => this.service.obterPorProtocolo(ctx, p));
  }

  @Post(':id/transicoes')
  @HttpCode(200)
  @Papeis('RECRUTADOR', 'DP')
  transicionar(@Ctx() ctx: DbContext, @Param('id') id: string, @Body() body: unknown) {
    const chamadoId = validar(IdSchema, id);
    const dto = validar(TransicaoSchema, body);
    return traduzir(() => this.service.transicionar(ctx, chamadoId, dto));
  }
}
