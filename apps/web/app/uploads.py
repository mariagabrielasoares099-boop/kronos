"""Validacao do arquivo pelo CONTEUDO (magic bytes), nunca pela extensao ou Content-Type enviados.

Espelha as regras da API (apps/api/src/documentos/arquivo.ts): JPG, PNG ou PDF, ate 5 MB.
"""

MAX_BYTES = 5 * 1024 * 1024
ASSINATURAS = {
    "image/jpeg": b"\xff\xd8\xff",
    "image/png": b"\x89PNG\r\n\x1a\n",
    "application/pdf": b"%PDF-",
}


class ArquivoInvalido(Exception):
    pass


def validar_arquivo(conteudo: bytes) -> str:
    if not conteudo:
        raise ArquivoInvalido("Arquivo vazio.")
    if len(conteudo) > MAX_BYTES:
        raise ArquivoInvalido("Arquivo acima de 5 MB.")
    for mime, assinatura in ASSINATURAS.items():
        if conteudo.startswith(assinatura):
            return mime
    raise ArquivoInvalido("Tipo nao permitido: envie JPG, PNG ou PDF.")
