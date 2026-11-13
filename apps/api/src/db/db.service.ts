import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import type { Env } from '../config/env.js';
import { currentContext, DbContext, parseContext, toSettings } from './db-context.js';

/** O que `aplicarContexto` precisa de uma transacao (facilita o teste unitario). */
export interface TxLike {
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
}

export type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

/**
 * set_config(..., is_local = true): vale so ate o fim desta transacao e some no COMMIT/ROLLBACK,
 * entao o contexto nunca vaza para outra requisicao que reutilize a conexao do pool.
 * Valores vao como parametros (nunca concatenados no SQL).
 */
export async function aplicarContexto(tx: TxLike, ctx: DbContext): Promise<void> {
  const [t, u, r, c] = toSettings(ctx);
  await tx.$executeRaw`SELECT set_config(${t![0]}, ${t![1]}, true), set_config(${u![0]}, ${u![1]}, true), set_config(${r![0]}, ${r![1]}, true), set_config(${c![0]}, ${c![1]}, true)`;
}

/**
 * Cada transacao segura uma conexao do pool (padrao do pg: 10). Quando ha mais transacoes que conexoes,
 * as demais esperam ate maxWait; sem folga, picos curtos viram erro. timeout encerra transacao travada.
 */
export const OPCOES_TRANSACAO = { maxWait: 10_000, timeout: 15_000 } as const;

export class RlsDesativadoError extends Error {}

@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(DbService.name);
  /** Acesso direto so para o que nao toca dados de negocio (ex.: health). Dados passam por run(). */
  private readonly client: PrismaClient;

  constructor(config: ConfigService<Env, true>) {
    const adapter = new PrismaPg({ connectionString: config.get('DATABASE_URL', { infer: true }) });
    this.client = new PrismaClient({ adapter });
  }

  async onModuleInit(): Promise<void> {
    await this.assertRlsAtivo();
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }

  /**
   * Falha o boot se a conexao for de superusuario/BYPASSRLS ou dona das tabelas: nesses casos o
   * banco ignora todas as politicas e o isolamento some sem nenhum erro.
   */
  async assertRlsAtivo(): Promise<void> {
    const rows = await this.client.$queryRaw<{ papel: string; ignora: boolean }[]>`
      SELECT current_user::text AS papel,
             (r.rolsuper OR r.rolbypassrls
              OR EXISTS (SELECT 1 FROM pg_tables t WHERE t.schemaname = 'public' AND t.tablename = 'tickets' AND t.tableowner = current_user)) AS ignora
      FROM pg_roles r WHERE r.rolname = current_user`;
    const row = rows[0];
    if (!row || row.ignora) {
      throw new RlsDesativadoError(
        `A conexao usa o papel "${row?.papel ?? '?'}", que ignora o RLS. Use um papel membro de kronos_app (ver docs/DADOS.md).`,
      );
    }
    this.log.log(`RLS ativo para o papel "${row.papel}"`);
  }

  /**
   * Transacao SEM contexto de tenant. Uso exclusivo da autenticacao (funcoes auth_*, SECURITY DEFINER):
   * ainda nao se sabe quem e o usuario. Consulta a tabela de negocio aqui retorna zero linhas (RLS).
   */
  runSemContexto<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.client.$transaction(fn, OPCOES_TRANSACAO);
  }

  /** Executa `fn` numa transacao com o contexto de acesso informado. */
  async run<T>(ctx: unknown, fn: (tx: Tx) => Promise<T>): Promise<T> {
    const validado = parseContext(ctx);
    return this.client.$transaction(
      async (tx) => {
        await aplicarContexto(tx, validado);
        return fn(tx);
      },
      OPCOES_TRANSACAO,
    );
  }

  /** Igual a run(), usando o contexto definido por runWithContext() para a requisicao atual. */
  runNoContextoAtual<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.run(currentContext(), fn);
  }
}
