import { BadRequestException, Body, Controller, HttpCode, Inject, Post, UnauthorizedException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { Public } from '../auth/auth.decorators.js';
import { ProtocoloSchema } from '../chamados/chamados.schemas.js';
import { EntradaInvalidaError, PortalService } from './portal.service.js';

export const EntradaSchema = z.object({ protocolo: ProtocoloSchema, cpf: z.string().min(11).max(14) }).strict();

@Controller('portal')
export class PortalController {
  constructor(@Inject(PortalService) private readonly service: PortalService) {}

  /** Limite proprio e baixo (por IP): protocolo + CPF e uma credencial fraca, entao o forca bruta precisa ser caro. */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('sessao')
  @HttpCode(200)
  async entrar(@Body() body: unknown) {
    const r = EntradaSchema.safeParse(body);
    // So o campo e o problema; nunca o valor (CPF e dado pessoal).
    if (!r.success) {
      throw new BadRequestException({
        message: 'Requisicao invalida',
        erros: r.error.issues.map((i) => ({ campo: i.path.join('.') || '(raiz)', problema: i.message })),
      });
    }
    try {
      return await this.service.entrar(r.data.protocolo, r.data.cpf);
    } catch (e) {
      if (e instanceof EntradaInvalidaError) throw new UnauthorizedException('Protocolo ou CPF invalido');
      throw e;
    }
  }
}
