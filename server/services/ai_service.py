import logging
import mimetypes
from pathlib import Path
from typing import Any, Tuple, List, Optional
from fastapi import HTTPException
from openai import OpenAI
from google import genai

from server.services.ai_errors import AIUnavailableError

from server.config import (
    OPENAI_API_KEY,
    GEMINI_API_KEY,
    GEMINI_IMAGE_MODEL,
    ANTHROPIC_API_KEY,
    ANTHROPIC_MODEL,
    OPENAI_TEXT_MODEL,
    OPENAI_BASE_URL,
    OLLAMA_BASE_URL,
    OLLAMA_KEEP_ALIVE,
    OLLAMA_MODEL,
    OLLAMA_NUM_THREAD,
    OLLAMA_TIMEOUT,
)

logger = logging.getLogger("odessa.ai")

ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_API_VERSION = "2023-06-01"


class AIService:
    def __init__(self):
        self.openai_client = OpenAI(api_key=OPENAI_API_KEY, base_url=OPENAI_BASE_URL) if OPENAI_API_KEY else None
        self.gemini_client = genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None
        self.anthropic_api_key = ANTHROPIC_API_KEY or None

        if not self.openai_client and not self.gemini_client and not self.anthropic_api_key:
            logger.warning("No AI providers (OpenAI, Gemini or Claude) are configured!")

    def generate_claude_text(
        self,
        system_prompt: str,
        user_prompt: str,
        temperature: float,
        *,
        model: str | None = None,
        max_tokens: int = 1024,
    ) -> str:
        """Gera texto via Claude (Anthropic Messages API)."""
        import httpx

        if not self.anthropic_api_key:
            raise RuntimeError("ANTHROPIC_API_KEY não está configurada no backend")

        payload: dict[str, Any] = {
            "model": (model or ANTHROPIC_MODEL).strip(),
            "max_tokens": max_tokens,
            "temperature": temperature,
            "system": system_prompt,
            "messages": [{"role": "user", "content": user_prompt}],
        }
        headers = {
            "x-api-key": self.anthropic_api_key,
            "anthropic-version": ANTHROPIC_API_VERSION,
            "content-type": "application/json",
        }

        try:
            with httpx.Client(timeout=30.0) as client:
                response = client.post(ANTHROPIC_API_URL, json=payload, headers=headers)
            if response.status_code == 401:
                raise RuntimeError("Chave da Anthropic (ANTHROPIC_API_KEY) inválida ou revogada.")
            response.raise_for_status()
            data = response.json()
            blocks = data.get("content") or []
            text = "".join(block.get("text", "") for block in blocks if block.get("type") == "text").strip()
            if not text:
                raise RuntimeError("Claude retornou uma resposta vazia")
            return text
        except httpx.ConnectError as exc:
            raise RuntimeError("Não foi possível conectar à API da Anthropic.") from exc
        except httpx.TimeoutException as exc:
            raise RuntimeError("A API da Anthropic excedeu o tempo limite.") from exc
        except httpx.HTTPStatusError as exc:
            detail = exc.response.text[:200] if exc.response is not None else str(exc)
            raise RuntimeError(f"Claude retornou HTTP {exc.response.status_code}: {detail}") from exc

    def generate_gemini_image(
        self,
        prompt: str,
        *,
        reference_image_path: Path | None = None,
    ) -> bytes:
        """Gera uma imagem via Gemini (GEMINI_IMAGE_MODEL, ex.:
        gemini-2.5-flash-image). Fallback do provedor Higgsfield (que tem
        SoulId pra consistencia de personagem) pra quando so ha chave Gemini
        configurada. Levanta RuntimeError se o cliente nao estiver
        configurado ou a resposta nao trouxer nenhuma imagem.
        """
        if not self.gemini_client:
            raise RuntimeError("GEMINI_API_KEY não está configurada no backend")

        contents: list[Any] = []
        if reference_image_path is not None and Path(reference_image_path).exists():
            ref_path = Path(reference_image_path)
            mime_type = mimetypes.guess_type(str(ref_path))[0] or "image/png"
            contents.append(
                {"inline_data": {"mime_type": mime_type, "data": ref_path.read_bytes()}}
            )
        contents.append(prompt)

        result = self.gemini_client.models.generate_content(
            model=GEMINI_IMAGE_MODEL,
            contents=contents,
            config={"response_modalities": ["IMAGE"]},
        )

        for candidate in getattr(result, "candidates", None) or []:
            content = getattr(candidate, "content", None)
            for part in getattr(content, "parts", None) or []:
                inline_data = getattr(part, "inline_data", None)
                data = getattr(inline_data, "data", None)
                if data:
                    return data

        raise RuntimeError("Gemini não retornou nenhuma imagem")

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
        # num_predict limita o tamanho da geração — as respostas do chat já são
        # pedidas curtas (poucas frases), então 220 tokens só existe como teto
        # de segurança contra o modelo divagar e demorar mais que o necessário.
        # json_mode (decisões da Diretora) retorna um objeto maior, por isso
        # ganha um teto bem mais folgado em vez do mesmo limite do chat.
        num_predict = 700 if json_mode else 220
        payload: dict[str, Any] = {
            "model": (model or OLLAMA_MODEL).strip(),
            "stream": False,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            # repeat_penalty acima do padrão do Ollama (1.1) para reduzir o
            # modelo travando em repetição de palavras/frases dentro da mesma
            # resposta — sintoma relatado com respostas tipo "oi oi, legal legal".
            "options": {
                "temperature": temperature,
                "num_predict": num_predict,
                "repeat_penalty": 1.3,
                # Limita os núcleos usados (ver OLLAMA_NUM_THREAD em config.py).
                "num_thread": OLLAMA_NUM_THREAD,
            },
            # Mantém o modelo carregado na memória por mais tempo (padrão do
            # Ollama é ~5min). Numa live o chat pode ficar minutos sem gerar
            # nada; o modelo descarrega e a PRÓXIMA chamada precisa recarregar
            # do zero (10-30s p/ modelos de alguns GB) — essa fase de
            # carregamento intermitentemente derruba a conexão do httpx
            # (RemoteProtocolError / "Server disconnected without sending a
            # response") mesmo bem dentro do OLLAMA_TIMEOUT configurado; curl
            # com a mesma requisição não reproduz isso de forma confiável.
            # Um keep_alive maior reduz a frequência do cold-start em si — mas
            # segura GBs de RAM; 10 min cobre as pausas normais do chat.
            "keep_alive": OLLAMA_KEEP_ALIVE,
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
            providers_to_try = ["ollama", "claude", "gemini", "openai"]
        elif selected_provider == "claude":
            providers_to_try = ["claude", "gemini", "openai"]
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

            if provider == "claude" and self.anthropic_api_key:
                try:
                    text = self.generate_claude_text(
                        system_prompt,
                        user_prompt,
                        temperature,
                    )
                    if text.strip():
                        return text, "claude"
                except Exception as exc:
                    logger.warning("[AI ROUTER] Claude failed: %s", exc)
                    errors.append(f"Claude: {exc}")

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

        # Nenhum provedor respondeu. Antes devolvia uma fala pronta com HTTP 200,
        # o que fazia parecer que a IA estava funcionando (a Odessa repetia a
        # mesma frase e o diagnostico nao mostrava nada de errado). Agora o erro
        # sobe com o motivo de cada provedor; a frase pronta so sai se o operador
        # ligar ENABLE_LOCAL_FALLBACK de proposito.
        if not errors:
            errors.append(
                "Nenhum provedor de IA esta configurado ou disponivel "
                f"(tentados: {', '.join(providers_to_try)})."
            )
        if ENABLE_LOCAL_FALLBACK:
            logger.warning("[AI ROUTER] Todos os provedores falharam; usando fala pronta (ENABLE_LOCAL_FALLBACK): %s", errors)
            return "Gente, adorei essa energia. Já já eu respondo melhor, continua comigo.", "local_fallback"
        logger.error("[AI ROUTER] Todos os provedores falharam: %s", errors)
        raise AIUnavailableError(errors)

# Singleton instance
ai_service = AIService()


async def _live_session_active() -> bool:
    """Há live em andamento? (bridge do Tango conectada a uma aba)."""
    try:
        from server.services.bridge_manager import bridge_manager

        status = await bridge_manager.get_status()
        return ((status.get("bridgeStatus") or {}).get("status")) == "connected"
    except Exception:
        return False


async def ollama_keepalive_loop(interval_seconds: int = 5 * 60) -> None:
    """Mantém o modelo do Ollama carregado na memória em segundo plano.

    O modelo descarrega depois de OLLAMA_KEEP_ALIVE sem uso, e uma live pode
    ficar bastante tempo entre mensagens — a PRÓXIMA mensagem então paga um
    cold-start de 15-35s. O ping periódico evita isso, mas SÓ durante uma live
    (bridge do Tango conectada): antes o modelo (GBs de RAM) ficava carregado
    o tempo todo com o Odessa aberto, mesmo sem live, pesando no PC inteiro.
    """
    import asyncio
    import httpx
    from server.config import AI_PROVIDER, OLLAMA_BASE_URL, OLLAMA_KEEP_ALIVE, OLLAMA_MODEL

    if AI_PROVIDER not in ("ollama", "local"):
        return

    url = OLLAMA_BASE_URL.strip().rstrip("/")
    while True:
        if not await _live_session_active():
            await asyncio.sleep(interval_seconds)
            continue
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                await client.post(
                    f"{url}/api/generate",
                    json={"model": OLLAMA_MODEL, "prompt": "", "keep_alive": OLLAMA_KEEP_ALIVE},
                )
            logger.info("[OLLAMA] keep-alive ping ok (model=%s)", OLLAMA_MODEL)
        except Exception as exc:
            logger.info("[OLLAMA] keep-alive ping falhou (Ollama pode estar desligado): %s", exc)
        await asyncio.sleep(interval_seconds)
