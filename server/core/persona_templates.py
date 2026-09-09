"""
persona_templates.py — Templates de prompt por tipo de vídeo, por persona.

Cada persona tem um template de prompt para cada tipo de vídeo do fluxo:
  - FLUXO:     vídeos de fluxo contínuo / idle
  - GATILHO:   vídeos de reação a gatilhos (presentes, mensagens)
  - ESPECIAL:  vídeos com ações específicas (alongamento, cabelo, etc.)
  - TRANSICAO: vídeos de transição entre estados

Os templates usam placeholders que são preenchidos com os assets da persona
ativa, permitindo produzir o mesmo vídeo com personas diferentes:

  {persona_name}     → nome da persona
  {face_ref}         → referência textual do rosto (URL da imagem primária)
  {environment_ref}  → referência textual do ambiente (URL da imagem primária)
  {wardrobe_ref}     → referência textual da roupa (URL da imagem primária)
  {action}           → descrição da ação (preenchida pelo contexto do chat)
"""
import logging
from typing import Any, Dict, Optional

from server.core.persona_manager import get_persona, get_persona_config_path
from server.core.persona_assets import get_primary_asset, get_asset_url

logger = logging.getLogger("odessa.persona_templates")

VIDEO_TYPES = ["FLUXO", "GATILHO", "ESPECIAL", "TRANSICAO"]

DEFAULT_TEMPLATES: Dict[str, Dict[str, str]] = {
    "FLUXO": {
        "label": "Fluxo (Idle/Contínuo)",
        "prompt": (
            "Vídeo de {persona_name} em seu ambiente de streaming. "
            "Referência de rosto: {face_ref}. "
            "Ambiente: {environment_ref}. "
            "Roupa: {wardrobe_ref}. "
            "Ação: animação natural e contínua, sorriso leve, olhando para a câmera. "
            "{action}"
        ),
        "description": "Vídeos de fluxo contínuo e idle — base da live",
    },
    "GATILHO": {
        "label": "Gatilho (Reação)",
        "prompt": (
            "Vídeo de reação de {persona_name} durante a live. "
            "Referência de rosto: {face_ref}. "
            "Ambiente: {environment_ref}. "
            "Roupa: {wardrobe_ref}. "
            "Ação: reação animada e expressiva ao evento do chat. "
            "{action}"
        ),
        "description": "Vídeos de reação a gatilhos — presentes, mensagens especiais",
    },
    "ESPECIAL": {
        "label": "Especial (Ação Específica)",
        "prompt": (
            "Vídeo especial de {persona_name}. "
            "Referência de rosto: {face_ref}. "
            "Ambiente: {environment_ref}. "
            "Roupa: {wardrobe_ref}. "
            "Ação: movimento específico e coreografado. "
            "{action}"
        ),
        "description": "Vídeos com ações específicas — alongamento, cabelo, etc.",
    },
    "TRANSICAO": {
        "label": "Transição (Mudança de Estado)",
        "prompt": (
            "Vídeo de transição de {persona_name}. "
            "Referência de rosto: {face_ref}. "
            "Ambiente: {environment_ref}. "
            "Roupa: {wardrobe_ref}. "
            "Ação: ajuste suave de postura e roupa, transição natural entre estados. "
            "{action}"
        ),
        "description": "Vídeos de transição entre estados da live",
    },
}


def get_default_templates() -> Dict[str, Dict[str, str]]:
    """Retorna uma cópia dos templates padrão."""
    return {k: dict(v) for k, v in DEFAULT_TEMPLATES.items()}


def _load_templates_from_config(persona_id: str) -> Dict[str, Dict[str, str]]:
    """Carrega os templates do arquivo de config da persona."""
    import json
    config_path = get_persona_config_path(persona_id)
    if not config_path.exists():
        return get_default_templates()
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            config = json.load(f)
    except Exception:
        return get_default_templates()

    stored = config.get("videoTemplates", {})
    if not isinstance(stored, dict):
        return get_default_templates()

    # Merge: usa defaults como base, sobrescreve com o que está salvo
    templates = get_default_templates()
    for vtype in VIDEO_TYPES:
        if vtype in stored and isinstance(stored[vtype], dict):
            for key in ("label", "prompt", "description"):
                if key in stored[vtype]:
                    templates[vtype][key] = stored[vtype][key]
    return templates


def get_templates(persona_id: str) -> Dict[str, Dict[str, str]]:
    """Retorna os templates de prompt da persona."""
    return _load_templates_from_config(persona_id)


def save_templates(persona_id: str, templates: Dict[str, Dict[str, str]]) -> Dict[str, Dict[str, str]]:
    """Salva os templates de prompt no arquivo de config da persona."""
    import json
    config_path = get_persona_config_path(persona_id)
    config: Dict[str, Any] = {}
    if config_path.exists():
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                config = json.load(f)
        except Exception:
            config = {}

    # Valida e normaliza
    normalized = get_default_templates()
    for vtype in VIDEO_TYPES:
        if vtype in templates and isinstance(templates[vtype], dict):
            for key in ("label", "prompt", "description"):
                val = templates[vtype].get(key)
                if val is not None:
                    normalized[vtype][key] = str(val)

    config["videoTemplates"] = normalized
    with open(config_path, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2, ensure_ascii=False)
    return normalized


def _format_asset_ref(persona_id: str, category: str) -> str:
    """Constrói a referência textual de um asset para o prompt."""
    primary = get_primary_asset(persona_id, category)
    if primary is None:
        return f"(nenhuma imagem de {category} definida)"
    url = get_asset_url(persona_id, category, primary["id"])
    label = primary.get("label", primary.get("id", ""))
    return f"[{label}] ({url})"


def render_template(
    persona_id: str,
    video_type: str,
    action: str = "",
) -> str:
    """Preenche os placeholders do template com os assets da persona."""
    persona = get_persona(persona_id)
    persona_name = persona.get("name", persona_id) if persona else persona_id

    templates = get_templates(persona_id)
    template = templates.get(video_type)
    if template is None:
        template = DEFAULT_TEMPLATES.get("FLUXO", {"prompt": "{action}"})

    prompt = template.get("prompt", "")
    prompt = prompt.replace("{persona_name}", persona_name)
    prompt = prompt.replace("{face_ref}", _format_asset_ref(persona_id, "faces"))
    prompt = prompt.replace("{environment_ref}", _format_asset_ref(persona_id, "environments"))
    prompt = prompt.replace("{wardrobe_ref}", _format_asset_ref(persona_id, "wardrobe"))
    prompt = prompt.replace("{action}", action.strip())
    return prompt.strip()


def detect_video_type(video_id: str) -> str:
    """Extrai o tipo de vídeo do ID (ex: '09_GATILHO_beijo_discreto' → 'GATILHO')."""
    import re
    parts = video_id.split("_", 2)
    if len(parts) >= 2:
        for vtype in VIDEO_TYPES:
            if parts[1].upper() == vtype:
                return vtype
    # Fallback: busca o tipo em qualquer parte do ID
    upper = video_id.upper()
    for vtype in VIDEO_TYPES:
        if vtype in upper:
            return vtype
    return "FLUXO"
