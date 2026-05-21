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
        """
        AI Provider Router: Tries configured providers in order,
        then falls back to local simulation or neutral response.
        """
        from server.config import AI_PROVIDER, ENABLE_LOCAL_FALLBACK

        # Priority 1: Configured Provider
        providers_to_try = []
        if AI_PROVIDER == "gemini":
            providers_to_try = ["gemini", "openai"]
        elif AI_PROVIDER == "openai":
            providers_to_try = ["openai", "gemini"]
        else:
            providers_to_try = ["gemini", "openai"]

        errors: List[str] = []

        for provider in providers_to_try:
            if provider == "gemini" and self.gemini_client:
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
                    if text.strip():
                        return text, "gemini"
                except Exception as exc:
                    logger.warning("[AI ROUTER] Gemini failed: %s", exc)
                    errors.append(f"Gemini: {exc}")

            if provider == "openai" and self.openai_client:
                try:
                    text = self.generate_openai_text(
                        system_prompt,
                        user_prompt,
                        temperature,
                        json_mode=json_mode,
                    )
                    if text.strip():
                        return text, "openai"
                except Exception as exc:
                    logger.warning("[AI ROUTER] OpenAI failed: %s", exc)
                    errors.append(f"OpenAI: {exc}")

        # Priority 2: Local Fallback / Simulated AI
        if ENABLE_LOCAL_FALLBACK:
            logger.info("[AI ROUTER] Falling back to local fallback.")
            return "Gente, adorei essa energia. Já já eu respondo melhor, continua comigo.", "local_fallback"

        # Final Fallback: Neutral Response
        return "Gente, adorei essa energia. Já já eu respondo melhor, continua comigo.", "neutral_last_resort"

# Singleton instance
ai_service = AIService()
