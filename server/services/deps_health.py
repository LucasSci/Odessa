"""Relatório de dependências externas (Ollama, chaves de IA) para a UI.

O diagnóstico antigo dizia "funcionando" mesmo quando o Ollama estava sem o
modelo, e a IA caía em silêncio. Aqui cada problema vira um item com código,
gravidade, mensagem em português e, quando existe, a ação que resolve.
"""
from __future__ import annotations

from typing import Any

OLLAMA_PROVIDERS = {"ollama", "local"}


def build_deps_report(
    *,
    provider: str,
    ollama: dict[str, Any],
    ollama_installed: bool,
    keys: dict[str, bool],
) -> dict[str, Any]:
    """`ollama` é o dict de `_check_ollama`; `keys` diz quais chaves de nuvem existem."""
    provider = (provider or "").strip().lower()
    wants_ollama = provider in OLLAMA_PROVIDERS
    cloud_ready = [name for name, present in keys.items() if present]
    ollama_ready = bool(ollama.get("reachable") and ollama.get("modelInstalled"))

    issues: list[dict[str, Any]] = []

    if wants_ollama and not ollama_ready:
        model = ollama.get("model") or "o modelo configurado"
        if not ollama.get("reachable"):
            if not ollama_installed:
                issues.append({
                    "code": "ollama_not_installed",
                    "severity": "error" if not cloud_ready else "warning",
                    "message": "O Ollama não está instalado neste computador, então a IA local não responde.",
                    "action": {"kind": "link", "label": "Baixar o Ollama", "url": "https://ollama.com/download"},
                })
            else:
                issues.append({
                    "code": "ollama_unreachable",
                    "severity": "error" if not cloud_ready else "warning",
                    "message": "O Ollama está instalado, mas não está rodando.",
                    "action": {"kind": "post", "label": "Iniciar o Ollama", "path": "/ai/ollama/connect"},
                })
        else:
            issues.append({
                "code": "ollama_model_missing",
                "severity": "error" if not cloud_ready else "warning",
                "message": f"O Ollama está ativo, mas o modelo {model} não foi baixado.",
                "action": {"kind": "post", "label": f"Baixar {model}", "path": "/ai/ollama/connect"},
            })

    if not wants_ollama and not cloud_ready:
        issues.append({
            "code": "no_ai_provider",
            "severity": "error",
            "message": "Nenhuma chave de IA (Gemini, OpenAI ou Claude) está configurada.",
            "action": None,
        })
    ai_usable = ollama_ready or bool(cloud_ready)

    return {
        "ok": ai_usable and not any(item["severity"] == "error" for item in issues),
        "ai": {
            "provider": provider or "auto",
            "usable": ai_usable,
            "cloudProviders": cloud_ready,
            "ollama": {
                "installed": ollama_installed,
                "reachable": bool(ollama.get("reachable")),
                "model": ollama.get("model"),
                "modelInstalled": bool(ollama.get("modelInstalled")),
            },
        },
        "issues": issues,
    }
