import { Module } from '@nestjs/common';
import { UNIT_OF_WORK } from './chamado.repository.js';
import { ChamadosController } from './chamados.controller.js';
import { ChamadosService } from './chamados.service.js';
import { PrismaUnitOfWork } from './prisma-chamado.repository.js';

@Module({
  controllers: [ChamadosController],
  providers: [ChamadosService, { provide: UNIT_OF_WORK, useClass: PrismaUnitOfWork }],
})
export class ChamadosModule {}
