"""
persona_selfconfig.py — Autoconfiguração de personas através da conversa.

A persona conversa no PersonaChatLab e pode emitir diretivas de autoconfiguração
(nome, descrição, avatar/imagem, traços de personalidade aprendidos). Este
router aplica essas mudanças no índice de personas e registra um histórico,
permitindo que a personalidade evolua conforme a persona é usada.
"""
import logging
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from server.core import persona_manager

logger = logging.getLogger("odessa.routes.persona_selfconfig")

router = APIRouter(tags=["personas"])

MAX_TRAITS = 25
MAX_HISTORY = 50
TRAIT_MARKER = "## Traços que evoluí conversando"


class SelfConfigChanges(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    avatarUrl: Optional[str] = None
    face_id: Optional[str] = None
    personality_add: Optional[str] = None


class SelfConfigApplyRequest(BaseModel):
    changes: SelfConfigChanges
    source: str = "conversation"
    reason: str = ""


def _split_personality(personality: str) -> Tuple[str, List[str]]:
    """Separa a personalidade base dos traços evoluídos (bullets sob o marcador)."""
    marker = f"\n\n{TRAIT_MARKER}:"
    if marker in personality:
        base, _, block = personality.partition(marker)
        traits = [
            line[2:].strip()
            for line in block.strip().splitlines()
            if line.strip().startswith("- ")
        ]
        return base.rstrip(), traits
    return personality, []


def _compose_personality(base: str, traits: List[str]) -> str:
    if not traits:
        return base
    block = "\n".join(f"- {t}" for t in traits)
    return f"{base}\n\n{TRAIT_MARKER}:\n{block}"


def _find_persona(index: Dict[str, Any], persona_id: str) -> Optional[Dict[str, Any]]:
    return next(
        (p for p in index.get("personas", []) if p.get("id") == persona_id), None
    )


@router.post("/{persona_id}/selfconfig/apply")
def apply_self_config(persona_id: str, request: SelfConfigApplyRequest):
    """Aplica mudanças de autoconfiguração emitidas pela persona na conversa."""
    index = persona_manager._ensure_default_persona(persona_manager._load_index())
    persona = _find_persona(index, persona_id)
    if persona is None:
        raise HTTPException(status_code=404, detail=f"Persona '{persona_id}' não encontrada")

    changes = request.changes
    applied: List[str] = []

    if changes.name and changes.name.strip():
        persona["name"] = changes.name.strip()
        applied.append("nome atualizado")

    if changes.description and changes.description.strip():
        persona["description"] = changes.description.strip()
        applied.append("descrição atualizada")

    if changes.avatarUrl and changes.avatarUrl.strip():
        persona["avatarUrl"] = changes.avatarUrl.strip()
        applied.append("avatar atualizado")

    # Avatar por asset de rosto enviado (tem prioridade sobre URL direta).
    if changes.face_id and changes.face_id.strip():
        face_id = changes.face_id.strip()
        faces = (persona.get("assets") or {}).get("faces") or []
        if not any(a.get("id") == face_id for a in faces):
            raise HTTPException(
                status_code=400,
                detail=f"Imagem de rosto '{face_id}' não existe nesta persona",
            )
        persona["avatarUrl"] = f"/api/v1/personas/{persona_id}/assets/faces/{face_id}"
        applied.append(f"avatar definido para a imagem '{face_id}'")

    if changes.personality_add and changes.personality_add.strip():
        trait = " ".join(changes.personality_add.split())
        base, traits = _split_personality(str(persona.get("personality") or ""))
        existing = [t.lower() for t in traits]
        if trait.lower() not in existing:
            traits.append(trait)
            if len(traits) > MAX_TRAITS:
                traits = traits[-MAX_TRAITS:]
            persona["personality"] = _compose_personality(base, traits)
            applied.append(f"personalidade evoluída: {trait}")
        else:
            applied.append("personalidade: traço já existente (ignorado)")

    if applied:
        history = persona.setdefault("selfConfigHistory", [])
        history.append(
            {
                "at": persona_manager._now(),
                "source": request.source,
                "reason": request.reason,
                "applied": applied,
            }
        )
        del history[:-MAX_HISTORY]
        if not persona_manager._save_index(index):
            raise HTTPException(status_code=500, detail="Falha ao salvar índice de personas")
        logger.info(
            "[selfconfig] persona=%s source=%s applied=%s",
            persona_id,
            request.source,
            applied,
        )

    return {"ok": True, "persona": persona, "applied": applied}


@router.get("/{persona_id}/selfconfig/history")
def get_self_config_history(persona_id: str):
    """Retorna o histórico de autoconfigurações aplicadas à persona."""
    index = persona_manager._ensure_default_persona(persona_manager._load_index())
    persona = _find_persona(index, persona_id)
    if persona is None:
        raise HTTPException(status_code=404, detail=f"Persona '{persona_id}' não encontrada")
    return {"history": persona.get("selfConfigHistory", [])}
