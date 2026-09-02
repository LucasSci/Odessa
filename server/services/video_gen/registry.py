"""
registry.py — Fábrica de provedores de geração de vídeo.

Seleciona o provedor com base na variável de ambiente VIDEO_GEN_PROVIDER.
Padrão: "placeholder" (permite testar o pipeline completo sem API real).
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from server.config import VIDEO_GEN_PROVIDER
from server.services.video_gen.base import VideoGenProvider

logger = logging.getLogger("odessa.video_gen.registry")

_PROVIDERS: Dict[str, Any] = {}


def _load_providers() -> Dict[str, Any]:
    from server.services.video_gen.providers import PlaceholderProvider, RouteLLMVideoProvider

    return {
        "placeholder": PlaceholderProvider,
        "routellm": RouteLLMVideoProvider,
    }


def get_provider(name: Optional[str] = None, config: Optional[Dict[str, Any]] = None) -> VideoGenProvider:
    """Retorna uma instância do provedor solicitado (ou o padrão)."""
    global _PROVIDERS
    if not _PROVIDERS:
        _PROVIDERS = _load_providers()

    provider_name = (name or VIDEO_GEN_PROVIDER or "placeholder").strip().lower()
    provider_cls = _PROVIDERS.get(provider_name)
    if provider_cls is None:
        logger.warning(
            "Provedor de vídeo '%s' desconhecido; usando 'placeholder'.",
            provider_name,
        )
        provider_cls = _PROVIDERS["placeholder"]
    return provider_cls(config=config)


def available_providers() -> list[str]:
    global _PROVIDERS
    if not _PROVIDERS:
        _PROVIDERS = _load_providers()
    return sorted(_PROVIDERS.keys())
