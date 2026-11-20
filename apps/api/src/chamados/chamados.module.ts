import { Module } from '@nestjs/common';
import { UNIT_OF_WORK } from './chamado.repository.js';
import { CONSULTA_UOW } from './consulta.repository.js';
import { ATRIBUICAO_UOW } from './atribuicao.repository.js';
import { AtribuicaoService } from './atribuicao.service.js';
import { PrismaAtribuicaoUnitOfWork } from './prisma-atribuicao.repository.js';
import { ConsultaService } from './consulta.service.js';
import { PrismaConsultaUnitOfWork } from './prisma-consulta.repository.js';
import { ChamadosController } from './chamados.controller.js';
import { ChamadosService } from './chamados.service.js';
import { PrismaUnitOfWork } from './prisma-chamado.repository.js';

@Module({
  controllers: [ChamadosController],
  providers: [
    ChamadosService,
    ConsultaService,
    AtribuicaoService,
    { provide: UNIT_OF_WORK, useClass: PrismaUnitOfWork },
    { provide: CONSULTA_UOW, useClass: PrismaConsultaUnitOfWork },
    { provide: ATRIBUICAO_UOW, useClass: PrismaAtribuicaoUnitOfWork },
  ],
})
export class ChamadosModule {}
