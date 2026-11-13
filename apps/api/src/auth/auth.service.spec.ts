import { describe, expect, it } from 'vitest';
import {
  AuthService, Codigo2faObrigatorioError, ContaBloqueadaError, CredenciaisInvalidasError, Nao2faConfiguradoError,
} from './auth.service.js';
import type { CredenciaisRepository, CredencialUsuario } from './credenciais.repository.js';
import { cifrar, decifrar } from './segredo-box.js';
import { hashSenha, verificarSenha } from './senha.js';
import { verificarToken } from './token.js';
import { base32Decode, base32Encode, codigoTotp, novoSegredoTotp, passoDe, verificarTotp } from './totp.js';

const JWT = 'j'.repeat(40);
const CHAVE = 'k'.repeat(40);
const T = '0198a000-0000-7000-8000-000000000001';
const U = '0198a000-0000-7000-8000-000000000002';
const AGORA = Date.UTC(2026, 10, 13, 12, 0, 0);

describe('senha (scrypt)', () => {
  it('aceita a senha certa e recusa a errada', async () => {
    const h = await hashSenha('Senha forte 123');
    expect(await verificarSenha('Senha forte 123', h)).toBe(true);
    expect(await verificarSenha('senha forte 123', h)).toBe(false);
  });
  it('recusa formato invalido ou custo diferente sem lancar', async () => {
    expect(await verificarSenha('x', 'lixo')).toBe(false);
    expect(await verificarSenha('x', 'scrypt$1$8$1$AAAA$AAAA')).toBe(false);
  });
});

describe('TOTP (RFC 6238)', () => {
  const ref = base32Encode(Buffer.from('12345678901234567890'));
  it('bate com o vetor de teste da RFC (t=59 -> 287082)', () => {
    expect(codigoTotp(ref, Math.floor(59 / 30))).toBe('287082');
  });
  it('base32 e reversivel', () => {
    const s = novoSegredoTotp();
    expect(base32Encode(base32Decode(s))).toBe(s);
  });
  it('tolera 1 passo de relogio e recusa mais que isso ou formato errado', () => {
    const s = novoSegredoTotp();
    const p = passoDe(AGORA);
    expect(verificarTotp(s, codigoTotp(s, p), AGORA)).toBe(p);
    expect(verificarTotp(s, codigoTotp(s, p - 1), AGORA)).toBe(p - 1);
    expect(verificarTotp(s, codigoTotp(s, p + 2), AGORA)).toBeNull();
    expect(verificarTotp(s, '12345', AGORA)).toBeNull();
    expect(verificarTotp(s, 'abcdef', AGORA)).toBeNull();
  });
});

describe('segredo-box (AES-256-GCM)', () => {
  it('cifra e decifra; chave errada ou adulteracao falham', () => {
    const c = cifrar('JBSWY3DPEHPK3PXP', CHAVE);
    expect(c).not.toContain('JBSWY3DPEHPK3PXP');
    expect(decifrar(c, CHAVE)).toBe('JBSWY3DPEHPK3PXP');
    expect(() => decifrar(c, 'x'.repeat(40))).toThrow();
    expect(() => decifrar(c.slice(0, -2) + 'AA', CHAVE)).toThrow();
  });
});

class FakeRepo implements CredenciaisRepository {
  falhas: string[] = [];
  sucessos: string[] = [];
  passos: number[] = [];
  constructor(public contas: CredencialUsuario[]) {}
  async buscarPorEmail() { return this.contas; }
  async registrarFalha(id: string) { this.falhas.push(id); }
  async registrarSucesso(id: string) { this.sucessos.push(id); }
  async consumirPassoTotp(_id: string, passo: number) {
    if (this.passos.includes(passo)) return false;
    this.passos.push(passo);
    return true;
  }
}

describe('AuthService.login', () => {
  const segredo = novoSegredoTotp();
  let hash: string;
  const conta = (extra: Partial<CredencialUsuario> = {}): CredencialUsuario => ({
    userId: U, tenantId: T, role: 'RECRUTADOR', passwordHash: hash, totpSecret: cifrar(segredo, CHAVE),
    totpUltimoPasso: null, bloqueadoAte: null, ...extra,
  });
  const svc = (repo: FakeRepo) => new AuthService(repo, JWT, CHAVE);
  const codigo = (passo = passoDe(AGORA)) => codigoTotp(segredo, passo);

  it('emite token com o contexto do RLS quando senha e codigo estao certos', async () => {
    hash = await hashSenha('s3nha!');
    const repo = new FakeRepo([conta()]);
    const s = await svc(repo).login('Rh@Exemplo.com', 's3nha!', codigo(), AGORA);
    expect(s.papel).toBe('RECRUTADOR');
    expect(verificarToken(s.token, JWT, AGORA)).toEqual({ tenantId: T, userId: U, role: 'RECRUTADOR' });
    expect(repo.sucessos).toEqual([U]);
  });

  it('senha errada: credenciais invalidas e falha registrada', async () => {
    const repo = new FakeRepo([conta()]);
    await expect(svc(repo).login('rh@e.com', 'errada', codigo(), AGORA)).rejects.toBeInstanceOf(CredenciaisInvalidasError);
    expect(repo.falhas).toEqual([U]);
  });

  it('e-mail inexistente: mesma resposta da senha errada', async () => {
    await expect(svc(new FakeRepo([])).login('x@e.com', 's3nha!', codigo(), AGORA)).rejects.toBeInstanceOf(CredenciaisInvalidasError);
  });

  it('RH sem codigo: pede o codigo; com codigo errado: invalido e conta falha', async () => {
    const repo = new FakeRepo([conta()]);
    await expect(svc(repo).login('rh@e.com', 's3nha!', undefined, AGORA)).rejects.toBeInstanceOf(Codigo2faObrigatorioError);
    await expect(svc(repo).login('rh@e.com', 's3nha!', '000000', AGORA)).rejects.toBeInstanceOf(CredenciaisInvalidasError);
    expect(repo.falhas).toEqual([U]);
    expect(repo.sucessos).toEqual([]);
  });

  it('o mesmo codigo nao vale duas vezes', async () => {
    const repo = new FakeRepo([conta()]);
    await svc(repo).login('rh@e.com', 's3nha!', codigo(), AGORA);
    await expect(svc(repo).login('rh@e.com', 's3nha!', codigo(), AGORA)).rejects.toBeInstanceOf(CredenciaisInvalidasError);
  });

  it('codigo de passo igual ou anterior ao ultimo usado e recusado', async () => {
    const repo = new FakeRepo([conta({ totpUltimoPasso: passoDe(AGORA) })]);
    await expect(svc(repo).login('rh@e.com', 's3nha!', codigo(), AGORA)).rejects.toBeInstanceOf(CredenciaisInvalidasError);
  });

  it('RH sem 2FA configurado nao entra', async () => {
    const repo = new FakeRepo([conta({ totpSecret: null })]);
    await expect(svc(repo).login('rh@e.com', 's3nha!', undefined, AGORA)).rejects.toBeInstanceOf(Nao2faConfiguradoError);
  });

  it('papel fora do RH sem 2FA configurado entra so com a senha', async () => {
    const repo = new FakeRepo([conta({ role: 'GESTOR_VAGA', totpSecret: null })]);
    const s = await svc(repo).login('g@e.com', 's3nha!', undefined, AGORA);
    expect(s.papel).toBe('GESTOR_VAGA');
  });

  it('conta bloqueada nao entra nem com tudo certo', async () => {
    const repo = new FakeRepo([conta({ bloqueadoAte: new Date(AGORA + 60_000) })]);
    await expect(svc(repo).login('rh@e.com', 's3nha!', codigo(), AGORA)).rejects.toBeInstanceOf(ContaBloqueadaError);
  });

  it('mesma senha em dois tenants: sem escolha possivel, recusa', async () => {
    const outro = conta({ userId: '0198a000-0000-7000-8000-000000000003', tenantId: '0198a000-0000-7000-8000-000000000009' });
    await expect(svc(new FakeRepo([conta(), outro])).login('rh@e.com', 's3nha!', codigo(), AGORA))
      .rejects.toBeInstanceOf(CredenciaisInvalidasError);
  });
});
