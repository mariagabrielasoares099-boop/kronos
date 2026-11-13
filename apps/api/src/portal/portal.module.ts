import { Module } from '@nestjs/common';
import { PortalController } from './portal.controller.js';
import { PORTAL_REPOSITORY, PortalService, PrismaPortalRepository } from './portal.service.js';

@Module({
  controllers: [PortalController],
  providers: [PortalService, { provide: PORTAL_REPOSITORY, useClass: PrismaPortalRepository }],
})
export class PortalModule {}
