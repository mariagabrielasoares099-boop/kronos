import { z } from 'zod';
import { isValidCpf } from '../domain/br-docs.js';

export const CriarChamadoSchema = z
  .object({
    jobId: z.uuid(),
    candidato: z
      .object({
        nome: z.string().trim().min(3).max(120),
        email: z.email().max(320),
        cpf: z.string().refine(isValidCpf, 'CPF invalido'),
        telefone: z.string().trim().max(30).optional(),
      })
      .strict(),
    /** A equipe so cadastra o candidato com o consentimento dele (LGPD). */
    consentimentoLgpd: z.literal(true),
  })
  .strict();
export type CriarChamadoDto = z.infer<typeof CriarChamadoSchema>;

export const TransicaoSchema = z.discriminatedUnion('acao', [
  z.object({ acao: z.literal('AVANCAR') }).strict(),
  z.object({ acao: z.literal('DEVOLVER'), motivo: z.string().trim().min(3).max(500) }).strict(),
  z.object({ acao: z.literal('REPROVAR'), motivo: z.string().trim().min(3).max(500) }).strict(),
]);
export type TransicaoDto = z.infer<typeof TransicaoSchema>;

export const IdSchema = z.uuid();
export const ProtocoloSchema = z.string().regex(/^ADM-\d{4}-\d{6}$/);
