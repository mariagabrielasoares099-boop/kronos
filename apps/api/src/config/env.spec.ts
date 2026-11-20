import { describe, expect, it } from 'vitest';
import { parseEnv } from './env.js';

const ok = { DATABASE_URL: 'x', REDIS_URL: 'y', JWT_SECRET: 'a'.repeat(32), ENCRYPTION_KEY: 'b'.repeat(32) };

describe('env', () => {
  it('aplica defaults', () => expect(parseEnv(ok).PORT).toBe(3000));
  it('em producao exige SMTP_URL (o link de acesso do candidato vai por e-mail); fora dela e opcional', () => {
    expect(() => parseEnv({ ...ok, NODE_ENV: 'production' })).toThrow(/SMTP_URL/);
    expect(parseEnv({ ...ok, NODE_ENV: 'production', SMTP_URL: 'smtp://smtp.exemplo.com:587' }).SMTP_URL).toBeDefined();
    expect(parseEnv(ok).SMTP_URL).toBeUndefined();
    expect(parseEnv(ok).PORTAL_BASE_URL).toBe('http://localhost:8000');
  });
  it('rejeita PORTAL_BASE_URL que nao e URL', () => {
    expect(() => parseEnv({ ...ok, PORTAL_BASE_URL: 'nao-e-url' })).toThrow(/PORTAL_BASE_URL/);
  });
  it('falha com segredo curto sem vazar o valor', () => {
    const bad = { ...ok, JWT_SECRET: 'curto-segredo' };
    expect(() => parseEnv(bad)).toThrow(/JWT_SECRET/);
    expect(() => parseEnv(bad)).not.toThrow(/curto-segredo/);
  });
});
