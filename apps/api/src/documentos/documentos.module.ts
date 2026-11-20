import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { DOCUMENTOS_UOW } from './documento.repository.js';
import { DocumentosController } from './documentos.controller.js';
import { DocumentosService } from './documentos.service.js';
import { PrismaDocumentosUnitOfWork } from './prisma-documento.repository.js';
import { LocalDiskStorage, STORAGE } from './storage.js';

@Module({
  controllers: [DocumentosController],
  providers: [
    DocumentosService,
    { provide: DOCUMENTOS_UOW, useClass: PrismaDocumentosUnitOfWork },
    {
      provide: STORAGE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => new LocalDiskStorage(config.get('STORAGE_DIR', { infer: true })),
    },
  ],
})
export class DocumentosModule {}
