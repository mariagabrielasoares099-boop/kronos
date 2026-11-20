"""Medidor de uso e custo por empresa (demo).

Os 5 meses anteriores sao FICTICIOS (dados de exemplo). O mes atual parte de uma base ficticia e soma o uso
real medido pelo proprio sistema (buscas e respostas do RAG). A IA e local (Ollama), entao o custo e R$ 0,00:
o painel mostra consumo contra a cota do plano para evitar surpresa quando houver um provedor pago (denial of wallet).
"""
import threading
from datetime import date

COTAS = {"chamadas_ia": 2000, "tokens": 1_000_000, "armazenamento_mb": 5000, "admissoes": 50}
NOMES_MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"]
# (chamadas_ia, tokens, armazenamento_mb, admissoes) dos 5 meses anteriores, do mais antigo ao mais recente
HISTORICO_FICTICIO = [(420, 190_000, 1180, 9), (610, 280_000, 1460, 13), (780, 360_000, 1830, 17),
                      (905, 410_000, 2210, 21), (1130, 530_000, 2640, 26)]
BASE_MES_ATUAL = (340, 160_000, 2790, 8)


def _mes_anterior(ano: int, mes: int, n: int) -> tuple[int, int]:
    i = ano * 12 + (mes - 1) - n
    return i // 12, i % 12 + 1


class MedidorUso:
    def __init__(self, hoje: date | None = None):
        self._hoje = hoje or date.today()
        self._lock = threading.Lock()
        self._real = {"busca": 0, "ia": 0, "tokens": 0}

    def registrar(self, tipo: str, tokens: int = 0) -> None:
        """tipo: 'busca' (consulta a base) ou 'ia' (resposta gerada pelo modelo)."""
        with self._lock:
            self._real[tipo] = self._real.get(tipo, 0) + 1
            self._real["tokens"] += max(0, tokens)

    def _linha(self, ano: int, mes: int, v: tuple[int, int, int, int], atual: bool = False) -> dict:
        return {"mes": f"{NOMES_MES[mes - 1]}/{ano}", "atual": atual, "chamadas_ia": v[0], "tokens": v[1],
                "armazenamento_mb": v[2], "admissoes": v[3], "custo_reais": 0.0}

    def resumo(self) -> dict:
        h = self._hoje
        with self._lock:
            real = dict(self._real)
        linhas = []
        for n, v in zip(range(5, 0, -1), HISTORICO_FICTICIO):
            a, m = _mes_anterior(h.year, h.month, n)
            linhas.append(self._linha(a, m, v))
        b = BASE_MES_ATUAL
        atual = self._linha(h.year, h.month, (b[0] + real["busca"] + real["ia"], b[1] + real["tokens"], b[2], b[3]), True)
        linhas.append(atual)
        uso = [{"nome": nome, "valor": atual[chave], "cota": COTAS[chave], "pct": min(100, round(atual[chave] * 100 / COTAS[chave]))}
               for nome, chave in (("Chamadas de IA", "chamadas_ia"), ("Tokens", "tokens"),
                                   ("Armazenamento (MB)", "armazenamento_mb"), ("Admissões", "admissoes"))]
        return {"linhas": linhas, "atual": atual, "uso": uso, "real": real, "custo_total": 0.0}
