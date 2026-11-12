import { z } from 'zod';
import { TipoDocumento } from '../domain/documento.js';

export const EnvioSchema = z.object({ tipo: z.enum(Object.values(TipoDocumento) as [TipoDocumento, ...TipoDocumento[]]) }).strict();

export const DecisaoSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('APROVADO') }).strict(),
  z.object({ status: z.literal('RECUSADO'), motivo: z.string().trim().min(3).max(500) }).strict(),
]);
export type DecisaoDto = z.infer<typeof DecisaoSchema>;

/** Checklist mockado do M1 (igual para toda vaga); por vaga fica para depois. */
export const CHECKLIST_PADRAO: readonly TipoDocumento[] = ['RG', 'CPF', 'COMPROVANTE_RESIDENCIA'];
