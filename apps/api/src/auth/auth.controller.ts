import {
  BadRequestException, Body, Controller, ForbiddenException, HttpCode, HttpException, HttpStatus, Inject, Post,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { Public } from './auth.decorators.js';
import {
  AuthService, Codigo2faObrigatorioError, ContaBloqueadaError, CredenciaisInvalidasError, Nao2faConfiguradoError,
} from './auth.service.js';

export const LoginSchema = z
  .object({
    email: z.email().max(320),
    senha: z.string().min(1).max(200),
    codigo: z.string().regex(/^\d{6}$/).optional(),
  })
  .strict();

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly service: AuthService) {}

  /** Passo 3 (modulo 01): limite proprio e bem menor que o global, contra forca bruta. */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown) {
    const r = LoginSchema.safeParse(body);
    // So o campo e o problema; nunca o valor (e-mail e senha sao dados pessoais).
    if (!r.success) {
      throw new BadRequestException({
        message: 'Requisicao invalida',
        erros: r.error.issues.map((i) => ({ campo: i.path.join('.') || '(raiz)', problema: i.message })),
      });
    }
    try {
      return await this.service.login(r.data.email, r.data.senha, r.data.codigo);
    } catch (e) {
      if (e instanceof Codigo2faObrigatorioError) {
        throw new UnauthorizedException({ message: 'Informe o codigo de verificacao', codigo2fa: true });
      }
      if (e instanceof CredenciaisInvalidasError) throw new UnauthorizedException('Credenciais invalidas');
      if (e instanceof ContaBloqueadaError) {
        throw new HttpException('Muitas tentativas. Tente novamente em alguns minutos', HttpStatus.TOO_MANY_REQUESTS);
      }
      if (e instanceof Nao2faConfiguradoError) throw new ForbiddenException('Verificacao em duas etapas nao configurada');
      throw e;
    }
  }
}
