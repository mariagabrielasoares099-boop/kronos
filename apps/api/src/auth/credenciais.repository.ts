import type { Papel } from '../db/db-context.js';

export interface CredencialUsuario {
  userId: string;
  tenantId: string;
  role: Papel;
  passwordHash: string;
  /** Cifrado em repouso (ver segredo-box.ts). */
  totpSecret: string | null;
  totpUltimoPasso: number | null;
  bloqueadoAte: Date | null;
}

/** Porta de acesso as credenciais. O adaptador usa as funcoes SECURITY DEFINER auth_* do banco. */
export interface CredenciaisRepository {
  buscarPorEmail(email: string): Promise<CredencialUsuario[]>;
  registrarFalha(userId: string): Promise<void>;
  registrarSucesso(userId: string): Promise<void>;
  /** false se o passo ja foi usado (reuso do codigo). */
  consumirPassoTotp(userId: string, passo: number): Promise<boolean>;
}
export const CREDENCIAIS_REPOSITORY = Symbol('CREDENCIAIS_REPOSITORY');
