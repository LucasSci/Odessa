import logging
from typing import Any, Tuple, List, Optional
from fastapi import HTTPException
from openai import OpenAI
from google import genai

from server.config import (
    OPENAI_API_KEY,
    GEMINI_API_KEY,
    OPENAI_TEXT_MODEL,
    OPENAI_BASE_URL,
    OLLAMA_BASE_URL,
    OLLAMA_MODEL,
    OLLAMA_TIMEOUT,
)

logger = logging.getLogger("odessa.ai")

class AIService:
    def __init__(self):
        self.openai_client = OpenAI(api_key=OPENAI_API_KEY, base_url=OPENAI_BASE_URL) if OPENAI_API_KEY else None
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

    def generate_ollama_text(
        self,
        system_prompt: str,
        user_prompt: str,
        temperature: float,
        *,
        model: str | None = None,
        base_url: str | None = None,
        json_mode: bool = False,
    ) -> str:
        """Gera texto via Ollama local usando a API nativa /api/chat."""
        import httpx

        url = (base_url or OLLAMA_BASE_URL).strip().rstrip("/")
        payload: dict[str, Any] = {
            "model": (model or OLLAMA_MODEL).strip(),
            "stream": False,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "options": {"temperature": temperature},
            # Mantém o modelo carregado na memória por mais tempo (padrão do
            # Ollama é ~5min). Numa live o chat pode ficar minutos sem gerar
            # nada; o modelo descarrega e a PRÓXIMA chamada precisa recarregar
            # do zero (10-30s p/ modelos de alguns GB) — essa fase de
            # carregamento intermitentemente derruba a conexão do httpx
            # (RemoteProtocolError / "Server disconnected without sending a
            # response") mesmo bem dentro do OLLAMA_TIMEOUT configurado; curl
            # com a mesma requisição não reproduz isso de forma confiável.
            # Um keep_alive maior reduz a frequência do cold-start em si.
            "keep_alive": "30m",
        }
        if json_mode:
            payload["format"] = "json"

        last_exc: Exception | None = None
        # Retry único: o disconnect intermitente acima acontece especificamente
        # durante o carregamento a frio — na segunda tentativa o modelo já está
        # total ou parcialmente carregado e a chamada tende a completar normal.
        for attempt in range(2):
            try:
                logger.info(
                    "[OLLAMA] chat request model=%s url=%s messages=%d temperature=%.2f attempt=%d/2",
                    payload["model"],
                    url,
                    len(payload["messages"]),
                    temperature,
                    attempt + 1,
                )
                with httpx.Client(timeout=OLLAMA_TIMEOUT) as client:
                    response = client.post(f"{url}/api/chat", json=payload)
                response.raise_for_status()
                data = response.json()
                text = ((data.get("message") or {}).get("content") or "").strip()
                if not text:
                    raise RuntimeError("Ollama retornou uma resposta vazia")
                logger.info("[OLLAMA] chat response model=%s chars=%d", payload["model"], len(text))
                return text
            except httpx.ConnectError as exc:
                raise RuntimeError(
                    f"Ollama indisponível em {url}. Inicie o Ollama e baixe o modelo {(model or OLLAMA_MODEL).strip()}."
                ) from exc
            except httpx.TimeoutException as exc:
                raise RuntimeError(
                    f"Ollama excedeu o timeout de {OLLAMA_TIMEOUT:g}s usando o modelo {(model or OLLAMA_MODEL).strip()}."
                ) from exc
            except httpx.RemoteProtocolError as exc:
                last_exc = exc
                logger.warning(
                    "[OLLAMA] Conexão derrubada durante carregamento do modelo (tentativa %d/2): %s",
                    attempt + 1,
                    exc,
                )
                continue
        raise RuntimeError(
            f"Ollama desconectou sem responder após 2 tentativas (modelo provavelmente ainda "
            f"carregando na memória): {last_exc}"
        ) from last_exc

    def generate_ai_text_with_fallback(
        self,
        *,
        gemini_model: str,
        system_prompt: str,
        user_prompt: str,
        temperature: float,
        json_mode: bool = False,
        local_model_url: str | None = None,
        local_model_name: str | None = None,
        provider: str | None = None,
    ) -> Tuple[str, str]:
        """
        AI Provider Router: Tries configured providers in order,
        then falls back to local simulation or neutral response.
        """
        from server.config import AI_PROVIDER, ENABLE_LOCAL_FALLBACK
        selected_provider = (provider or AI_PROVIDER).strip().lower()

        # Priority 1: Configured Provider
        providers_to_try = []
        if selected_provider in {"ollama", "local"}:
            providers_to_try = ["ollama", "gemini", "openai"]
        elif selected_provider == "gemini":
            providers_to_try = ["gemini", "openai"]
        elif selected_provider == "openai":
            providers_to_try = ["openai", "gemini"]
        else:
            providers_to_try = ["gemini", "openai"]

        errors: List[str] = []

        for provider in providers_to_try:
            if provider == "ollama":
                try:
                    text = self.generate_ollama_text(
                        system_prompt,
                        user_prompt,
                        temperature,
                        model=local_model_name,
                        base_url=local_model_url,
                        json_mode=json_mode,
                    )
                    if text.strip():
                        return text, "ollama"
                except Exception as exc:
                    logger.warning("[AI ROUTER] Ollama failed: %s", exc)
                    errors.append(f"Ollama: {exc}")

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
