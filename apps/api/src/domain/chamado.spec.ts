import { describe, expect, it } from 'vitest';
import { Admissao, AdmissaoInvalidaError } from './admissao.js';
import { Chamado } from './chamado.js';
import { Cpf, InvalidCpfError } from './cpf.js';
import { InvalidTransitionError, TicketStatus } from './ticket-status.js';

const completo = { enabled: ['TESTES', 'ENTREVISTA', 'ASSINATURA'] as TicketStatus[] };
const enxuto = { enabled: [] as TicketStatus[] };

const novo = (fluxo = completo) =>
  Chamado.abrir(
    { id: 'c1', tenantId: 't1', protocolo: 'ADM-2026-000001', jobId: 'j1', candidateId: 'k1', fluxo },
    'rh-1',
  );

const percorrerAte = (c: Chamado, alvo: TicketStatus) => {
  while (c.status !== alvo) c.avancar('rh-1');
};

describe('Chamado', () => {
  it('abre em TRIAGEM e registra o evento CRIADO', () => {
    const c = novo();
    expect(c.status).toBe('TRIAGEM');
    expect(c.coletarEventos()).toMatchObject([{ tipo: 'CRIADO', de: null, para: 'TRIAGEM' }]);
  });

  it('cada avanco gera um evento TRANSICAO com autor, de e para', () => {
    const c = novo();
    c.coletarEventos();
    c.avancar('rh-2');
    expect(c.coletarEventos()).toMatchObject([
      { tipo: 'TRANSICAO', autor: 'rh-2', de: 'TRIAGEM', para: 'TESTES' },
    ]);
  });

  it('coletarEventos esvazia a fila de eventos', () => {
    const c = novo();
    c.coletarEventos();
    expect(c.coletarEventos()).toEqual([]);
  });

  it('pula etapas desligadas na vaga', () => {
    const c = novo(enxuto);
    expect(c.avancar(null)).toBe('APROVADO');
  });

  it('percorre o fluxo inteiro ate ADMITIDO e encerra', () => {
    const c = novo();
    percorrerAte(c, 'ADMITIDO');
    expect(c.encerrado).toBe(true);
    expect(() => c.avancar(null)).toThrow();
  });

  it('devolve ao candidato com motivo (retorno 1)', () => {
    const c = novo();
    percorrerAte(c, 'VALIDACAO_DP');
    expect(c.devolver('dp-1', 'RG ilegivel')).toBe('AGUARDANDO_CANDIDATO');
    expect(c.coletarEventos().at(-1)).toMatchObject({ motivo: 'RG ilegivel', de: 'VALIDACAO_DP' });
  });

  it('devolve ao DP quando o ERP recusa (retorno 2)', () => {
    const c = novo();
    percorrerAte(c, 'ENVIO_ERP');
    expect(c.devolver(null, 'ERP rejeitou o arquivo')).toBe('VALIDACAO_DP');
  });

  it('retorno exige motivo', () => {
    const c = novo();
    percorrerAte(c, 'VALIDACAO_DP');
    expect(() => c.devolver('dp-1', '  ')).toThrow(/Motivo/);
    expect(c.status).toBe('VALIDACAO_DP');
  });

  it('nao tem retorno fora de VALIDACAO_DP e ENVIO_ERP', () => {
    expect(() => novo().devolver('rh', 'x')).toThrow(/nao tem retorno/);
  });

  it('reprova com motivo e nao reprova depois do envio ao ERP', () => {
    const a = novo();
    a.reprovar('rh', 'nota de corte');
    expect(a.status).toBe('REPROVADO');
    expect(a.encerrado).toBe(true);

    const b = novo();
    percorrerAte(b, 'ENVIO_ERP');
    expect(() => b.reprovar('rh', 'tarde')).toThrow(InvalidTransitionError);
  });

  it('transicao invalida nao altera status nem gera evento', () => {
    const c = novo();
    c.coletarEventos();
    expect(() => c.reprovar('rh', '')).toThrow(/Motivo/);
    expect(c.status).toBe('TRIAGEM');
    expect(c.coletarEventos()).toEqual([]);
  });

  it('erpRef e definido uma vez e e idempotente', () => {
    const c = novo();
    c.registrarErpRef('ERP-1');
    c.registrarErpRef('ERP-1');
    expect(c.erpRef).toBe('ERP-1');
    expect(() => c.registrarErpRef('ERP-2')).toThrow();
  });

  it('reconstituir nao gera evento', () => {
    const c = Chamado.reconstituir({ ...novo().snapshot(), status: 'APROVADO' });
    expect(c.coletarEventos()).toEqual([]);
    expect(c.status).toBe('APROVADO');
  });
});

describe('Cpf', () => {
  it('aceita CPF valido com ou sem mascara e guarda so digitos', () => {
    expect(Cpf.criar('529.982.247-25').value).toBe('52998224725');
  });
  it('rejeita invalido e sequencia repetida', () => {
    expect(() => Cpf.criar('111.111.111-11')).toThrow(InvalidCpfError);
    expect(() => Cpf.criar('123')).toThrow(InvalidCpfError);
  });
  it('mascara para log', () => {
    expect(Cpf.criar('52998224725').mascarado()).toBe('***.982.247-**');
  });
});

describe('Admissao', () => {
  const dados = {
    chamadoId: 'c1',
    nome: ' Maria Souza ',
    cpf: '529.982.247-25',
    nascimento: new Date('1995-03-10'),
    endereco: { logradouro: 'Rua A', numero: '10', bairro: 'Centro', cidade: 'Recife', uf: 'PE', cep: '50000-000' },
    cargo: 'Analista',
    salarioCentavos: 350000,
    dataAdmissao: new Date('2026-12-01'),
  };

  it('cria normalizando nome, CPF e CEP', () => {
    const a = Admissao.criar(dados, new Date('2026-11-07'));
    expect(a.nome).toBe('Maria Souza');
    expect(a.cpf.value).toBe('52998224725');
    expect(a.endereco.cep).toBe('50000000');
  });

  it('rejeita CPF invalido, salario nao inteiro e UF invalida', () => {
    const hoje = new Date('2026-11-07');
    expect(() => Admissao.criar({ ...dados, cpf: '111.111.111-11' }, hoje)).toThrow(InvalidCpfError);
    expect(() => Admissao.criar({ ...dados, salarioCentavos: 3500.5 }, hoje)).toThrow(AdmissaoInvalidaError);
    expect(() => Admissao.criar({ ...dados, endereco: { ...dados.endereco, uf: 'pe' } }, hoje)).toThrow(
      AdmissaoInvalidaError,
    );
  });

  it('rejeita nascimento no futuro', () => {
    expect(() => Admissao.criar({ ...dados, nascimento: new Date('2030-01-01') }, new Date('2026-11-07'))).toThrow(
      AdmissaoInvalidaError,
    );
  });

  it('rejeita datas invalidas antes de comparar nascimento e admissao', () => {
    const hoje = new Date('2026-11-07');
    expect(() => Admissao.criar({ ...dados, nascimento: new Date('invalida') }, hoje)).toThrow(AdmissaoInvalidaError);
    expect(() => Admissao.criar({ ...dados, dataAdmissao: new Date('invalida') }, hoje)).toThrow(AdmissaoInvalidaError);
    expect(() => Admissao.criar(dados, new Date('invalida'))).toThrow(AdmissaoInvalidaError);
  });

  it('rejeita salario que perde precisao em centavos', () => {
    expect(() => Admissao.criar({ ...dados, salarioCentavos: Number.MAX_SAFE_INTEGER + 1 })).toThrow(AdmissaoInvalidaError);
  });
});
