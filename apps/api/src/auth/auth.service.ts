import type { Papel } from '../db/db-context.js';
import type { CredenciaisRepository, CredencialUsuario } from './credenciais.repository.js';
import { decifrar } from './segredo-box.js';
import { hashSenha, verificarSenha } from './senha.js';
import { assinarToken } from './token.js';
import { verificarTotp } from './totp.js';

/** Equipe de RH: o 2FA e obrigatorio (modulo 01). Os demais papeis usam 2FA se ele estiver configurado. */
const EXIGEM_2FA: ReadonlySet<Papel> = new Set(['ADMIN', 'RECRUTADOR', 'DP']);
export const TTL_SESSAO_S = 8 * 3600;

/** Mesma resposta para e-mail inexistente, senha errada e codigo errado (nao revela qual deu errado). */
export class CredenciaisInvalidasError extends Error {}
export class Codigo2faObrigatorioError extends Error {}
export class ContaBloqueadaError extends Error {}
export class Nao2faConfiguradoError extends Error {}

export interface SessaoEmitida {
  token: string;
  expiraEm: string;
  papel: Papel;
}

export class AuthService {
  private falso?: Promise<string>;

  constructor(
    private readonly repo: CredenciaisRepository,
    private readonly segredoJwt: string,
    private readonly chaveCripto: string,
  ) {}

  /** Hash descartavel: gasta o mesmo tempo quando o e-mail nao existe (anti enumeracao por tempo). */
  private hashFalso(): Promise<string> {
    return (this.falso ??= hashSenha(`falso:${Math.random()}`));
  }

  async login(email: string, senha: string, codigo?: string, agora = Date.now()): Promise<SessaoEmitida> {
    const contas = await this.repo.buscarPorEmail(email.trim().toLowerCase());
    if (contas.length === 0) {
      await verificarSenha(senha, await this.hashFalso());
      throw new CredenciaisInvalidasError();
    }

    const certas: CredencialUsuario[] = [];
    for (const c of contas) {
      if (await verificarSenha(senha, c.passwordHash)) certas.push(c);
      else await this.repo.registrarFalha(c.userId);
    }
    // Sem correspondencia unica (senha errada, ou a mesma senha em dois tenants): nao ha como escolher a conta.
    if (certas.length !== 1) throw new CredenciaisInvalidasError();
    const u = certas[0]!;

    if (u.bloqueadoAte && u.bloqueadoAte.getTime() > agora) throw new ContaBloqueadaError();

    if (EXIGEM_2FA.has(u.role) || u.totpSecret) {
      if (!u.totpSecret) throw new Nao2faConfiguradoError();
      if (!codigo) throw new Codigo2faObrigatorioError();
      const passo = verificarTotp(decifrar(u.totpSecret, this.chaveCripto), codigo, agora);
      const novo = passo !== null && (u.totpUltimoPasso === null || passo > u.totpUltimoPasso);
      if (passo === null || !novo || !(await this.repo.consumirPassoTotp(u.userId, passo))) {
        await this.repo.registrarFalha(u.userId);
        throw new CredenciaisInvalidasError();
      }
    }

    await this.repo.registrarSucesso(u.userId);
    const token = assinarToken({ tenantId: u.tenantId, userId: u.userId, role: u.role }, this.segredoJwt, TTL_SESSAO_S, agora);
    return { token, expiraEm: new Date(agora + TTL_SESSAO_S * 1000).toISOString(), papel: u.role };
  }
}
