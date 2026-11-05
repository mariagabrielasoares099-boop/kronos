const digits = (s: string) => s.replace(/\D/g, '');
const allEqual = (s: string) => /^(\d)\1+$/.test(s);

export function isValidCpf(input: string): boolean {
  const c = digits(input);
  if (c.length !== 11 || allEqual(c)) return false;
  for (const len of [9, 10]) {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(c[i]) * (len + 1 - i);
    const dv = ((sum * 10) % 11) % 10;
    if (dv !== Number(c[len])) return false;
  }
  return true;
}

export function isValidPis(input: string): boolean {
  const p = digits(input);
  if (p.length !== 11 || allEqual(p)) return false;
  const w = [3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const sum = w.reduce((a, wi, i) => a + wi * Number(p[i]), 0);
  const r = 11 - (sum % 11);
  return (r >= 10 ? 0 : r) === Number(p[10]);
}

/** Mascara o CPF para logs (LGPD): ***.456.789-** */
export function maskCpf(cpf: string): string {
  const c = digits(cpf);
  return c.length === 11 ? `***.${c.slice(3, 6)}.${c.slice(6, 9)}-**` : '***';
}
