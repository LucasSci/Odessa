import json
import logging

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Dict, List, Optional

from server.core import persona_manager
from server.core import persona_visual
from server.core.config_manager import load_persona_config, save_persona_config
from server.core.persona_assets import (
    list_assets,
    save_asset,
    delete_asset,
    get_asset_path,
    update_asset_label,
    get_all_asset_urls,
    VALID_CATEGORIES,
    MAX_IMAGE_BYTES,
)
from server.core.persona_templates import (
    get_templates,
    save_templates,
    render_template,
    detect_video_type,
    VIDEO_TYPES,
    get_default_templates,
)

logger = logging.getLogger("odessa.routes.personas")

router = APIRouter(tags=["personas"])


class PersonaCreateRequest(BaseModel):
    id: str | None = None
    name: str
    description: str = ""
    personality: str = ""
    avatarUrl: str = ""


class PersonaUpdateRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    personality: str | None = None
    avatarUrl: str | None = None


class PersonaActiveRequest(BaseModel):
    id: str


class AssetLabelRequest(BaseModel):
    label: str


class TemplateUpdateRequest(BaseModel):
    templates: Dict[str, Dict[str, str]]


class TemplateRenderRequest(BaseModel):
    videoType: str
    action: str = ""


class WardrobeKitRequest(BaseModel):
    name: str
    description: str = ""
    pieceIds: List[str] = []


class ScenarioRequest(BaseModel):
    name: str
    description: str = ""
    faceId: Optional[str] = None
    environmentId: Optional[str] = None
    wardrobeKitId: Optional[str] = None


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
    if request.avatarUrl is not None:
        persona["avatarUrl"] = request.avatarUrl
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
    with open(config_path, "r", encoding="utf-8") as f:
        config = json.load(f)
    return {"persona": persona, "config": config}


# ── Assets (rostos, ambientes, roupas) ─────────────────────────────────────

@router.get("/{persona_id}/assets")
async def get_all_assets(persona_id: str):
    """Retorna todas as imagens de todas as categorias da persona."""
    if persona_manager.get_persona(persona_id) is None:
        raise HTTPException(status_code=404, detail=f"Persona '{persona_id}' não encontrada")
    return {"assets": get_all_asset_urls(persona_id)}


@router.get("/{persona_id}/assets/{category}")
async def list_category_assets(persona_id: str, category: str):
    """Lista as imagens de uma categoria específica."""
    if persona_manager.get_persona(persona_id) is None:
        raise HTTPException(status_code=404, detail=f"Persona '{persona_id}' não encontrada")
    if category not in VALID_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Categoria inválida: '{category}'")
    items = list_assets(persona_id, category)
    for item in items:
        item["url"] = f"/api/v1/personas/{persona_id}/assets/{category}/{item['id']}"
    return {"assets": items}


@router.post("/{persona_id}/assets/{category}")
async def upload_asset(
    persona_id: str,
    category: str,
    file: UploadFile = File(...),
    label: str = Form(""),
):
    """Faz upload de uma imagem para uma categoria da persona."""
    if persona_manager.get_persona(persona_id) is None:
        raise HTTPException(status_code=404, detail=f"Persona '{persona_id}' não encontrada")
    if category not in VALID_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Categoria inválida: '{category}'")
    data = await file.read()
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail=f"Imagem excede o limite de {MAX_IMAGE_BYTES // (1024 * 1024)} MB")
    try:
        record = save_asset(persona_id, category, data, file.filename or "upload.png", label)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    record["url"] = f"/api/v1/personas/{persona_id}/assets/{category}/{record['id']}"
    return {"ok": True, "asset": record}


@router.get("/{persona_id}/assets/{category}/{image_id}")
async def serve_asset(persona_id: str, category: str, image_id: str):
    """Serve o arquivo de imagem de uma persona."""
    if category not in VALID_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Categoria inválida: '{category}'")
    path = get_asset_path(persona_id, category, image_id)
    if path is None:
        raise HTTPException(status_code=404, detail="Imagem não encontrada")
    ext = path.suffix.lower()
    media_type = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".gif": "image/gif",
    }.get(ext, "application/octet-stream")
    return FileResponse(path, media_type=media_type)


@router.patch("/{persona_id}/assets/{category}/{image_id}")
async def rename_asset(persona_id: str, category: str, image_id: str, request: AssetLabelRequest):
    """Atualiza o label de uma imagem."""
    if category not in VALID_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Categoria inválida: '{category}'")
    record = update_asset_label(persona_id, category, image_id, request.label)
    if record is None:
        raise HTTPException(status_code=404, detail="Imagem não encontrada")
    return {"ok": True, "asset": record}


@router.delete("/{persona_id}/assets/{category}/{image_id}")
async def remove_asset(persona_id: str, category: str, image_id: str):
    """Remove uma imagem da persona."""
    if category not in VALID_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Categoria inválida: '{category}'")
    if not delete_asset(persona_id, category, image_id):
        raise HTTPException(status_code=404, detail="Imagem não encontrada")
    return {"ok": True}


# ── Templates de prompt por tipo de vídeo ──────────────────────────────────

@router.get("/{persona_id}/templates")
async def get_persona_templates(persona_id: str):
    """Retorna os templates de prompt por tipo de vídeo da persona."""
    if persona_manager.get_persona(persona_id) is None:
        raise HTTPException(status_code=404, detail=f"Persona '{persona_id}' não encontrada")
    return {"templates": get_templates(persona_id), "videoTypes": VIDEO_TYPES}


@router.put("/{persona_id}/templates")
async def update_persona_templates(persona_id: str, request: TemplateUpdateRequest):
    """Atualiza os templates de prompt da persona."""
    if persona_manager.get_persona(persona_id) is None:
        raise HTTPException(status_code=404, detail=f"Persona '{persona_id}' não encontrada")
    try:
        saved = save_templates(persona_id, request.templates)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    return {"ok": True, "templates": saved}


@router.post("/{persona_id}/templates/render")
async def render_persona_template(persona_id: str, request: TemplateRenderRequest):
    """Renderiza um template preenchendo os placeholders com os assets da persona."""
    if persona_manager.get_persona(persona_id) is None:
        raise HTTPException(status_code=404, detail=f"Persona '{persona_id}' não encontrada")
    if request.videoType not in VIDEO_TYPES:
        raise HTTPException(status_code=400, detail=f"Tipo de vídeo inválido: '{request.videoType}'")
    prompt = render_template(persona_id, request.videoType, request.action)
    return {"ok": True, "prompt": prompt, "videoType": request.videoType}


@router.get("/meta/video-types")
async def get_video_types():
    """Retorna os tipos de vídeo suportados e os templates padrão."""
    return {"videoTypes": VIDEO_TYPES, "defaults": get_default_templates()}


# ── Estrutura visual: kits de roupas e cenários ─────────────────────────────

@router.get("/{persona_id}/visual")
async def get_persona_visual(persona_id: str):
    """Retorna os kits de roupas e cenários da persona."""
    if persona_manager.get_persona(persona_id) is None:
        raise HTTPException(status_code=404, detail=f"Persona '{persona_id}' não encontrada")
    try:
        return persona_visual.get_visual(persona_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/{persona_id}/visual/wardrobe-kits")
async def create_persona_wardrobe_kit(persona_id: str, request: WardrobeKitRequest):
    """Cria um kit de roupas: conjunto nomeado de peças do guarda-roupa."""
    if persona_manager.get_persona(persona_id) is None:
        raise HTTPException(status_code=404, detail=f"Persona '{persona_id}' não encontrada")
    try:
        kit = persona_visual.create_wardrobe_kit(
            persona_id, request.name, request.description, request.pieceIds
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    return {"ok": True, "kit": kit}


@router.delete("/{persona_id}/visual/wardrobe-kits/{kit_id}")
async def remove_persona_wardrobe_kit(persona_id: str, kit_id: str):
    """Remove um kit de roupas e limpa referências a ele nos cenários."""
    if persona_manager.get_persona(persona_id) is None:
        raise HTTPException(status_code=404, detail=f"Persona '{persona_id}' não encontrada")
    if not persona_visual.delete_wardrobe_kit(persona_id, kit_id):
        raise HTTPException(status_code=404, detail="Kit de roupas não encontrado")
    return {"ok": True}


@router.post("/{persona_id}/visual/scenarios")
async def create_persona_scenario(persona_id: str, request: ScenarioRequest):
    """Cria um cenário completo: rosto + ambiente + kit de roupas."""
    if persona_manager.get_persona(persona_id) is None:
        raise HTTPException(status_code=404, detail=f"Persona '{persona_id}' não encontrada")
    try:
        scenario = persona_visual.create_scenario(
            persona_id,
            request.name,
            request.description,
            request.faceId,
            request.environmentId,
            request.wardrobeKitId,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    return {"ok": True, "scenario": scenario}


@router.delete("/{persona_id}/visual/scenarios/{scenario_id}")
async def remove_persona_scenario(persona_id: str, scenario_id: str):
    """Remove um cenário."""
    if persona_manager.get_persona(persona_id) is None:
        raise HTTPException(status_code=404, detail=f"Persona '{persona_id}' não encontrada")
    if not persona_visual.delete_scenario(persona_id, scenario_id):
        raise HTTPException(status_code=404, detail="Cenário não encontrado")
    return {"ok": True}
