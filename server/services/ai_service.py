import logging
from typing import Any, Tuple, List, Optional
from fastapi import HTTPException
from openai import OpenAI
from google import genai

from server.config import (
    OPENAI_API_KEY,
    GEMINI_API_KEY,
    OPENAI_TEXT_MODEL,
)

logger = logging.getLogger("odessa.ai")

class AIService:
    def __init__(self):
        self.openai_client = OpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None
        self.gemini_client = genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None
        
        if not self.openai_client and not self.gemini_client:
            logger.warning("No AI providers (OpenAI or Gemini) are configured!")

    def generate_openai_text(
        self,
        system_prompt: str,
        user_prompt: str,
        temperature: float,
        *,
        json_mode: bool = False,
    ) -> str:
        if not self.openai_client:
            raise RuntimeError("OPENAI_API_KEY is not configured on the backend")

        kwargs: dict[str, Any] = {
            "model": OPENAI_TEXT_MODEL,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": temperature,
        }
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}

        response = self.openai_client.chat.completions.create(**kwargs)
        return response.choices[0].message.content or ""

    def generate_ai_text_with_fallback(
        self,
        *,
        gemini_model: str,
        system_prompt: str,
        user_prompt: str,
        temperature: float,
        json_mode: bool = False,
    ) -> Tuple[str, str]:
        errors: List[str] = []

        if self.gemini_client:
            try:
                config: dict[str, Any] = {
                    "system_instruction": system_prompt,
                    "temperature": temperature,
                }
                if json_mode:
                    config["response_mime_type"] = "application/json"

                result = self.gemini_client.models.generate_content(
                    model=gemini_model,
                    contents=user_prompt,
                    config=config,
                )
                text = result.text or ""
                if not text.strip():
                    raise RuntimeError("Gemini returned an empty response")
                return text, "gemini"
            except Exception as exc:
                logger.warning("[GEMINI FALLBACK] %s", exc, exc_info=True)
                errors.append(f"Gemini: {exc}")
        else:
            errors.append("Gemini: GEMINI_API_KEY is not configured")

        if self.openai_client:
            try:
                text = self.generate_openai_text(
                    system_prompt,
                    user_prompt,
                    temperature,
                    json_mode=json_mode,
                )
                if not text.strip():
                    raise RuntimeError("OpenAI returned an empty response")
                return text, "openai"
            except Exception as exc:
                logger.error("[OPENAI FALLBACK EXCEPTION] %s", exc, exc_info=True)
                errors.append(f"OpenAI: {exc}")
        else:
            errors.append("OpenAI: OPENAI_API_KEY is not configured")

        status_code = 503 if not (self.gemini_client or self.openai_client) else 502
        raise HTTPException(status_code=status_code, detail="; ".join(errors))

# Singleton instance
ai_service = AIService()
