"""Observabilidade do backend: erros enviados ao Sentry (issue #243).

Opt-in: sem ``SENTRY_DSN`` nada é importado nem enviado. Sem dados pessoais
(``send_default_pii=False``): IP, cookies e corpo das requisições ficam de fora.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Callable

logger = logging.getLogger("odessa.observability")


def _sample_rate(raw: str | None) -> float:
    try:
        value = float(raw) if raw else 0.0
    except ValueError:
        return 0.0
    return value if 0.0 <= value <= 1.0 else 0.0


def init_sentry(
    env: dict[str, str] | None = None,
    sdk_init: Callable[..., Any] | None = None,
) -> bool:
    """Inicializa o Sentry se houver DSN. Retorna True quando ficou ativo."""
    env = dict(os.environ) if env is None else env
    dsn = (env.get("SENTRY_DSN") or "").strip()
    if not dsn:
        return False
    if sdk_init is None:
        try:
            import sentry_sdk
        except ImportError:
            logger.warning("SENTRY_DSN definido, mas o pacote sentry-sdk não está instalado.")
            return False
        sdk_init = sentry_sdk.init
    sdk_init(
        dsn=dsn,
        environment=env.get("SENTRY_ENVIRONMENT") or "production",
        send_default_pii=False,
        max_request_body_size="never",
        traces_sample_rate=_sample_rate(env.get("SENTRY_TRACES_SAMPLE_RATE")),
    )
    logger.info("Sentry ativo (ambiente=%s).", env.get("SENTRY_ENVIRONMENT") or "production")
    return True
