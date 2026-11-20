import { BadRequestException } from '@nestjs/common';
import type { ZodType } from 'zod';

/** Valida a entrada e informa SO o campo e o problema, nunca o valor recebido (pode ser dado pessoal). */
export function validar<T>(schema: ZodType<T>, valor: unknown): T {
  const r = schema.safeParse(valor);
  if (r.success) return r.data;
  throw new BadRequestException({
    message: 'Requisicao invalida',
    erros: r.error.issues.map((i) => ({ campo: i.path.join('.') || '(raiz)', problema: i.message })),
  });
}
