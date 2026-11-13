"""Acesso aos dados. Hoje: DemoGateway (memoria). Depois: HttpGateway para a API NestJS.

A regra de negocio (transicoes de status, SLA, RLS) mora na API. O DemoGateway so
simula o suficiente para a tela funcionar e NAO e a fonte de verdade.
"""
from dataclasses import dataclass, field
from typing import Protocol

STATUS_LABELS = {
    "TRIAGEM": "Triagem",
    "TESTES": "Testes",
    "ENTREVISTA": "Entrevista",
    "APROVADO": "Aprovado",
    "AGUARDANDO_CANDIDATO": "Aguardando candidato",
    "VALIDACAO_DP": "Validacao do DP",
    "ASSINATURA": "Assinatura",
    "ENVIO_ERP": "Envio ao ERP",
    "ADMITIDO": "Admitido",
    "REPROVADO": "Reprovado",
}
STATUSES = list(STATUS_LABELS)


@dataclass
class Vaga:
    id: str
    titulo: str
    empresa: str
    local: str
    descricao: str


@dataclass
class Chamado:
    protocolo: str
    vaga_id: str
    nome: str
    status: str = "TRIAGEM"
    historico: list[tuple[str, str]] = field(default_factory=list)  # (status, motivo)


CHECKLIST = {
    "RG": "RG",
    "CPF": "CPF",
    "COMPROVANTE_RESIDENCIA": "Comprovante de residencia",
}  # mesma lista fixa da API no M1


@dataclass
class Documento:
    tipo: str
    mime: str
    tamanho_bytes: int
    status: str = "PENDENTE"  # PENDENTE | APROVADO | RECUSADO
    motivo: str | None = None


class Gateway(Protocol):
    def listar_vagas(self) -> list[Vaga]: ...
    def obter_vaga(self, vaga_id: str) -> Vaga | None: ...
    def criar_chamado(self, vaga_id: str, nome: str) -> Chamado: ...
    def obter_chamado(self, protocolo: str) -> Chamado | None: ...
    def listar_chamados(self) -> list[Chamado]: ...
    def listar_documentos(self, protocolo: str) -> list[Documento]: ...
    def enviar_documento(self, protocolo: str, tipo: str, mime: str, tamanho_bytes: int) -> Documento: ...


class DemoGateway:
    def __init__(self) -> None:
        self._vagas = {
            "v1": Vaga("v1", "Auxiliar Administrativo", "Empresa Exemplo Ltda", "Fortaleza/CE",
                       "Rotinas administrativas e atendimento."),
            "v2": Vaga("v2", "Operador de Logistica", "Empresa Exemplo Ltda", "Caucaia/CE",
                       "Separacao, conferencia e expedicao. Uso de EPI."),
        }
        self._chamados: dict[str, Chamado] = {}
        self._documentos: dict[str, list[Documento]] = {}
        self._seq = 0
        for nome, st in [("Ana Souza", "VALIDACAO_DP"), ("Bruno Lima", "TRIAGEM")]:
            c = self.criar_chamado("v1", nome)
            c.status = st

    def listar_vagas(self) -> list[Vaga]:
        return list(self._vagas.values())

    def obter_vaga(self, vaga_id: str) -> Vaga | None:
        return self._vagas.get(vaga_id)

    def criar_chamado(self, vaga_id: str, nome: str) -> Chamado:
        self._seq += 1
        c = Chamado(f"ADM-2026-{self._seq:06d}", vaga_id, nome, historico=[("TRIAGEM", "Candidatura recebida")])
        self._chamados[c.protocolo] = c
        return c

    def obter_chamado(self, protocolo: str) -> Chamado | None:
        return self._chamados.get(protocolo)

    def listar_chamados(self) -> list[Chamado]:
        return list(self._chamados.values())

    def listar_documentos(self, protocolo: str) -> list[Documento]:
        return list(self._documentos.get(protocolo, []))

    def enviar_documento(self, protocolo: str, tipo: str, mime: str, tamanho_bytes: int) -> Documento:
        # O demo guarda so os metadados; o conteudo nao fica na memoria do portal.
        d = Documento(tipo, mime, tamanho_bytes)
        self._documentos.setdefault(protocolo, []).append(d)
        return d
