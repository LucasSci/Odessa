"""
persona_photogen.py — Geração autônoma de uma foto nova da persona, parte
do protocolo de autoconfiguração via conversa (ver personaSelfConfig.ts).

Diferente de /selfconfig/apply (escrita síncrona rápida no índice), gerar
uma imagem não é instantâneo — pode levar de segundos a minutos, especialmente
no modelo de job assíncrono do Higgsfield (submit -> poll -> download). Por
isso este endpoint responde "queued" na hora e faz o trabalho de verdade numa
thread em segundo plano (mesmo padrão fire-and-forget que
video_gen_service já usa), pra não travar a resposta do chat esperando a
imagem terminar.
"""
import logging
import threading
import time
import uuid
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from server.config import MAX_GENERATED_PHOTOS, PHOTO_GEN_COOLDOWN_MS, PHOTO_GEN_PROVIDER
from server.core import persona_assets, persona_manager

logger = logging.getLogger("odessa.routes.persona_photogen")

router = APIRouter(tags=["personas"])

MAX_HISTORY = 50

_last_generation_at: Dict[str, float] = {}
_cooldown_lock = threading.Lock()


class GeneratePhotoRequest(BaseModel):
    prompt: str
    source: str = "conversation"


def _find_persona(index: Dict[str, Any], persona_id: str) -> Optional[Dict[str, Any]]:
    return next((p for p in index.get("personas", []) if p.get("id") == persona_id), None)


def _append_history(persona_id: str, *, applied: list[str]) -> None:
    index = persona_manager._ensure_default_persona(persona_manager._load_index())
    persona = _find_persona(index, persona_id)
    if persona is None:
        return
    history = persona.setdefault("selfConfigHistory", [])
    history.append(
        {
            "at": persona_manager._now(),
            "source": "photo-generation",
            "reason": "",
            "applied": applied,
        }
    )
    del history[:-MAX_HISTORY]
    persona_manager._save_index(index)


def _generate_image_bytes(persona_id: str, prompt: str) -> tuple[bytes, str]:
    """Retorna (bytes_da_imagem, nome_do_provedor_usado). Tenta Higgsfield
    (SoulId, consistência de personagem) quando configurado, com fallback
    automático pro Gemini — inclusive se o serviço do Higgsfield ainda não
    tiver sido implementado nesta instalação (ImportError)."""
    reference_path = None
    try:
        primary_face = persona_assets.get_primary_asset(persona_id, "faces")
        if primary_face:
            reference_path = persona_assets.get_asset_path(persona_id, "faces", primary_face["id"])
    except Exception:  # noqa: BLE001
        reference_path = None

    if PHOTO_GEN_PROVIDER == "higgsfield":
        try:
            from server.services.higgsfield_service import generate_character_photo

            return generate_character_photo(persona_id, prompt), "higgsfield"
        except ImportError:
            logger.warning("[photogen] PHOTO_GEN_PROVIDER=higgsfield mas higgsfield_service ainda não existe — usando Gemini")
        except Exception as exc:  # noqa: BLE001
            logger.warning("[photogen] Higgsfield falhou (%s) — tentando Gemini", exc)

    from server.services.ai_service import ai_service

    return ai_service.generate_gemini_image(prompt, reference_image_path=reference_path), "gemini"


def _generate_photo_background(persona_id: str, prompt: str, job_id: str) -> None:
    try:
        image_bytes, provider_used = _generate_image_bytes(persona_id, prompt)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[photogen] falha ao gerar foto para %s: %s", persona_id, exc)
        _append_history(persona_id, applied=[f"geração de foto falhou: {exc}"])
        return

    try:
        asset = persona_assets.save_asset(
            persona_id,
            "faces",
            image_bytes,
            filename=f"selfgen-{job_id}.png",
            label="Autogerada",
            generated=True,
            source=provider_used,
            prompt=prompt,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("[photogen] falha ao salvar foto gerada para %s: %s", persona_id, exc)
        _append_history(persona_id, applied=[f"foto gerada mas falhou ao salvar: {exc}"])
        return

    index = persona_manager._ensure_default_persona(persona_manager._load_index())
    persona = _find_persona(index, persona_id)
    if persona is not None:
        persona["avatarUrl"] = f"/api/v1/personas/{persona_id}/assets/faces/{asset['id']}"
        history = persona.setdefault("selfConfigHistory", [])
        history.append(
            {
                "at": persona_manager._now(),
                "source": "photo-generation",
                "reason": "",
                "applied": [f"nova foto autogerada ({provider_used}), avatar atualizado"],
            }
        )
        del history[:-MAX_HISTORY]
        persona_manager._save_index(index)
    logger.info("[photogen] foto gerada para %s via %s (asset=%s)", persona_id, provider_used, asset["id"])


@router.post("/{persona_id}/selfconfig/generate-photo")
def generate_photo(persona_id: str, request: GeneratePhotoRequest):
    """Dispara a geração de uma foto nova da persona em segundo plano."""
    index = persona_manager._ensure_default_persona(persona_manager._load_index())
    persona = _find_persona(index, persona_id)
    if persona is None:
        raise HTTPException(status_code=404, detail=f"Persona '{persona_id}' não encontrada")

    prompt = (request.prompt or "").strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="prompt é obrigatório")

    now_ms = time.time() * 1000
    with _cooldown_lock:
        last = _last_generation_at.get(persona_id, 0.0)
        if now_ms - last < PHOTO_GEN_COOLDOWN_MS:
            return {"ok": False, "status": "cooldown"}

        faces = (persona.get("assets") or {}).get("faces", [])
        generated_count = sum(1 for a in faces if a.get("generated"))
        if generated_count >= MAX_GENERATED_PHOTOS:
            return {"ok": False, "status": "max_reached"}

        _last_generation_at[persona_id] = now_ms

    job_id = uuid.uuid4().hex[:12]
    thread = threading.Thread(
        target=_generate_photo_background,
        args=(persona_id, prompt, job_id),
        daemon=True,
        name="persona-photogen",
    )
    thread.start()
    return {"ok": True, "status": "queued", "jobId": job_id}
