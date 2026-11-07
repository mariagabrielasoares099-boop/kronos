"""Acesso aos dados. Hoje: DemoGateway (memoria). Depois: HttpGateway para a API NestJS.

A regra de negocio (transicoes de status, SLA, RLS) mora na API. O DemoGateway so
simula o suficiente para a tela funcionar e NAO e a fonte de verdade.
"""
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
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
    responsavel: str | None = None
    prazo_sla: datetime | None = None


class Gateway(Protocol):
    def listar_vagas(self) -> list[Vaga]: ...
    def obter_vaga(self, vaga_id: str) -> Vaga | None: ...
    def criar_chamado(self, vaga_id: str, nome: str) -> Chamado: ...
    def obter_chamado(self, protocolo: str) -> Chamado | None: ...
    def listar_chamados(self) -> list[Chamado]: ...


class DemoGateway:
    def __init__(self) -> None:
        self._vagas = {
            "v1": Vaga("v1", "Auxiliar Administrativo", "Empresa Exemplo Ltda", "Fortaleza/CE",
                       "Rotinas administrativas e atendimento."),
            "v2": Vaga("v2", "Operador de Logistica", "Empresa Exemplo Ltda", "Caucaia/CE",
                       "Separacao, conferencia e expedicao. Uso de EPI."),
        }
        self._chamados: dict[str, Chamado] = {}
        self._seq = 0
        agora = datetime.now(timezone.utc)
        seeds = [
            ("Ana Souza", "VALIDACAO_DP", "Carla (DP)", agora - timedelta(hours=5)),
            ("Bruno Lima", "TRIAGEM", "Diego (RH)", agora + timedelta(hours=10)),
            ("Carlos Mota", "AGUARDANDO_CANDIDATO", None, agora + timedelta(days=3)),
            ("Daniela Reis", "ENTREVISTA", "Diego (RH)", agora + timedelta(days=1, hours=8)),
            ("Eduardo Nunes", "ADMITIDO", "Carla (DP)", None),
        ]
        for nome, st, resp, prazo in seeds:
            c = self.criar_chamado("v1", nome)
            c.status, c.responsavel, c.prazo_sla = st, resp, prazo

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
