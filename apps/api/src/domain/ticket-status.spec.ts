import { describe, expect, it } from 'vitest';
import { assertTransition, canTransition, nextStatus, TicketStatus } from './ticket-status.js';

const all = { enabled: ['TESTES', 'ENTREVISTA', 'ASSINATURA'] as TicketStatus[] };
const none = { enabled: [] as TicketStatus[] };

describe('ticket-status', () => {
  it('tem 10 status', () => expect(Object.keys(TicketStatus)).toHaveLength(10));
  it('avanca pelo fluxo completo', () => {
    expect(nextStatus('TRIAGEM', all)).toBe('TESTES');
    expect(nextStatus('VALIDACAO_DP', all)).toBe('ASSINATURA');
  });
  it('pula etapas desligadas na vaga', () => {
    expect(nextStatus('TRIAGEM', none)).toBe('APROVADO');
    expect(nextStatus('VALIDACAO_DP', none)).toBe('ENVIO_ERP');
  });
  it('permite os dois retornos', () => {
    expect(canTransition('VALIDACAO_DP', 'AGUARDANDO_CANDIDATO', all)).toBe(true);
    expect(canTransition('ENVIO_ERP', 'VALIDACAO_DP', all)).toBe(true);
  });
  it('nao pula etapas ativas nem volta fora dos retornos', () => {
    expect(canTransition('TRIAGEM', 'APROVADO', all)).toBe(false);
    expect(canTransition('ENTREVISTA', 'TRIAGEM', all)).toBe(false);
  });
  it('estados terminais nao saem', () => {
    expect(canTransition('ADMITIDO', 'TRIAGEM', all)).toBe(false);
    expect(canTransition('REPROVADO', 'TRIAGEM', all)).toBe(false);
  });
  it('nao reprova depois do envio ao ERP', () => {
    expect(canTransition('ENVIO_ERP', 'REPROVADO', all)).toBe(false);
    expect(canTransition('TRIAGEM', 'REPROVADO', all)).toBe(true);
  });
  it('exige motivo em retorno e reprovacao', () => {
    expect(() => assertTransition('VALIDACAO_DP', 'AGUARDANDO_CANDIDATO', all)).toThrow(/Motivo/);
    expect(() => assertTransition('TRIAGEM', 'REPROVADO', all, '  ')).toThrow(/Motivo/);
    expect(() => assertTransition('TRIAGEM', 'REPROVADO', all, 'perfil')).not.toThrow();
  });
});
