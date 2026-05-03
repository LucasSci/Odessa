import logging
import os
import tempfile
import asyncio
from typing import Optional, Dict, Any, List

import edge_tts
import numpy as np
from fastapi import HTTPException
from starlette.background import BackgroundTask

from server.config import (
    OPENAI_API_KEY,
    OPENAI_TTS_MODEL,
    TTS_DEFAULT_PROVIDER,
    KOKORO_ENABLED,
    KOKORO_DEFAULT_VOICE,
)
from server.core.constants import (
    OPENAI_TTS_VOICES,
    KOKORO_VOICES,
    KOKORO_DISABLED_LANGS,
)
from server.services.ai_service import ai_service

logger = logging.getLogger("odessa.tts")

class TTSService:
    def __init__(self):
        self.openai_client = ai_service.openai_client
        self._kokoro_pipeline = None

    def package_installed(self, package_name: str) -> bool:
        import importlib.util
        return importlib.util.find_spec(package_name) is not None

    def espeak_ng_path(self) -> Optional[str]:
        import shutil
        return shutil.which("espeak-ng")

    def kokoro_available(self) -> bool:
        return KOKORO_ENABLED and self.package_installed("kokoro") and self.espeak_ng_path() is not None

    def get_kokoro_pipeline(self):
        if not self._kokoro_pipeline and self.kokoro_available():
            try:
                from kokoro import KPipeline
                self._kokoro_pipeline = KPipeline(lang_code="b")
            except Exception as exc:
                logger.error("[KOKORO INITIALIZATION FAILED] %s", exc)
        return self._kokoro_pipeline

    def edge_rate_from_speed(self, speed: float) -> str:
        rate = int((speed - 1.0) * 100)
        return f"{rate:+d}%"

    def edge_pitch_from_value(self, pitch: float) -> str:
        p = int(pitch * 10)
        return f"{p:+d}Hz"

    def generate_kokoro_wav(self, text: str, voice: str, speed: float, output_path: str) -> None:
        pipeline = self.get_kokoro_pipeline()
        if not pipeline:
            raise RuntimeError("Kokoro pipeline not available")
        
        try:
            import soundfile as sf
            # Note: Kokoro returns generator of (graphemes, phonemes, audio)
            generator = pipeline(text, voice=voice, speed=speed, split_pattern=r"\n+")
            full_audio = []
            for _, _, audio in generator:
                if audio is not None:
                    full_audio.append(audio)
            
            if full_audio:
                combined = np.concatenate(full_audio)
                sf.write(output_path, combined, 24000)
            else:
                raise RuntimeError("Kokoro generated no audio")
        except Exception as exc:
            logger.error("[KOKORO GENERATION EXCEPTION] %s", exc)
            raise

    async def synthesize(
        self,
        text: str,
        provider: str = "edge",
        voice: Optional[str] = None,
        speed: float = 1.0,
        pitch: float = 0.0
    ) -> str:
        """Synthesize text to speech and return path to temporary file."""
        if not text:
            raise HTTPException(status_code=400, detail="No text provided")

        if provider == "openai":
            if not self.openai_client:
                raise HTTPException(status_code=503, detail="OpenAI TTS not configured")
            if voice not in OPENAI_TTS_VOICES:
                voice = "nova"
        elif provider == "kokoro":
            if not self.kokoro_available():
                raise HTTPException(status_code=503, detail="Kokoro TTS not ready")
            if voice not in KOKORO_VOICES:
                voice = KOKORO_DEFAULT_VOICE
        
        suffix = ".wav" if provider == "kokoro" else ".mp3"
        temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
        temp_path = temp_file.name
        temp_file.close()

        try:
            if provider == "openai":
                response = self.openai_client.audio.speech.create(
                    model=OPENAI_TTS_MODEL,
                    voice=voice,
                    input=text,
                    speed=speed,
                )
                response.stream_to_file(temp_path)
            elif provider == "kokoro":
                self.generate_kokoro_wav(text, voice, speed, temp_path)
            else:
                communicate = edge_tts.Communicate(
                    text,
                    voice or "pt-BR-FranciscaNeural",
                    rate=self.edge_rate_from_speed(speed),
                    pitch=self.edge_pitch_from_value(pitch),
                )
                await communicate.save(temp_path)
            
            return temp_path
        except Exception as exc:
            if os.path.exists(temp_path):
                os.unlink(temp_path)
            logger.error("[TTS SERVICE EXCEPTION] %s", exc, exc_info=True)
            raise HTTPException(status_code=502, detail=str(exc)) from exc

    def cleanup_temp_file(self, path: str):
        try:
            if os.path.exists(path):
                os.unlink(path)
                logger.debug("Cleaned up temp file: %s", path)
        except Exception as exc:
            logger.error("Error cleaning up temp file %s: %s", path, exc)

# Singleton instance
tts_service = TTSService()
