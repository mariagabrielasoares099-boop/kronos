import { isValidCpf, maskCpf } from './br-docs.js';

export class InvalidCpfError extends Error {
  constructor() {
    super('CPF invalido');
  }
}

/** Value object: CPF valido, guardado so com digitos. */
export class Cpf {
  private constructor(readonly value: string) {}

  static criar(input: string): Cpf {
    if (!isValidCpf(input)) throw new InvalidCpfError();
    return new Cpf(input.replace(/\D/g, ''));
  }

  /** Para logs e eventos: nunca grave o CPF inteiro (LGPD). */
  mascarado(): string {
    return maskCpf(this.value);
  }

  equals(other: Cpf): boolean {
    return this.value === other.value;
  }
}
