import { z } from 'zod';
import { TipoDocumento } from '../domain/documento.js';

/** Campos de texto do multipart de envio (o arquivo vai no campo `arquivo`). */
export const EnvioSchema = z
  .object({ tipo: z.enum(Object.values(TipoDocumento) as [TipoDocumento, ...TipoDocumento[]]) })
  .strict();
export type EnvioDto = z.infer<typeof EnvioSchema>;

export const DecisaoSchema = z.discriminatedUnion('acao', [
  z.object({ acao: z.literal('APROVAR') }).strict(),
  z.object({ acao: z.literal('RECUSAR'), motivo: z.string().trim().min(3).max(500) }).strict(),
]);
export type DecisaoDto = z.infer<typeof DecisaoSchema>;
