import { describe, expect, it } from 'vitest';
import { parseEnv } from './env.js';

const ok = { DATABASE_URL: 'x', REDIS_URL: 'y', JWT_SECRET: 'a'.repeat(32), ENCRYPTION_KEY: 'b'.repeat(32) };

describe('env', () => {
  it('aplica defaults', () => expect(parseEnv(ok).PORT).toBe(3000));
  it('falha com segredo curto sem vazar o valor', () => {
    const bad = { ...ok, JWT_SECRET: 'curto-segredo' };
    expect(() => parseEnv(bad)).toThrow(/JWT_SECRET/);
    expect(() => parseEnv(bad)).not.toThrow(/curto-segredo/);
  });
});
