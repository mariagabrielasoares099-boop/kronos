import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/auth.decorators.js';
import { construirOpenApi } from './openapi.js';

/** Contrato da API em OpenAPI 3.1 (JSON). Aberto: descreve so a forma das rotas, nunca dados. */
@Controller()
export class DocsController {
  private readonly documento = construirOpenApi();

  @Public()
  @Get('openapi.json')
  openapi() {
    return this.documento;
  }
}
