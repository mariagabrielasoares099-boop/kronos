import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { EMAIL_PORT, LogEmailSender, SmtpEmailSender } from './email.js';
import { PortalController } from './portal.controller.js';
import { PORTAL_REPOSITORY, PortalService, PrismaPortalRepository } from './portal.service.js';

@Module({
  controllers: [PortalController],
  providers: [
    PortalService,
    { provide: PORTAL_REPOSITORY, useClass: PrismaPortalRepository },
    {
      provide: EMAIL_PORT,
      inject: [ConfigService],
      useFactory: (c: ConfigService<Env, true>) => {
        const smtp = c.get('SMTP_URL', { infer: true });
        return smtp ? new SmtpEmailSender(smtp, c.get('EMAIL_FROM', { infer: true })) : new LogEmailSender();
      },
    },
  ],
})
export class PortalModule {}
