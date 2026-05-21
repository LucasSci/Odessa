import logging
import os
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from starlette.background import BackgroundTask

from server.config import (
    OPENAI_API_KEY,
    TTS_DEFAULT_PROVIDER,
    KOKORO_ENABLED,
)

router = APIRouter(tags=["TTS"])
logger = logging.getLogger("odessa.routes.tts")


def get_tts_service():
    from server.services.tts_service import tts_service

    return tts_service


def get_ai_service():
    from server.services.ai_service import ai_service

    return ai_service

@router.post("")
async def generate_tts_endpoint(request: Request):
    data = await request.json()
    text = data.get("text", "")
    provider = data.get("provider", TTS_DEFAULT_PROVIDER)
    voice = data.get("voice")
    speed = float(data.get("speed", 1.0))
    pitch = float(data.get("pitch", 0.0))

    try:
        service = get_tts_service()
        temp_path = await service.synthesize(
            text=text,
            provider=provider,
            voice=voice,
            speed=speed,
            pitch=pitch
        )

        if not temp_path:
            raise HTTPException(status_code=503, detail="TTS is disabled")

        if temp_path == "simulated_path":
            return JSONResponse(
                {
                    "status": "simulated",
                    "provider": provider,
                    "voice": voice or "",
                    "speed": speed,
                    "pitch": pitch,
                },
                headers={
                    "X-Odessa-TTS-Provider": provider,
                    "X-Odessa-TTS-Voice": voice or "",
                    "X-Odessa-TTS-Speed": str(speed),
                    "X-Odessa-TTS-Pitch": str(pitch),
                },
            )

        if not os.path.exists(temp_path):
            raise HTTPException(status_code=503, detail="TTS did not generate an audio file")

        media_type = "audio/wav" if provider == "kokoro" else "audio/mpeg"

        return FileResponse(
            temp_path,
            media_type=media_type,
            headers={
                "X-Odessa-TTS-Provider": provider,
                "X-Odessa-TTS-Voice": voice or "",
                "X-Odessa-TTS-Speed": str(speed),
                "X-Odessa-TTS-Pitch": str(pitch),
            },
            background=BackgroundTask(service.cleanup_temp_file, temp_path),
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("[TTS ROUTE EXCEPTION] %s", exc, exc_info=True)
        raise HTTPException(status_code=502, detail=str(exc)) from exc

@router.get("/voices")
def get_tts_voices():
    # This logic could be moved to tts_service, but keeping it simple for now
    tts_service = get_tts_service()
    ai_service = get_ai_service()
    return {
        "defaultProvider": TTS_DEFAULT_PROVIDER,
        "providers": {
            "edge": {"configured": True, "enabled": True},
            "openai": {"configured": bool(OPENAI_API_KEY), "enabled": bool(ai_service.openai_client)},
            "kokoro": {"configured": tts_service.kokoro_available(), "enabled": KOKORO_ENABLED},
        }
    }
