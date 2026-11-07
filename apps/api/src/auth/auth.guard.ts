import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Env } from '../config/env.js';
import type { DbContext, Papel } from '../db/db-context.js';
import { PUBLIC_KEY, ROLES_KEY } from './auth.decorators.js';
import { TokenInvalidoError, verificarToken } from './token.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(ConfigService) private readonly config: ConfigService<Env, true>,
  ) {}

  canActivate(ec: ExecutionContext): boolean {
    const alvos = [ec.getHandler(), ec.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, alvos)) return true;

    const req = ec.switchToHttp().getRequest<{ headers: Record<string, string | undefined>; dbContext?: DbContext }>();
    const m = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '');
    if (!m) throw new UnauthorizedException();
    let ctx: DbContext;
    try {
      ctx = verificarToken(m[1]!, this.config.get('JWT_SECRET', { infer: true }));
    } catch (e) {
      if (e instanceof TokenInvalidoError) throw new UnauthorizedException();
      throw e;
    }

    const papeis = this.reflector.getAllAndOverride<Papel[] | undefined>(ROLES_KEY, alvos);
    if (papeis && (!ctx.role || !papeis.includes(ctx.role))) throw new ForbiddenException();

    req.dbContext = ctx;
    return true;
  }
}
