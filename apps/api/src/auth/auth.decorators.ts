import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { DbContext, Papel } from '../db/db-context.js';

export const PUBLIC_KEY = 'kronos:public';
export const ROLES_KEY = 'kronos:papeis';

/** Rota sem autenticacao (ex.: health). */
export const Public = () => SetMetadata(PUBLIC_KEY, true);
/** Rota restrita a estes papeis da equipe (token de candidato nunca passa). */
export const Papeis = (...papeis: Papel[]) => SetMetadata(ROLES_KEY, papeis);

/** Contexto de acesso do chamador, definido pelo AuthGuard a partir do token verificado. */
export const Ctx = createParamDecorator((_data: unknown, ec: ExecutionContext): DbContext => {
  return ec.switchToHttp().getRequest<{ dbContext: DbContext }>().dbContext;
});
