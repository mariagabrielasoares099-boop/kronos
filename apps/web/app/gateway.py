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
    "VALIDACAO_DP": "Validação do DP",
    "ASSINATURA": "Assinatura",
    "ENVIO_ERP": "Envio ao ERP",
    "ADMITIDO": "Admitido",
    "REPROVADO": "Reprovado",
}
STATUSES = list(STATUS_LABELS)

TIPOS_DOCUMENTO = {
    "RG": "RG",
    "CPF": "CPF",
    "COMPROVANTE_RESIDENCIA": "Comprovante de residência",
    "CTPS": "CTPS",
    "FOTO_3X4": "Foto 3x4",
    "OUTRO": "Outro",
}
CHECKLIST = ["RG", "CPF", "COMPROVANTE_RESIDENCIA"]  # igual a API (checklist mockado do M1)

# Proximo passo do fluxo no DEMO. A regra oficial das transicoes mora na API.
PROXIMO = {
    "TRIAGEM": "ENTREVISTA", "TESTES": "ENTREVISTA", "ENTREVISTA": "APROVADO", "APROVADO": "AGUARDANDO_CANDIDATO",
    "AGUARDANDO_CANDIDATO": "VALIDACAO_DP", "VALIDACAO_DP": "ASSINATURA", "ASSINATURA": "ENVIO_ERP", "ENVIO_ERP": "ADMITIDO",
}
ACAO_AVANCAR = {
    "TRIAGEM": "Aprovar triagem", "ENTREVISTA": "Aprovar candidato", "APROVADO": "Pedir documentos",
    "AGUARDANDO_CANDIDATO": "Documentos recebidos", "VALIDACAO_DP": "Validar e seguir para assinatura",
    "ASSINATURA": "Enviar ao ERP", "ENVIO_ERP": "Confirmar admissão",
}


@dataclass
class Vaga:
    id: str
    titulo: str
    empresa: str
    local: str
    descricao: str


@dataclass
class Documento:
    id: str
    tipo: str
    nome_arquivo: str
    status: str = "PENDENTE"  # PENDENTE | APROVADO | RECUSADO
    motivo: str | None = None


@dataclass
class Chamado:
    protocolo: str
    vaga_id: str
    nome: str
    status: str = "TRIAGEM"
    historico: list[tuple[str, str]] = field(default_factory=list)  # (status, motivo)
    responsavel: str | None = None
    prazo_sla: datetime | None = None
    documentos: list[Documento] = field(default_factory=list)
    vaga_titulo: str | None = None  # API: titulo ja vem no resumo; o demo busca a vaga pelo gateway
    docs_indisponiveis: bool = False  # API: equipe sem atribuicao ao chamado nao ve os documentos


class Gateway(Protocol):
    def listar_vagas(self) -> list[Vaga]: ...
    def obter_vaga(self, vaga_id: str) -> Vaga | None: ...
    def criar_chamado(self, vaga_id: str, nome: str) -> Chamado: ...
    def obter_chamado(self, protocolo: str) -> Chamado | None: ...
    def listar_chamados(self) -> list[Chamado]: ...
    def enviar_documento(self, protocolo: str, tipo: str, nome_arquivo: str) -> Documento | None: ...
    def obter_documento(self, doc_id: str) -> tuple[Chamado, Documento] | None: ...
    def decidir_documento(self, doc_id: str, aprovar: bool, motivo: str = "") -> Chamado | None: ...
    def avancar(self, protocolo: str) -> Chamado | None: ...


class DemoGateway:
    def __init__(self) -> None:
        self._vagas = {
            "v1": Vaga("v1", "Auxiliar Administrativo", "Empresa Exemplo Ltda", "Fortaleza/CE",
                       "Rotinas administrativas e atendimento."),
            "v2": Vaga("v2", "Operador de Logística", "Empresa Exemplo Ltda", "Caucaia/CE",
                       "Separação, conferência e expedição. Uso de EPI."),
            "v3": Vaga("v3", "Assistente de RH", "Empresa Exemplo Ltda", "Fortaleza/CE",
                       "Apoio a recrutamento, admissão e rotinas de departamento pessoal."),
            "v4": Vaga("v4", "Motorista Entregador", "Empresa Exemplo Ltda", "Maracanaú/CE",
                       "Entregas urbanas com veiculo da empresa. CNH categoria B."),
        }
        self._chamados: dict[str, Chamado] = {}
        self._seq = 0
        self._seq_doc = 0
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
        # Ana (validacao do DP) ja enviou os tres documentos; o RH decide na tela.
        ana = self._chamados["ADM-2026-000001"]
        for tipo in CHECKLIST:
            self.enviar_documento(ana.protocolo, tipo, f"{tipo.lower()}.pdf")
        ana.historico += [("APROVADO", "Entrevista aprovada"), ("AGUARDANDO_CANDIDATO", "Documentos solicitados"),
                          ("VALIDACAO_DP", "Documentos recebidos")]
        self._semear_documentos_ficticios(agora)

    def _semear_documentos_ficticios(self, agora: datetime) -> None:
        """Candidatos e documentos FICTICIOS (sem arquivo real) para mostrar o fluxo nas vagas."""
        def cand(vaga, nome, st, resp, prazo, docs, historico):
            c = self.criar_chamado(vaga, nome)
            c.status, c.responsavel, c.prazo_sla = st, resp, prazo
            c.historico += historico
            for tipo, status, motivo in docs:
                d = self.enviar_documento(c.protocolo, tipo, f"{tipo.lower()}.pdf")
                d.status, d.motivo = status, motivo

        pedidos = [("APROVADO", "Entrevista aprovada"), ("AGUARDANDO_CANDIDATO", "Documentos solicitados")]
        cand("v2", "Fernanda Alves", "AGUARDANDO_CANDIDATO", "Diego (RH)", agora + timedelta(days=2),
             [("RG", "APROVADO", None), ("CPF", "PENDENTE", None)], pedidos)
        cand("v2", "Gustavo Pires", "VALIDACAO_DP", "Carla (DP)", agora + timedelta(hours=6),
             [("RG", "APROVADO", None), ("CPF", "RECUSADO", "Foto ilegivel"), ("COMPROVANTE_RESIDENCIA", "PENDENTE", None)],
             pedidos + [("VALIDACAO_DP", "Documentos recebidos")])
        cand("v2", "Helena Castro", "ASSINATURA", "Carla (DP)", agora + timedelta(days=1),
             [("RG", "APROVADO", None), ("CPF", "APROVADO", None), ("COMPROVANTE_RESIDENCIA", "APROVADO", None),
              ("CTPS", "APROVADO", None), ("FOTO_3X4", "APROVADO", None)],
             pedidos + [("VALIDACAO_DP", "Documentos recebidos"), ("ASSINATURA", "Documentos validados")])
        cand("v3", "Igor Barros", "ENTREVISTA", "Diego (RH)", agora + timedelta(days=2), [], [])
        cand("v3", "Juliana Teixeira", "VALIDACAO_DP", "Carla (DP)", agora - timedelta(hours=2),
             [("RG", "PENDENTE", None), ("CPF", "PENDENTE", None), ("COMPROVANTE_RESIDENCIA", "PENDENTE", None)],
             pedidos + [("VALIDACAO_DP", "Documentos recebidos")])
        cand("v4", "Lucas Ferraz", "AGUARDANDO_CANDIDATO", None, agora + timedelta(days=4),
             [("RG", "APROVADO", None)], pedidos)
        cand("v4", "Marina Duarte", "ENVIO_ERP", "Carla (DP)", agora + timedelta(hours=20),
             [("RG", "APROVADO", None), ("CPF", "APROVADO", None), ("COMPROVANTE_RESIDENCIA", "APROVADO", None),
              ("OUTRO", "APROVADO", None)],
             pedidos + [("VALIDACAO_DP", "Documentos recebidos"), ("ASSINATURA", "Documentos validados"),
                        ("ENVIO_ERP", "Contrato assinado")])

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

    def enviar_documento(self, protocolo: str, tipo: str, nome_arquivo: str) -> Documento | None:
        c = self._chamados.get(protocolo)
        if not c:
            return None
        self._seq_doc += 1
        d = Documento(f"d{self._seq_doc}", tipo, nome_arquivo)
        c.documentos.append(d)
        return d

    def obter_documento(self, doc_id: str) -> tuple[Chamado, Documento] | None:
        for c in self._chamados.values():
            for d in c.documentos:
                if d.id == doc_id:
                    return c, d
        return None

    def decidir_documento(self, doc_id: str, aprovar: bool, motivo: str = "") -> Chamado | None:
        achado = self.obter_documento(doc_id)
        if not achado or achado[1].status != "PENDENTE":
            return None
        c, d = achado
        d.status, d.motivo = ("APROVADO", None) if aprovar else ("RECUSADO", motivo.strip())
        return c

    def avancar(self, protocolo: str) -> Chamado | None:
        c = self._chamados.get(protocolo)
        if not c or c.status not in PROXIMO:
            return None
        c.status = PROXIMO[c.status]
        c.historico.append((c.status, "Avancado pelo RH (demo)"))
        return c
