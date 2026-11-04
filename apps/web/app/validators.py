"""Pre-validacao de UX. A API NestJS continua sendo a autoridade."""
import re


def only_digits(s: str) -> str:
    return re.sub(r"\D", "", s)


def is_valid_cpf(value: str) -> bool:
    c = only_digits(value)
    if len(c) != 11 or len(set(c)) == 1:
        return False
    for n in (9, 10):
        total = sum(int(c[i]) * (n + 1 - i) for i in range(n))
        if ((total * 10) % 11) % 10 != int(c[n]):
            return False
    return True


EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,255}\.[^@\s]{2,}$")


def is_valid_email(value: str) -> bool:
    return bool(EMAIL_RE.match(value.strip()))
