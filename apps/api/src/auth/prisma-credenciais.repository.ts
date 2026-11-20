import { Inject, Injectable } from '@nestjs/common';
import { Papel } from '../db/db-context.js';
import { DbService } from '../db/db.service.js';
import type { CredenciaisRepository, CredencialUsuario } from './credenciais.repository.js';

interface Linha {
  user_id: string;
  tenant_id: string;
  role: string;
  password_hash: string;
  totp_secret: string | null;
  totp_ultimo_passo: bigint | null;
  bloqueado_ate: Date | null;
}

@Injectable()
export class PrismaCredenciaisRepository implements CredenciaisRepository {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  buscarPorEmail(email: string): Promise<CredencialUsuario[]> {
    return this.db.runSemContexto(async (tx) => {
      const rows = await tx.$queryRaw<Linha[]>`SELECT * FROM auth_credenciais(${email})`;
      return rows.flatMap((r) => {
        const role = Papel.safeParse(r.role);
        if (!role.success) return []; // o CHECK do banco impede; ignora em vez de abrir acesso
        return [{
          userId: r.user_id, tenantId: r.tenant_id, role: role.data, passwordHash: r.password_hash,
          totpSecret: r.totp_secret,
          totpUltimoPasso: r.totp_ultimo_passo === null ? null : Number(r.totp_ultimo_passo),
          bloqueadoAte: r.bloqueado_ate,
        }];
      });
    });
  }

  registrarFalha(userId: string): Promise<void> {
    return this.db.runSemContexto(async (tx) => {
      await tx.$executeRaw`SELECT auth_registrar_falha(${userId}::uuid)`;
    });
  }

  registrarSucesso(userId: string): Promise<void> {
    return this.db.runSemContexto(async (tx) => {
      await tx.$executeRaw`SELECT auth_registrar_sucesso(${userId}::uuid)`;
    });
  }

  consumirPassoTotp(userId: string, passo: number): Promise<boolean> {
    return this.db.runSemContexto(async (tx) => {
      const r = await tx.$queryRaw<{ ok: boolean }[]>`SELECT auth_consumir_passo_totp(${userId}::uuid, ${passo}::bigint) AS ok`;
      return r[0]?.ok === true;
    });
  }
}
