import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { assinarToken } from '../auth/token.js';
import type { Env } from '../config/env.js';
import { DbService } from '../db/db.service.js';
import { isValidCpf } from '../domain/br-docs.js';

export class EntradaInvalidaError extends Error {}

/** Quem a funcao auth_candidato encontrou (porta para facilitar o teste sem banco). */
export interface PortalRepository {
  buscar(protocolo: string, cpf: string): Promise<{ tenantId: string; candidateId: string } | null>;
}
export const PORTAL_REPOSITORY = Symbol('PORTAL_REPOSITORY');

@Injectable()
export class PrismaPortalRepository implements PortalRepository {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  async buscar(protocolo: string, cpf: string) {
    const rows = await this.db.runSemContexto((tx) =>
      tx.$queryRaw<{ tenant_id: string; candidate_id: string }[]>`SELECT tenant_id, candidate_id FROM auth_candidato(${protocolo}, ${cpf})`,
    );
    const r = rows[0];
    return r ? { tenantId: r.tenant_id, candidateId: r.candidate_id } : null;
  }
}

/** Token do candidato dura pouco: ele so precisa enviar documentos e acompanhar o chamado. */
export const TTL_TOKEN_CANDIDATO_S = 2 * 3600;

@Injectable()
export class PortalService {
  constructor(
    @Inject(PORTAL_REPOSITORY) private readonly repo: PortalRepository,
    @Inject(ConfigService) private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Protocolo + CPF -> token com SO tenant e candidato (sem papel de equipe). Todo motivo de falha
   * (CPF invalido, protocolo inexistente, CPF de outra pessoa) vira o mesmo erro, para nao permitir enumeracao.
   */
  async entrar(protocolo: string, cpfInformado: string, agora = Date.now()): Promise<{ token: string; expiraEm: number }> {
    const cpf = cpfInformado.replace(/\D/g, '');
    if (!isValidCpf(cpf)) throw new EntradaInvalidaError();
    const achado = await this.repo.buscar(protocolo, cpf);
    if (!achado) throw new EntradaInvalidaError();
    const token = assinarToken(
      { tenantId: achado.tenantId, candidateId: achado.candidateId },
      this.config.get('JWT_SECRET', { infer: true }),
      TTL_TOKEN_CANDIDATO_S,
      agora,
    );
    return { token, expiraEm: Math.floor(agora / 1000) + TTL_TOKEN_CANDIDATO_S };
  }
}
