import {
  BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Inject, NotFoundException, Param, Patch, Post,
  Res, StreamableFile, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { Ctx, Papeis } from '../auth/auth.decorators.js';
import { IdSchema } from '../chamados/chamados.schemas.js';
import { validar } from '../comum/validacao.js';
import type { DbContext } from '../db/db-context.js';
import { DocumentoError } from '../domain/documento.js';
import { ArquivoInvalidoError, TAMANHO_MAXIMO_BYTES } from './arquivo.js';
import { DecisaoSchema, EnvioSchema } from './documentos.schemas.js';
import {
  ChamadoNaoEncontradoError, DecisaoConcorrenteError, DocumentoNaoEncontradoError, DocumentosService, LimiteDocumentosError,
} from './documentos.service.js';

/** Campo do multipart que leva o arquivo. */
export const CAMPO_ARQUIVO = 'arquivo';

async function traduzir<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ChamadoNaoEncontradoError) throw new NotFoundException('Chamado nao encontrado');
    if (e instanceof DocumentoNaoEncontradoError) throw new NotFoundException('Documento nao encontrado');
    // Mensagens fixas do codigo (tipo/tamanho), sem nada do arquivo enviado.
    if (e instanceof ArquivoInvalidoError) throw new BadRequestException(e.message);
    if (e instanceof LimiteDocumentosError) throw new ConflictException('Limite de documentos deste chamado atingido');
    if (e instanceof DecisaoConcorrenteError) throw new ConflictException('O documento foi decidido por outra pessoa. Recarregue');
    if (e instanceof DocumentoError) throw new ConflictException(e.message);
    throw e;
  }
}

/**
 * Sem @Papeis no envio, na listagem e no download: o candidato (token sem papel) usa as mesmas rotas,
 * e o banco (RLS) decide o que cada um ve. Decidir e so do RH.
 */
@Controller()
export class DocumentosController {
  constructor(@Inject(DocumentosService) private readonly service: DocumentosService) {}

  @Post('chamados/:id/documentos')
  @HttpCode(201)
  @UseInterceptors(
    // Multer em memoria com limite: acima de TAMANHO_MAXIMO_BYTES o Nest responde 413 sem ler o resto.
    FileInterceptor(CAMPO_ARQUIVO, { limits: { fileSize: TAMANHO_MAXIMO_BYTES, files: 1, fields: 5, parts: 6 } }),
  )
  enviar(
    @Ctx() ctx: DbContext,
    @Param('id') id: string,
    @UploadedFile() arquivo: { buffer: Buffer } | undefined,
    @Body() body: unknown,
  ) {
    const chamadoId = validar(IdSchema, id);
    const { tipo } = validar(EnvioSchema, { ...(body as object) });
    if (!arquivo) throw new BadRequestException(`Envie o arquivo no campo "${CAMPO_ARQUIVO}"`);
    return traduzir(() => this.service.enviar(ctx, chamadoId, tipo, arquivo.buffer));
  }

  @Get('chamados/:id/documentos')
  listar(@Ctx() ctx: DbContext, @Param('id') id: string) {
    const chamadoId = validar(IdSchema, id);
    return traduzir(() => this.service.listar(ctx, chamadoId));
  }

  @Get('documentos/:id/arquivo')
  async baixar(@Ctx() ctx: DbContext, @Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const docId = validar(IdSchema, id);
    const a = await traduzir(() => this.service.baixar(ctx, docId));
    res.set({
      'Content-Type': a.mime,
      // attachment: o navegador baixa em vez de renderizar (PDF/imagem nunca roda na origem da API).
      'Content-Disposition': `attachment; filename="${a.nome}"`,
      'Cache-Control': 'private, no-store',
      // Ja vem do helmet no main.ts; repetido aqui para a rota nao depender da montagem da app.
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(a.conteudo);
  }

  @Patch('documentos/:id')
  @Papeis('RECRUTADOR', 'DP')
  decidir(@Ctx() ctx: DbContext, @Param('id') id: string, @Body() body: unknown) {
    const docId = validar(IdSchema, id);
    const dto = validar(DecisaoSchema, body);
    return traduzir(() => this.service.decidir(ctx, docId, dto));
  }
}
