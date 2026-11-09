import { AsyncLocalStorage } from 'node:async_hooks';
import { z } from 'zod';

/**
 * Contexto que o RLS do banco usa para decidir o que cada transacao enxerga
 * (ver docs/DADOS.md, "Acesso por empresa e por pessoa autorizada").
 * Vem SEMPRE de quem foi autenticado no servidor, nunca de campos enviados pelo cliente.
 */
export const Papel = z.enum(['ADMIN', 'RECRUTADOR', 'DP', 'GESTOR_VAGA', 'AVALIADOR', 'ALMOXARIFADO']);
export type Papel = z.infer<typeof Papel>;

const schema = z
  .object({
    tenantId: z.uuid(),
    /** Equipe da empresa: usuario e papel andam juntos. */
    userId: z.uuid().optional(),
    role: Papel.optional(),
    /** Portal do candidato; a equipe tambem declara ao CRIAR um candidato (o RETURNING precisa enxergar a linha). */
    candidateId: z.uuid().optional(),
  })
  .strict()
  .refine((c) => (c.userId === undefined) === (c.role === undefined), {
    message: 'userId e role devem ser informados juntos',
  });

export type DbContext = z.infer<typeof schema>;

export class ContextoInvalidoError extends Error {}
export class ContextoAusenteError extends Error {
  constructor() {
    super('Nenhum contexto de acesso definido para esta operacao');
  }
}

export function parseContext(input: unknown): DbContext {
  const r = schema.safeParse(input);
  if (!r.success) {
    // Nao inclui os valores recebidos: podem ser identificadores de pessoas.
    throw new ContextoInvalidoError(
      `Contexto invalido: ${r.error.issues.map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`).join('; ')}`,
    );
  }
  return r.data;
}

/** Os quatro parametros de sessao lidos pelas funcoes app_*() do banco. Ausente vira texto vazio (= sem acesso). */
export function toSettings(ctx: DbContext): ReadonlyArray<readonly [string, string]> {
  return [
    ['app.tenant_id', ctx.tenantId],
    ['app.user_id', ctx.userId ?? ''],
    ['app.user_role', ctx.role ?? ''],
    ['app.candidate_id', ctx.candidateId ?? ''],
  ];
}

const store = new AsyncLocalStorage<DbContext>();

/** Define o contexto para tudo que roda dentro de `fn` (middleware/guard de autenticacao chama isto). */
export function runWithContext<T>(ctx: unknown, fn: () => T): T {
  return store.run(parseContext(ctx), fn);
}

export function currentContext(): DbContext {
  const c = store.getStore();
  if (!c) throw new ContextoAusenteError();
  return c;
}
