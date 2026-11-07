import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { DbContext } from '../db/db-context.js';
import { Chamado, EventoChamado } from '../domain/chamado.js';
import { formatProtocol } from '../domain/protocol.js';
import type { FlowConfig, TicketStatus } from '../domain/ticket-status.js';
import {
  CandidatoJaExisteError, ChamadoRepository, NovoCandidato, UnitOfWork,
} from './chamado.repository.js';
import {
  ChamadoNaoEncontradoError, ChamadosService, ConflitoConcorrenciaError, VagaNaoEncontradaError,
} from './chamados.service.js';

/** Repositorio em memoria: so para testar a regra do servico, sem banco. */
class MemoriaRepo implements ChamadoRepository {
  chamados = new Map<string, Chamado>();
  eventos: EventoChamado[] = [];
  cpfs = new Set<string>();
  contador = 0;
  conflitoNaProxima = false;
  constructor(private readonly vagas: Map<string, FlowConfig>) {}

  async proximoProtocolo(ano: number) { return formatProtocol(ano, ++this.contador); }
  async obterFluxoDaVaga(jobId: string) { return this.vagas.get(jobId) ?? null; }
  async criarCandidato(c: NovoCandidato) {
    if (this.cpfs.has(c.cpf)) throw new CandidatoJaExisteError();
    this.cpfs.add(c.cpf);
  }
  async inserir(c: Chamado) { this.chamados.set(c.id, c); this.eventos.push(...c.coletarEventos()); }
  async obterPorProtocolo(p: string) { return [...this.chamados.values()].find((c) => c.protocolo === p) ?? null; }
  async obterPorId(id: string) {
    const c = this.chamados.get(id);
    return c ? Chamado.reconstituir(c.snapshot()) : null;
  }
  async salvarTransicao(c: Chamado, _anterior: string) {
    if (this.conflitoNaProxima) return false;
    this.chamados.set(c.id, c);
    this.eventos.push(...c.coletarEventos());
    return true;
  }
}

const tenantId = randomUUID();
const equipe: DbContext = { tenantId, userId: randomUUID(), role: 'RECRUTADOR' };
const jobId = randomUUID();
const dto = {
  jobId,
  candidato: { nome: 'Maria Souza', email: 'maria@example.com', cpf: '529.982.247-25' },
  consentimentoLgpd: true as const,
};

function montar(fluxo: FlowConfig = { enabled: [] }) {
  const repo = new MemoriaRepo(new Map([[jobId, fluxo]]));
  const contextos: DbContext[] = [];
  const uow: UnitOfWork = {
    executar: (ctx, fn) => { contextos.push(ctx); return fn(repo); },
  };
  return { repo, contextos, service: new ChamadosService(uow) };
}

describe('ChamadosService.criar', () => {
  it('abre em TRIAGEM com protocolo do ano e evento CRIADO assinado por quem abriu', async () => {
    const { service, repo } = montar();
    const r = await service.criar(equipe, dto, new Date('2026-11-07T12:00:00Z'));
    expect(r).toMatchObject({ protocolo: 'ADM-2026-000001', status: 'TRIAGEM', jobId, erpRef: null });
    expect(repo.eventos).toMatchObject([{ tipo: 'CRIADO', autor: equipe.userId, para: 'TRIAGEM' }]);
  });

  it('declara o candidato novo no contexto (o RLS precisa para o RETURNING)', async () => {
    const { service, contextos } = montar();
    await service.criar(equipe, dto);
    expect(contextos[0]!.candidateId).toBeDefined();
    expect(contextos[0]).toMatchObject({ tenantId, userId: equipe.userId, role: 'RECRUTADOR' });
  });

  it('guarda o CPF so com digitos e nao devolve dado pessoal', async () => {
    const { service, repo } = montar();
    const r = await service.criar(equipe, dto);
    expect(repo.cpfs.has('52998224725')).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(/Maria|52998224725|maria@/);
  });

  it('protocolos sao sequenciais', async () => {
    const { service } = montar();
    const a = await service.criar(equipe, dto, new Date('2026-01-01'));
    const b = await service.criar(equipe, { ...dto, candidato: { ...dto.candidato, cpf: '111.444.777-35' } }, new Date('2026-01-01'));
    expect([a.protocolo, b.protocolo]).toEqual(['ADM-2026-000001', 'ADM-2026-000002']);
  });

  it('vaga inexistente ou invisivel', async () => {
    const { service } = montar();
    await expect(service.criar(equipe, { ...dto, jobId: randomUUID() })).rejects.toThrow(VagaNaoEncontradaError);
  });

  it('CPF repetido no tenant', async () => {
    const { service } = montar();
    await service.criar(equipe, dto);
    await expect(service.criar(equipe, dto)).rejects.toThrow(CandidatoJaExisteError);
  });
});

describe('ChamadosService.transicionar', () => {
  const abrir = async (fluxo?: FlowConfig) => {
    const m = montar(fluxo);
    const c = await m.service.criar(equipe, dto);
    return { ...m, id: c.id, protocolo: c.protocolo };
  };

  it('avanca pelo fluxo da vaga e registra o evento', async () => {
    const { service, repo, id } = await abrir({ enabled: ['TESTES'] });
    expect((await service.transicionar(equipe, id, { acao: 'AVANCAR' })).status).toBe('TESTES');
    expect(repo.eventos.at(-1)).toMatchObject({ tipo: 'TRANSICAO', de: 'TRIAGEM', para: 'TESTES', autor: equipe.userId });
  });

  it('pula etapas desligadas na vaga', async () => {
    const { service, id } = await abrir({ enabled: [] });
    expect((await service.transicionar(equipe, id, { acao: 'AVANCAR' })).status).toBe('APROVADO');
  });

  it('reprova com motivo e grava o motivo no evento', async () => {
    const { service, repo, id } = await abrir();
    const r = await service.transicionar(equipe, id, { acao: 'REPROVAR', motivo: 'nota de corte' });
    expect(r.status).toBe('REPROVADO');
    expect(repo.eventos.at(-1)?.motivo).toBe('nota de corte');
  });

  it('transicao invalida nao altera nada', async () => {
    const { service, repo, id, protocolo } = await abrir();
    const antes = repo.eventos.length;
    await expect(service.transicionar(equipe, id, { acao: 'DEVOLVER', motivo: 'sem retorno aqui' })).rejects.toThrow(/nao tem retorno/);
    expect(repo.eventos).toHaveLength(antes);
    expect((await service.obterPorProtocolo(equipe, protocolo)).status).toBe('TRIAGEM');
  });

  it('chamado inexistente ou invisivel', async () => {
    const { service } = await abrir();
    await expect(service.transicionar(equipe, randomUUID(), { acao: 'AVANCAR' })).rejects.toThrow(ChamadoNaoEncontradoError);
    await expect(service.obterPorProtocolo(equipe, 'ADM-2026-999999')).rejects.toThrow(ChamadoNaoEncontradoError);
  });

  it('detecta alteracao concorrente', async () => {
    const { service, repo, id } = await abrir();
    repo.conflitoNaProxima = true;
    await expect(service.transicionar(equipe, id, { acao: 'AVANCAR' })).rejects.toThrow(ConflitoConcorrenciaError);
  });

  it('percorre ate ADMITIDO e depois recusa avancar', async () => {
    const { service, id } = await abrir();
    let status: TicketStatus = 'TRIAGEM';
    while (status !== 'ADMITIDO') status = (await service.transicionar(equipe, id, { acao: 'AVANCAR' })).status;
    await expect(service.transicionar(equipe, id, { acao: 'AVANCAR' })).rejects.toThrow();
  });
});
