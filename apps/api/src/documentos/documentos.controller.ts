import {
  BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Inject, NotFoundException, Param, Patch, Post,
  PayloadTooLargeException, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import type { ZodType } from 'zod';
import { Ctx, Papeis } from '../auth/auth.decorators.js';
import { IdSchema } from '../chamados/chamados.schemas.js';
import type { DbContext } from '../db/db-context.js';
import { DocumentoError } from '../domain/documento.js';
import { ArquivoInvalidoError, TAMANHO_MAXIMO_BYTES } from './arquivo.js';
import { EnvioNegadoError } from './documento.repository.js';
import { DecisaoSchema, EnvioSchema } from './documentos.schemas.js';
import {
  ChamadoInacessivelError, DecisaoConcorrenteError, DocumentoNaoEncontradoError, DocumentosService,
} from './documentos.service.js';

function validar<T>(schema: ZodType<T>, valor: unknown): T {
  const r = schema.safeParse(valor);
  if (r.success) return r.data;
  throw new BadRequestException({
    message: 'Requisicao invalida',
    erros: r.error.issues.map((i) => ({ campo: i.path.join('.') || '(raiz)', problema: i.message })),
  });
}

async function traduzir<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ArquivoInvalidoError) {
      throw e.message.includes('tamanho') ? new PayloadTooLargeException(e.message) : new BadRequestException(e.message);
    }
    if (e instanceof ChamadoInacessivelError || e instanceof EnvioNegadoError) throw new NotFoundException('Chamado nao encontrado');
    if (e instanceof DocumentoNaoEncontradoError) throw new NotFoundException('Documento nao encontrado');
    if (e instanceof DecisaoConcorrenteError || e instanceof DocumentoError) throw new ConflictException(e.message);
    throw e;
  }
}

interface ArquivoEnviado { buffer: Buffer }

/** Em memoria, com teto do multer: arquivo maior que o limite e cortado (o Nest devolve 413). */
const upload = FileInterceptor('arquivo', { limits: { fileSize: TAMANHO_MAXIMO_BYTES, files: 1 } });

@Controller()
export class DocumentosController {
  constructor(@Inject(DocumentosService) private readonly service: DocumentosService) {}

  /** Sem @Papeis: candidato (dono do chamado) e equipe enviam; o RLS decide quem pode. O tipo do arquivo vem do conteudo. */
  @Post('chamados/:id/documentos')
  @HttpCode(201)
  @UseInterceptors(upload)
  enviar(@Ctx() ctx: DbContext, @Param('id') id: string, @Body() body: unknown, @UploadedFile() arquivo?: ArquivoEnviado) {
    const chamadoId = validar(IdSchema, id);
    const { tipo } = validar(EnvioSchema, body ?? {});
    if (!arquivo) throw new BadRequestException('Envie o arquivo no campo "arquivo"');
    return traduzir(() => this.service.enviar(ctx, chamadoId, tipo, arquivo.buffer));
  }

  @Get('chamados/:id/documentos')
  listar(@Ctx() ctx: DbContext, @Param('id') id: string) {
    return traduzir(() => this.service.listar(ctx, validar(IdSchema, id)));
  }

  /** Download autenticado (sem URL publica), sempre como anexo e com o tipo detectado no envio. */
  @Get('documentos/:id/arquivo')
  async baixar(@Ctx() ctx: DbContext, @Param('id') id: string, @Res() res: Response) {
    const { mime, conteudo } = await traduzir(() => this.service.baixar(ctx, validar(IdSchema, id)));
    res
      .set({
        'Content-Type': mime,
        'Content-Disposition': 'attachment; filename="documento"',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
      })
      .send(conteudo);
  }

  @Patch('documentos/:id')
  @Papeis('RECRUTADOR', 'DP')
  decidir(@Ctx() ctx: DbContext, @Param('id') id: string, @Body() body: unknown) {
    return traduzir(() => this.service.decidir(ctx, validar(IdSchema, id), validar(DecisaoSchema, body)));
  }
}
