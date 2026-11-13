"""Regras de apresentacao da fila do RH: filtro e situacao do SLA.

So formata e filtra o que o gateway entrega. O calculo oficial do SLA e das
transicoes pertence a API.
"""
from datetime import datetime, timedelta, timezone

from .gateway import Chamado

TERMINAIS = {"ADMITIDO", "REPROVADO"}
ALERTA_ANTES = timedelta(hours=24)


def sla_situacao(c: Chamado, agora: datetime | None = None) -> str:
    """'atrasado' | 'vencendo' | 'no_prazo' | 'sem_sla' (encerrados nao tem SLA)."""
    if c.status in TERMINAIS or c.prazo_sla is None:
        return "sem_sla"
    agora = agora or datetime.now(timezone.utc)
    if c.prazo_sla < agora:
        return "atrasado"
    if c.prazo_sla - agora <= ALERTA_ANTES:
        return "vencendo"
    return "no_prazo"


def filtrar(chamados: list[Chamado], status: str = "", busca: str = "") -> list[Chamado]:
    termo = busca.strip().lower()
    saida = [
        c
        for c in chamados
        if (not status or c.status == status)
        and (not termo or termo in c.protocolo.lower() or termo in c.nome.lower())
    ]
    # Mais urgentes primeiro: quem tem prazo mais proximo; sem prazo por ultimo.
    maximo = datetime.max.replace(tzinfo=timezone.utc)
    return sorted(saida, key=lambda c: (c.status in TERMINAIS, c.prazo_sla or maximo))
