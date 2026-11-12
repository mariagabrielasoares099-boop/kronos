import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DOCUMENTOS_UOW, STORAGE } from './documento.repository.js';
import { DocumentosController } from './documentos.controller.js';
import { DocumentosService } from './documentos.service.js';
import { PrismaDocumentosUnitOfWork } from './prisma-documento.repository.js';
import { LocalDiskStorage } from './storage.js';

@Module({
  controllers: [DocumentosController],
  providers: [
    DocumentosService,
    { provide: DOCUMENTOS_UOW, useClass: PrismaDocumentosUnitOfWork },
    // Disco local (custo zero); trocar por Supabase Storage/MinIO so mexe nesta linha.
    {
      provide: STORAGE,
      inject: [ConfigService],
      useFactory: (c: ConfigService) => new LocalDiskStorage(c.get<string>('STORAGE_DIR') ?? './storage'),
    },
  ],
})
export class DocumentosModule {}
