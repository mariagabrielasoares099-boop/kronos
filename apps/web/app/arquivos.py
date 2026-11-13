"""Validacao de arquivos enviados (espelha apps/api/src/documentos/arquivo.ts).

O tipo vem do conteudo (magic bytes), nunca da extensao nem do Content-Type enviado.
A API repete a validacao: aqui e so resposta rapida e protecao de memoria do portal.
"""

TAMANHO_MAXIMO_BYTES = 5 * 1024 * 1024


class ArquivoInvalido(ValueError):
    def __init__(self, mensagem: str, status_code: int = 422):
        super().__init__(mensagem)
        self.status_code = status_code


def detectar_mime(b: bytes) -> str | None:
    if b.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if b.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if b.startswith(b"%PDF-"):
        return "application/pdf"
    return None


def validar_arquivo(b: bytes, maximo: int = TAMANHO_MAXIMO_BYTES) -> str:
    if len(b) == 0:
        raise ArquivoInvalido("Arquivo vazio.")
    if len(b) > maximo:
        raise ArquivoInvalido("Arquivo acima de 5 MB.", 413)
    mime = detectar_mime(b)
    if mime is None:
        raise ArquivoInvalido("Tipo nao permitido: envie JPG, PNG ou PDF.")
    return mime
