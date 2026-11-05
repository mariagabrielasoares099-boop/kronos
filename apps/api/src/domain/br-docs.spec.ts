import { describe, expect, it } from 'vitest';
import { isValidCpf, isValidPis, maskCpf } from './br-docs.js';

describe('br-docs', () => {
  it('CPF', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true);
    expect(isValidCpf('52998224726')).toBe(false);
    expect(isValidCpf('111.111.111-11')).toBe(false);
    expect(isValidCpf('123')).toBe(false);
  });
  it('PIS', () => {
    expect(isValidPis('12345678919')).toBe(true);
    expect(isValidPis('12345678910')).toBe(false);
    expect(isValidPis('11111111111')).toBe(false);
    expect(isValidPis('123')).toBe(false);
  });
  it('mascara de CPF', () => {
    expect(maskCpf('529.982.247-25')).toBe('***.982.247-**');
  });
});
