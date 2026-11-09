import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ContextoAusenteError,
  ContextoInvalidoError,
  currentContext,
  parseContext,
  runWithContext,
  toSettings,
} from './db-context.js';
import { aplicarContexto } from './db.service.js';

const tenantId = randomUUID();
const userId = randomUUID();

describe('parseContext', () => {
  it('aceita so tenant (sem acesso a nada alem do isolamento por tenant)', () => {
    expect(parseContext({ tenantId })).toEqual({ tenantId });
  });

  it('aceita equipe com usuario e papel, e candidato', () => {
    expect(parseContext({ tenantId, userId, role: 'DP' }).role).toBe('DP');
    expect(parseContext({ tenantId, candidateId: randomUUID() }).candidateId).toBeDefined();
  });

  it('rejeita usuario sem papel e papel sem usuario', () => {
    expect(() => parseContext({ tenantId, userId })).toThrow(ContextoInvalidoError);
    expect(() => parseContext({ tenantId, role: 'ADMIN' })).toThrow(ContextoInvalidoError);
  });

  it('rejeita papel desconhecido, id que nao e uuid e campos extras', () => {
    expect(() => parseContext({ tenantId, userId, role: 'ROOT' })).toThrow(ContextoInvalidoError);
    expect(() => parseContext({ tenantId: "x'; DROP TABLE tickets;--" })).toThrow(ContextoInvalidoError);
    expect(() => parseContext({ tenantId, bypass: true })).toThrow(ContextoInvalidoError);
    expect(() => parseContext({})).toThrow(ContextoInvalidoError);
  });

  it('a mensagem de erro nao repete os valores recebidos', () => {
    const segredo = 'valor-sensivel-123';
    try {
      parseContext({ tenantId: segredo });
    } catch (e) {
      expect((e as Error).message).not.toContain(segredo);
    }
  });
});

describe('toSettings', () => {
  it('sempre devolve os quatro parametros, ausentes como texto vazio', () => {
    expect(toSettings({ tenantId })).toEqual([
      ['app.tenant_id', tenantId],
      ['app.user_id', ''],
      ['app.user_role', ''],
      ['app.candidate_id', ''],
    ]);
  });
});

describe('aplicarContexto', () => {
  it('envia os valores como parametros e com is_local = true', async () => {
    const chamadas: { sql: string; valores: unknown[] }[] = [];
    const tx = {
      $executeRaw: async (q: TemplateStringsArray, ...valores: unknown[]) => {
        chamadas.push({ sql: q.join('?'), valores });
        return 1;
      },
    };
    await aplicarContexto(tx, { tenantId, userId, role: 'RECRUTADOR' });
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]!.sql.match(/, true\)/g)).toHaveLength(4);
    expect(chamadas[0]!.sql).not.toContain(tenantId); // valor nunca entra no texto do SQL
    expect(chamadas[0]!.valores).toContain(tenantId);
    expect(chamadas[0]!.valores).toContain('RECRUTADOR');
  });
});

describe('contexto da requisicao', () => {
  it('falha sem contexto', () => {
    expect(() => currentContext()).toThrow(ContextoAusenteError);
  });

  it('isola contextos concorrentes', async () => {
    const outro = randomUUID();
    const ler = (t: string, ms: number) =>
      runWithContext({ tenantId: t }, async () => {
        await new Promise((r) => setTimeout(r, ms));
        return currentContext().tenantId;
      });
    const [a, b] = await Promise.all([ler(tenantId, 20), ler(outro, 1)]);
    expect([a, b]).toEqual([tenantId, outro]);
    expect(() => currentContext()).toThrow(ContextoAusenteError);
  });

  it('runWithContext valida antes de executar', () => {
    expect(() => runWithContext({ tenantId: 'nao-e-uuid' }, () => 1)).toThrow(ContextoInvalidoError);
  });
});
