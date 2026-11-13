import { z } from 'zod';
import { isValidCpf } from '../domain/br-docs.js';
import { TicketStatus } from '../domain/ticket-status.js';

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

/** Filtros da fila do RH (querystring). Limite padrao 100, maximo 200. */
export const ListarChamadosSchema = z
  .object({
    status: z.enum(Object.values(TicketStatus) as [TicketStatus, ...TicketStatus[]]).optional(),
    busca: z.string().trim().max(60).optional(),
    limite: z.coerce.number().int().min(1).max(200).default(100),
  })
  .strict();
export type ListarChamadosDto = z.infer<typeof ListarChamadosSchema>;

export const IdSchema = z.uuid();

/** `usuarioId` omitido = a propria pessoa assume o chamado. */
export const AtribuicaoSchema = z.object({ usuarioId: z.uuid().optional() }).strict();
export const ProtocoloSchema = z.string().regex(/^ADM-\d{4}-\d{6}$/);
