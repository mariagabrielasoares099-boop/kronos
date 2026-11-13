import { BadRequestException, Body, Controller, HttpCode, Inject, Post, UnauthorizedException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { Public } from '../auth/auth.decorators.js';
import { ProtocoloSchema } from '../chamados/chamados.schemas.js';
import { EntradaInvalidaError, PortalService } from './portal.service.js';

export const PedidoLinkSchema = z.object({ protocolo: ProtocoloSchema, cpf: z.string().min(11).max(14) }).strict();
export const SessaoSchema = z.object({ codigo: z.string().min(1).max(100) }).strict();

/** So o campo e o problema; nunca o valor (CPF e codigo de acesso sao dados sensiveis). */
function invalida(issues: z.core.$ZodIssue[]): never {
  throw new BadRequestException({
    message: 'Requisicao invalida',
    erros: issues.map((i) => ({ campo: i.path.join('.') || '(raiz)', problema: i.message })),
  });
}

const MENSAGEM_LINK = 'Se os dados conferem, enviamos um link de acesso para o e-mail cadastrado. Ele vale por 15 minutos.';

@Controller('portal')
export class PortalController {
  constructor(@Inject(PortalService) private readonly service: PortalService) {}

  /**
   * Pede o link de acesso por e-mail. Responde 202 com a mesma mensagem em qualquer caso (nao revela se o protocolo
   * existe). Limite baixo por IP: cada pedido que acerta manda um e-mail para uma pessoa real.
   */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('link')
  @HttpCode(202)
  async pedirLink(@Body() body: unknown) {
    const r = PedidoLinkSchema.safeParse(body);
    if (!r.success) invalida(r.error.issues);
    await this.service.solicitarLink(r.data.protocolo, r.data.cpf);
    return { mensagem: MENSAGEM_LINK };
  }

  /** Troca o codigo do e-mail (uso unico) pelo token da sessao. */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('sessao')
  @HttpCode(200)
  async entrar(@Body() body: unknown) {
    const r = SessaoSchema.safeParse(body);
    if (!r.success) invalida(r.error.issues);
    try {
      return await this.service.entrar(r.data.codigo);
    } catch (e) {
      if (e instanceof EntradaInvalidaError) throw new UnauthorizedException('Link invalido ou expirado');
      throw e;
    }
  }
}
