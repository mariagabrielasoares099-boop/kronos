"""Cadastra candidatos de TESTE nas vagas do demo (pelo formulario publico, como uma pessoa faria).

    python scripts/semear_candidatos.py [URL_BASE]      # padrao: http://127.0.0.1:8000

Os dados sao ficticios: CPFs validos so no digito verificador (gerados, nao pertencem a ninguem) e e-mails
@exemplo.test (dominio reservado, nunca entrega). O demo guarda tudo em memoria: reiniciar o servidor zera.
Rodar duas vezes cria chamados duplicados, de proposito (cada execucao e um novo cadastro).
"""
import sys

import httpx

CANDIDATOS = [
    ("v1", "Teste Aline Prado", "aline.prado@exemplo.test", "390.533.447-05"),
    ("v1", "Teste Breno Salles", "breno.salles@exemplo.test", "111.444.777-35"),
    ("v2", "Teste Camila Rocha", "camila.rocha@exemplo.test", "123.456.789-09"),
    ("v3", "Teste Davi Moura", "davi.moura@exemplo.test", "246.813.579-28"),
    ("v4", "Teste Elisa Ventura", "elisa.ventura@exemplo.test", "864.209.753-10"),
]


def main(base: str) -> int:
    base = base.rstrip("/")
    falhas = 0
    with httpx.Client(base_url=base, timeout=10.0, follow_redirects=False) as c:
        for vaga, nome, email, cpf in CANDIDATOS:
            r = c.post(f"/vagas/{vaga}/candidatar", data={"nome": nome, "email": email, "cpf": cpf, "consentimento": "on"})
            if r.status_code == 303:
                print(f"OK   {nome:<20} vaga {vaga}  -> {base}{r.headers['location']}")
            else:
                falhas += 1
                print(f"FALHA {nome} (HTTP {r.status_code}). O servidor esta em modo demo (DEMO_MODE=true)?")
    return 1 if falhas else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"))
