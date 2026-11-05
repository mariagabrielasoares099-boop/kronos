"""Configuracao via ambiente (passo 1). Falha no boot se faltar algo em producao."""
import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    api_base_url: str
    demo_mode: bool
    session_secret: str
    rate_limit_max: int
    rate_limit_window_s: int


def load_settings(env: dict[str, str] | None = None) -> Settings:
    e = os.environ if env is None else env
    demo = e.get("DEMO_MODE", "true").lower() == "true"
    secret = e.get("SESSION_SECRET", "")
    if not demo and len(secret) < 32:
        raise RuntimeError("SESSION_SECRET precisa ter 32+ caracteres fora do modo demo")
    api = e.get("API_BASE_URL", "")
    if not demo and not api:
        raise RuntimeError("API_BASE_URL e obrigatoria fora do modo demo")
    return Settings(
        api_base_url=api,
        demo_mode=demo,
        session_secret=secret,
        rate_limit_max=int(e.get("RATE_LIMIT_MAX", "10")),
        rate_limit_window_s=int(e.get("RATE_LIMIT_WINDOW_S", "60")),
    )
