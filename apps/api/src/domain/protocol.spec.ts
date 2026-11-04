import { describe, expect, it } from 'vitest';
import { formatProtocol, PROTOCOL_RE } from './protocol.js';

describe('protocol', () => {
  it('formata', () => {
    expect(formatProtocol(2026, 123)).toBe('ADM-2026-000123');
    expect(PROTOCOL_RE.test('ADM-2026-000123')).toBe(true);
  });
  it('rejeita sequencia invalida', () => {
    expect(() => formatProtocol(2026, 0)).toThrow();
    expect(() => formatProtocol(2026, 1_000_000)).toThrow();
  });
});
