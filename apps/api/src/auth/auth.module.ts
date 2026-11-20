import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { CREDENCIAIS_REPOSITORY, type CredenciaisRepository } from './credenciais.repository.js';
import { PrismaCredenciaisRepository } from './prisma-credenciais.repository.js';

@Module({
  controllers: [AuthController],
  providers: [
    { provide: CREDENCIAIS_REPOSITORY, useClass: PrismaCredenciaisRepository },
    {
      provide: AuthService,
      inject: [CREDENCIAIS_REPOSITORY, ConfigService],
      useFactory: (repo: CredenciaisRepository, config: ConfigService<Env, true>) =>
        new AuthService(repo, config.get('JWT_SECRET', { infer: true }), config.get('ENCRYPTION_KEY', { infer: true })),
    },
  ],
})
export class AuthModule {}
