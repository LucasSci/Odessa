"""
video_gen.py — Endpoints do pipeline de geração de vídeo em tempo real.

Cobre captura de frame, geração de prompt, geração de vídeo, fila, histórico
e estado completo da live (para o painel em tempo real).
"""
import logging
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from server.config import VIDEO_FRAME_MAX_BYTES
from server.services.video_gen import storage

logger = logging.getLogger("odessa.routes.video_gen")

router = APIRouter(tags=["video-gen"])


def get_video_gen_service():
    from server.services.video_gen.video_gen_service import video_gen_service

    return video_gen_service


class FrameRequest(BaseModel):
    dataUrl: str
    personaId: Optional[str] = None


class PromptRequest(BaseModel):
    personaId: Optional[str] = None
    force: bool = False
    customInstruction: Optional[str] = None
    videoType: Optional[str] = None


class GenerateRequest(BaseModel):
    personaId: Optional[str] = None
    promptId: Optional[str] = None
    prompt: Optional[str] = None


class GenerateFromTemplateRequest(BaseModel):
    personaId: Optional[str] = None
    videoType: str
    action: str = ""


# ── Frame ──────────────────────────────────────────────────────────────────
@router.post("/frame")
async def save_frame(request: FrameRequest):
    """Recebe o frame base capturado (data URL) e o persiste por persona."""
    if not request.dataUrl:
        raise HTTPException(status_code=400, detail="dataUrl é obrigatório")
    if len(request.dataUrl) > VIDEO_FRAME_MAX_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Frame excede o limite de {VIDEO_FRAME_MAX_BYTES // (1024 * 1024)} MB",
        )
    path = storage.save_frame_from_data_url(request.dataUrl, persona_id=request.personaId)
    return {"ok": True, "path": str(path)}


@router.get("/frame")
async def get_frame(personaId: Optional[str] = None):
    """Retorna o último frame base capturado."""
    path = storage.get_latest_frame(personaId)
    if not path:
        raise HTTPException(status_code=404, detail="Nenhum frame capturado")
    media_type = "image/jpeg" if path.suffix.lower() in {".jpg", ".jpeg"} else "image/png"
    return FileResponse(path, media_type=media_type)


# ── Prompt ─────────────────────────────────────────────────────────────────
@router.post("/prompt")
async def generate_prompt(request: PromptRequest):
    """Gera um prompt de vídeo a partir do buffer de interações do chat."""
    result = get_video_gen_service().generate_prompt(
        request.personaId,
        force=request.force,
        custom_instruction=request.customInstruction,
        video_type=request.videoType,
    )
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error", "Falha ao gerar prompt"))
    return result


@router.get("/prompts")
async def list_prompts(personaId: Optional[str] = None):
    """Lista os prompts gerados (persistidos em prompts.jsonl)."""
    return {"prompts": storage.get_prompts(personaId)}


# ── Geração de vídeo ───────────────────────────────────────────────────────
@router.post("/generate")
async def generate_video(request: GenerateRequest):
    """Enfileira a geração de um vídeo a partir de um prompt + frame base."""
    service = get_video_gen_service()
    if request.promptId:
        prompts = storage.get_prompts(request.personaId)
        record = next((p for p in prompts if p.get("id") == request.promptId), None)
        if not record:
            raise HTTPException(status_code=404, detail="Prompt não encontrado")
        result = service.enqueue(record, persona_id=request.personaId)
    elif request.prompt:
        record = storage.append_prompt(
            {"personaId": request.personaId, "prompt": request.prompt, "source": "manual"},
            persona_id=request.personaId,
        )
        result = service.enqueue(record, persona_id=request.personaId)
    else:
        raise HTTPException(status_code=400, detail="Informe promptId ou prompt")
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error", "Falha ao enfileirar"))
    return result


@router.post("/generate-from-template")
async def generate_from_template(request: GenerateFromTemplateRequest):
    """Renderiza o template de uma persona para um tipo de vídeo e enfileira a geração.

    Permite produzir o mesmo vídeo com personas diferentes: basta trocar o
    personaId — o template é preenchido com os assets (rosto, ambiente, roupas)
    da persona especificada.
    """
    from server.core.persona_templates import render_template
    from server.core.persona_manager import get_active_persona_id

    pid = request.personaId or get_active_persona_id()
    try:
        prompt_text = render_template(pid, request.videoType, request.action)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Falha ao renderizar template: {exc}")

    record = storage.append_prompt(
        {
            "personaId": pid,
            "prompt": prompt_text,
            "videoType": request.videoType,
            "source": "template",
        },
        persona_id=pid,
    )
    result = get_video_gen_service().enqueue(record, persona_id=pid)
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error", "Falha ao enfileirar"))
    return {"ok": True, "prompt": prompt_text, "item": result.get("item")}


@router.get("/queue")
async def get_queue(personaId: Optional[str] = None):
    """Retorna a fila de vídeos pendentes/em geração."""
    return {"queue": get_video_gen_service().get_queue(personaId)}


@router.get("/history")
async def get_history(personaId: Optional[str] = None):
    """Retorna o histórico de gerações."""
    return {"history": storage.get_history(personaId)}


@router.get("/video/{video_id}")
async def serve_generated_video(video_id: str, personaId: Optional[str] = None):
    """Serve um vídeo gerado."""
    videos = storage.list_generated_videos(personaId)
    entry = next((v for v in videos if v.get("id") == video_id), None)
    if not entry:
        raise HTTPException(status_code=404, detail=f"Vídeo gerado '{video_id}' não encontrado")
    path = Path(entry["path"])
    media_type = "video/webm" if path.suffix.lower() == ".webm" else "video/mp4"
    return FileResponse(path, media_type=media_type)


# ── Estado completo ────────────────────────────────────────────────────────
@router.get("/state")
async def get_state(personaId: Optional[str] = None):
    """Estado completo do pipeline para o painel em tempo real."""
    return get_video_gen_service().get_state(personaId)
