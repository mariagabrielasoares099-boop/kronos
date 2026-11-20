import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { assinarToken } from '../auth/token.js';
import type { Env } from '../config/env.js';
import { DbService } from '../db/db.service.js';
import { isValidCpf } from '../domain/br-docs.js';
import { EMAIL_PORT, type EmailPort } from './email.js';

export class EntradaInvalidaError extends Error {}

/** Acesso ao banco pelas funcoes SECURITY DEFINER (porta para facilitar o teste sem banco). */
export interface PortalRepository {
  /** Grava o hash do codigo e devolve para onde enviar; null = nada a enviar (nao achou, ambiguo ou muito cedo). */
  solicitarLink(protocolo: string, cpf: string, hash: string, expira: Date): Promise<{ email: string; nome: string } | null>;
  /** Consome o codigo uma unica vez; null = invalido, expirado ou ja usado. */
  consumirLink(hash: string): Promise<{ tenantId: string; candidateId: string } | null>;
}
export const PORTAL_REPOSITORY = Symbol('PORTAL_REPOSITORY');

@Injectable()
export class PrismaPortalRepository implements PortalRepository {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  async solicitarLink(protocolo: string, cpf: string, hash: string, expira: Date) {
    const rows = await this.db.runSemContexto((tx) =>
      tx.$queryRaw<{ email: string; nome: string }[]>`SELECT email, nome FROM auth_candidato_solicitar_link(${protocolo}, ${cpf}, ${hash}, ${expira})`,
    );
    return rows[0] ?? null;
  }

  async consumirLink(hash: string) {
    const rows = await this.db.runSemContexto((tx) =>
      tx.$queryRaw<{ tenant_id: string; candidate_id: string }[]>`SELECT tenant_id, candidate_id FROM auth_candidato_consumir_link(${hash})`,
    );
    const r = rows[0];
    return r ? { tenantId: r.tenant_id, candidateId: r.candidate_id } : null;
  }
}

/** O link vale pouco: so precisa durar o tempo de abrir o e-mail. */
export const TTL_LINK_S = 15 * 60;
/** O token da sessao dura pouco: o candidato so envia documentos e acompanha o chamado. */
export const TTL_TOKEN_CANDIDATO_S = 2 * 3600;
/** 32 bytes aleatorios em base64url = 43 caracteres. */
const FORMATO_CODIGO = /^[A-Za-z0-9_-]{43}$/;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

@Injectable()
export class PortalService {
  private readonly log = new Logger(PortalService.name);

  constructor(
    @Inject(PORTAL_REPOSITORY) private readonly repo: PortalRepository,
    @Inject(EMAIL_PORT) private readonly email: EmailPort,
    @Inject(ConfigService) private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Pede o link de acesso. NUNCA diz se deu certo: protocolo inexistente, CPF errado, candidato ja com link recente
   * e falha no envio terminam todos sem erro, para que ninguem use este metodo para descobrir quem e candidato.
   */
  async solicitarLink(protocolo: string, cpfInformado: string, agora = Date.now()): Promise<void> {
    const cpf = cpfInformado.replace(/\D/g, '');
    if (!isValidCpf(cpf)) return;
    const codigo = randomBytes(32).toString('base64url');
    const alvo = await this.repo.solicitarLink(protocolo, cpf, sha256(codigo), new Date(agora + TTL_LINK_S * 1000));
    if (!alvo) return;
    const base = this.config.get('PORTAL_BASE_URL', { infer: true }).replace(/\/$/, '');
    const link = `${base}/chamado/${protocolo}/acesso/${codigo}`;
    try {
      await this.email.enviar({
        para: alvo.email,
        assunto: `Acesso ao seu chamado ${protocolo}`,
        texto:
          `Ola, ${alvo.nome}.\n\nUse o link abaixo para acompanhar seu chamado e enviar documentos. ` +
          `Ele vale por 15 minutos e so pode ser usado uma vez.\n\n${link}\n\n` +
          'Se voce nao pediu este acesso, ignore esta mensagem.',
      });
    } catch (e) {
      // Nunca registra o link, o e-mail nem o CPF; so que falhou.
      this.log.error(`Falha ao enviar o link de acesso: ${e instanceof Error ? e.name : 'erro'}`);
    }
  }

  /** Troca o codigo do e-mail pelo token da sessao (so tenant e candidato, sem papel de equipe). */
  async entrar(codigo: string, agora = Date.now()): Promise<{ token: string; expiraEm: number }> {
    if (!FORMATO_CODIGO.test(codigo)) throw new EntradaInvalidaError();
    const achado = await this.repo.consumirLink(sha256(codigo));
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
