import { Cpf } from './cpf.js';

export interface EnderecoAdmissao {
  logradouro: string;
  numero: string;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string;
}

/** Subconjunto inicial do modelo canonico (baseado no S-2200 do eSocial). */
export interface AdmissaoDados {
  chamadoId: string;
  nome: string;
  cpf: string;
  nascimento: Date;
  endereco: EnderecoAdmissao;
  cargo: string;
  /** Em centavos, para nao usar ponto flutuante com dinheiro. */
  salarioCentavos: number;
  dataAdmissao: Date;
}

export class AdmissaoInvalidaError extends Error {}

/** Dados do pre-cadastro que seguem para o ERP. Imutavel depois de criado. */
export class Admissao {
  private constructor(
    readonly chamadoId: string,
    readonly nome: string,
    readonly cpf: Cpf,
    readonly nascimento: Date,
    readonly endereco: Readonly<EnderecoAdmissao>,
    readonly cargo: string,
    readonly salarioCentavos: number,
    readonly dataAdmissao: Date,
  ) {}

  static criar(d: AdmissaoDados, hoje: Date = new Date()): Admissao {
    const nome = d.nome.trim();
    const cargo = d.cargo.trim();
    if (!nome) throw new AdmissaoInvalidaError('Nome obrigatorio');
    if (!cargo) throw new AdmissaoInvalidaError('Cargo obrigatorio');
    if (!Number.isSafeInteger(d.salarioCentavos) || d.salarioCentavos <= 0) {
      throw new AdmissaoInvalidaError('Salario deve ser um inteiro positivo em centavos');
    }
    if (![d.nascimento, d.dataAdmissao, hoje].every((data) => Number.isFinite(data.getTime()))) {
      throw new AdmissaoInvalidaError('Data invalida');
    }
    if (d.nascimento >= hoje) throw new AdmissaoInvalidaError('Nascimento deve ser no passado');
    if (d.dataAdmissao < d.nascimento) {
      throw new AdmissaoInvalidaError('Data de admissao anterior ao nascimento');
    }
    if (!/^[A-Z]{2}$/.test(d.endereco.uf)) throw new AdmissaoInvalidaError('UF invalida');
    if (!/^\d{8}$/.test(d.endereco.cep.replace(/\D/g, ''))) {
      throw new AdmissaoInvalidaError('CEP invalido');
    }
    return new Admissao(
      d.chamadoId,
      nome,
      Cpf.criar(d.cpf),
      d.nascimento,
      Object.freeze({ ...d.endereco, cep: d.endereco.cep.replace(/\D/g, '') }),
      cargo,
      d.salarioCentavos,
      d.dataAdmissao,
    );
  }
}
