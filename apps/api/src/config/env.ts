import { z } from 'zod';

/** Passo 1: toda configuracao/segredo vem do ambiente e e validada no boot (falha rapida). */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET precisa ter 32+ caracteres'),
  ENCRYPTION_KEY: z.string().min(32, 'ENCRYPTION_KEY precisa ter 32+ caracteres'),
  RATE_LIMIT_TTL_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
  /** Pasta dos arquivos enviados (disco local). Fora do repositorio e sem acesso publico. */
  STORAGE_DIR: z.string().min(1).default('./storage'),
});
export type Env = z.infer<typeof schema>;

export function parseEnv(raw: Record<string, unknown>): Env {
  const r = schema.safeParse(raw);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Configuracao invalida: ${msg}`); // nunca inclui os valores
  }
  return r.data;
}
