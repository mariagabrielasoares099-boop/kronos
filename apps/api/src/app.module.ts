import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthGuard } from './auth/auth.guard.js';
import { ChamadosModule } from './chamados/chamados.module.js';
import { parseEnv } from './config/env.js';
import { DbModule } from './db/db.module.js';
import { DocsController } from './docs/docs.controller.js';
import { DocumentosModule } from './documentos/documentos.module.js';
import { HealthController } from './health/health.controller.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: parseEnv }),
    DbModule,
    // Passo 3: rate limit global (trocar por storage Redis com multiplas instancias).
    ThrottlerModule.forRoot([
      {
        ttl: Number(process.env.RATE_LIMIT_TTL_MS ?? 60_000),
        limit: Number(process.env.RATE_LIMIT_MAX ?? 60),
      },
    ]),
    ChamadosModule,
    DocumentosModule,
  ],
  controllers: [HealthController, DocsController],
  providers: [
    // Ordem: rate limit primeiro, depois autenticacao. Rotas abertas usam @Public().
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
