from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from server.core import persona_manager
from server.core.config_manager import load_persona_config, save_persona_config


router = APIRouter(tags=["personas"])


class PersonaCreateRequest(BaseModel):
    id: str | None = None
    name: str
    description: str = ""
    personality: str = ""


class PersonaUpdateRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    personality: str | None = None


class PersonaActiveRequest(BaseModel):
    id: str


@router.get("")
async def list_personas():
    """Lista todas as personas e qual é a ativa."""
    return {
        "activePersonaId": persona_manager.get_active_persona_id(),
        "personas": persona_manager.list_personas(),
    }


@router.get("/active")
async def get_active_persona():
    """Retorna a persona ativa e sua config completa."""
    persona = persona_manager.get_active_persona()
    config = load_persona_config()
    return {"persona": persona, "config": config}


@router.post("/active")
async def set_active_persona(request: PersonaActiveRequest):
    """Define a persona ativa."""
    persona_id = request.id
    if not persona_manager.set_active_persona(persona_id):
        raise HTTPException(status_code=404, detail=f"Persona '{persona_id}' não encontrada")
    return {
        "ok": True,
        "activePersonaId": persona_manager.get_active_persona_id(),
        "persona": persona_manager.get_active_persona(),
    }


@router.post("")
async def create_persona(request: PersonaCreateRequest):
    """Cria uma nova persona com config vazia."""
    try:
        persona = persona_manager.create_persona(request.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return {"ok": True, "persona": persona}


@router.patch("/{persona_id}")
async def update_persona(persona_id: str, request: PersonaUpdateRequest):
    """Atualiza metadados de uma persona (nome/descrição/personalidade)."""
    index = persona_manager._load_index()
    persona = next((p for p in index.get("personas", []) if p.get("id") == persona_id), None)
    if persona is None:
        raise HTTPException(status_code=404, detail=f"Persona '{persona_id}' não encontrada")
    if request.name is not None:
        persona["name"] = request.name
    if request.description is not None:
        persona["description"] = request.description
    if request.personality is not None:
        persona["personality"] = request.personality
    if not persona_manager._save_index(index):
        raise HTTPException(status_code=500, detail="Falha ao salvar índice de personas")
    return {"ok": True, "persona": persona}


@router.get("/active/personality")
async def get_active_personality():
    """Retorna a personalidade (prompt de sistema) da persona ativa."""
    return {
        "personaId": persona_manager.get_active_persona_id(),
        "personality": persona_manager.get_persona_personality(),
    }


@router.put("/{persona_id}/personality")
async def set_personality(persona_id: str, request: PersonaUpdateRequest):
    """Define a personalidade (prompt de sistema) de uma persona."""
    if request.personality is None:
        raise HTTPException(status_code=400, detail="Campo 'personality' é obrigatório")
    if not persona_manager.set_persona_personality(persona_id, request.personality):
        raise HTTPException(status_code=404, detail=f"Persona '{persona_id}' não encontrada")
    return {
        "ok": True,
        "personaId": persona_id,
        "personality": persona_manager.get_persona_personality(persona_id),
    }


@router.delete("/{persona_id}")
async def delete_persona(persona_id: str):
    """Exclui uma persona (exceto a padrão)."""
    try:
        ok = persona_manager.delete_persona(persona_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if not ok:
        raise HTTPException(status_code=404, detail=f"Persona '{persona_id}' não encontrada")
    return {"ok": True, "activePersonaId": persona_manager.get_active_persona_id()}


@router.get("/{persona_id}/config")
async def get_persona_config(persona_id: str):
    """Retorna a config de uma persona específica."""
    persona = persona_manager.get_persona(persona_id)
    if persona is None:
        raise HTTPException(status_code=404, detail=f"Persona '{persona_id}' não encontrada")
    config_path = persona_manager.get_persona_config_path(persona_id)
    if not config_path.exists():
        return {"persona": persona, "config": {}}
    import json

    with open(config_path, "r", encoding="utf-8") as f:
        config = json.load(f)
    return {"persona": persona, "config": config}
