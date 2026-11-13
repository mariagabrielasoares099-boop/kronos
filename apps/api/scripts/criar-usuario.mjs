// Cria (ou atualiza a senha/2FA de) um usuario da equipe. Uso administrativo; precisa do build (npm run build).
//   MIGRATE_DATABASE_URL=... KRONOS_SENHA='...' ENCRYPTION_KEY=... \
//   node scripts/criar-usuario.mjs <tenantId> <email> <nome> <PAPEL>
// A senha vem do ambiente (nao do argv) para nao ficar no historico do shell. Imprime o URI do 2FA UMA vez.
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { hashSenha } from '../dist/auth/senha.js';
import { cifrar } from '../dist/auth/segredo-box.js';
import { novoSegredoTotp, uriTotp } from '../dist/auth/totp.js';

const [tenantId, email, nome, papel] = process.argv.slice(2);
const { MIGRATE_DATABASE_URL: url, KRONOS_SENHA: senha, ENCRYPTION_KEY: chave } = process.env;
if (!tenantId || !email || !nome || !papel || !url || !senha || !chave) {
  console.error('Uso: MIGRATE_DATABASE_URL, KRONOS_SENHA e ENCRYPTION_KEY no ambiente; args: <tenantId> <email> <nome> <PAPEL>');
  process.exit(2);
}
if (senha.length < 12) { console.error('A senha precisa ter 12+ caracteres.'); process.exit(2); }
if (chave.length < 32) { console.error('ENCRYPTION_KEY precisa ter 32+ caracteres.'); process.exit(2); }

const segredo = novoSegredoTotp();
const c = new pg.Client({ connectionString: url });
await c.connect();
try {
  await c.query(
    `INSERT INTO users (id, tenant_id, nome, email, role, password_hash, totp_secret)
     VALUES ($1,$2,$3,lower($4),$5,$6,$7)
     ON CONFLICT (tenant_id, email) DO UPDATE
       SET password_hash = EXCLUDED.password_hash, totp_secret = EXCLUDED.totp_secret,
           totp_ultimo_passo = NULL, falhas_login = 0, bloqueado_ate = NULL`,
    [randomUUID(), tenantId, nome, email, papel, await hashSenha(senha), cifrar(segredo, chave)],
  );
  console.log('Usuario salvo. Cadastre no aplicativo autenticador (mostrado so agora):');
  console.log(uriTotp(segredo, email));
  console.log('Chave manual:', segredo);
} finally {
  await c.end();
}
