"""
persona_visual.py — Estrutura visual por persona: kits de roupas e cenários.

Cada persona guarda separadamente, no índice de personas (personas.json):
  - rosto:          persona.assets.faces — múltiplas imagens de referência facial
  - kits de roupas: persona.visual.wardrobeKits — conjuntos nomeados de peças;
                    cada peça é uma imagem de persona.assets.wardrobe
  - cenários:       persona.visual.scenarios — setups completos que combinam
                    rosto + ambiente + kit de roupas, prontos para gerar vídeo
"""
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from server.core.persona_assets import list_assets
from server.core.persona_manager import (
    _ensure_default_persona,
    _load_index,
    _save_index,
    get_persona,
)

logger = logging.getLogger("odessa.persona_visual")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def _get_visual(index: Dict[str, Any], persona_id: str) -> Dict[str, Any]:
    persona = next((p for p in index.get("personas", []) if p.get("id") == persona_id), None)
    if persona is None:
        raise ValueError(f"Persona '{persona_id}' não encontrada")
    visual = persona.setdefault("visual", {})
    visual.setdefault("wardrobeKits", [])
    visual.setdefault("scenarios", [])
    return visual


def _existing_ids(persona_id: str, category: str) -> set:
    return {a["id"] for a in list_assets(persona_id, category)}


def _dedupe(ids: Optional[List[str]]) -> List[str]:
    return list(dict.fromkeys(ids or []))


def get_visual(persona_id: str) -> Dict[str, Any]:
    """Retorna kits e cenários, filtrando referências a imagens removidas."""
    if get_persona(persona_id) is None:
        raise ValueError(f"Persona '{persona_id}' não encontrada")
    index = _ensure_default_persona(_load_index())
    visual = _get_visual(index, persona_id)

    wardrobe_ids = _existing_ids(persona_id, "wardrobe")
    face_ids = _existing_ids(persona_id, "faces")
    env_ids = _existing_ids(persona_id, "environments")
    kit_ids = {k.get("id") for k in visual["wardrobeKits"]}

    kits = [
        {**k, "pieceIds": [p for p in k.get("pieceIds", []) if p in wardrobe_ids]}
        for k in visual["wardrobeKits"]
    ]
    scenarios = []
    for s in visual["scenarios"]:
        scenarios.append(
            {
                **s,
                "faceId": s.get("faceId") if s.get("faceId") in face_ids else None,
                "environmentId": s.get("environmentId") if s.get("environmentId") in env_ids else None,
                "wardrobeKitId": s.get("wardrobeKitId") if s.get("wardrobeKitId") in kit_ids else None,
            }
        )
    return {"wardrobeKits": kits, "scenarios": scenarios}


def create_wardrobe_kit(
    persona_id: str,
    name: str,
    description: str = "",
    piece_ids: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Cria um kit de roupas: conjunto nomeado de peças do guarda-roupa."""
    name = (name or "").strip()
    if not name:
        raise ValueError("Nome do kit é obrigatório")
    piece_ids = _dedupe(piece_ids)
    invalid = [p for p in piece_ids if p not in _existing_ids(persona_id, "wardrobe")]
    if invalid:
        raise ValueError(f"Peças não encontradas no guarda-roupa: {', '.join(invalid)}")

    index = _ensure_default_persona(_load_index())
    visual = _get_visual(index, persona_id)
    kit = {
        "id": _new_id("kit"),
        "name": name,
        "description": (description or "").strip(),
        "pieceIds": piece_ids,
        "createdAt": _now(),
    }
    visual["wardrobeKits"].append(kit)
    if not _save_index(index):
        raise RuntimeError("Falha ao salvar kit de roupas")
    logger.info("Kit '%s' criado para '%s' com %d peças", name, persona_id, len(piece_ids))
    return kit


def delete_wardrobe_kit(persona_id: str, kit_id: str) -> bool:
    """Remove um kit e limpa referências a ele nos cenários."""
    index = _ensure_default_persona(_load_index())
    visual = _get_visual(index, persona_id)
    before = len(visual["wardrobeKits"])
    visual["wardrobeKits"] = [k for k in visual["wardrobeKits"] if k.get("id") != kit_id]
    if len(visual["wardrobeKits"]) == before:
        return False
    for s in visual["scenarios"]:
        if s.get("wardrobeKitId") == kit_id:
            s["wardrobeKitId"] = None
    _save_index(index)
    return True


def _validate_scenario_refs(
    persona_id: str,
    visual: Dict[str, Any],
    face_id: Optional[str],
    environment_id: Optional[str],
    wardrobe_kit_id: Optional[str],
) -> None:
    if face_id and face_id not in _existing_ids(persona_id, "faces"):
        raise ValueError(f"Imagem de rosto '{face_id}' não encontrada")
    if environment_id and environment_id not in _existing_ids(persona_id, "environments"):
        raise ValueError(f"Imagem de ambiente '{environment_id}' não encontrada")
    if wardrobe_kit_id and wardrobe_kit_id not in {k.get("id") for k in visual["wardrobeKits"]}:
        raise ValueError(f"Kit de roupas '{wardrobe_kit_id}' não encontrado")


def create_scenario(
    persona_id: str,
    name: str,
    description: str = "",
    face_id: Optional[str] = None,
    environment_id: Optional[str] = None,
    wardrobe_kit_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Cria um cenário completo: rosto + ambiente + kit de roupas."""
    name = (name or "").strip()
    if not name:
        raise ValueError("Nome do cenário é obrigatório")
    index = _ensure_default_persona(_load_index())
    visual = _get_visual(index, persona_id)
    _validate_scenario_refs(persona_id, visual, face_id, environment_id, wardrobe_kit_id)
    scenario = {
        "id": _new_id("cen"),
        "name": name,
        "description": (description or "").strip(),
        "faceId": face_id or None,
        "environmentId": environment_id or None,
        "wardrobeKitId": wardrobe_kit_id or None,
        "createdAt": _now(),
    }
    visual["scenarios"].append(scenario)
    if not _save_index(index):
        raise RuntimeError("Falha ao salvar cenário")
    logger.info("Cenário '%s' criado para '%s'", name, persona_id)
    return scenario


def delete_scenario(persona_id: str, scenario_id: str) -> bool:
    """Remove um cenário."""
    index = _ensure_default_persona(_load_index())
    visual = _get_visual(index, persona_id)
    before = len(visual["scenarios"])
    visual["scenarios"] = [s for s in visual["scenarios"] if s.get("id") != scenario_id]
    if len(visual["scenarios"]) == before:
        return False
    _save_index(index)
    return True
