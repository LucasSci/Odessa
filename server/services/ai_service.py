import logging
import mimetypes
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Tuple, List, Optional
from fastapi import HTTPException
import importlib

# Os SDKs da OpenAI e do Google só carregam quando uma IA da nuvem é usada.
# Importar o da OpenAI levava 46 s no PC da live (milhares de arquivos de
# tipos) e acontecia na partida do servidor, mesmo com a IA local (Ollama):
# a janela do Odessa ficava quase 1 min esperando.


def OpenAI(*args: Any, **kwargs: Any):  # noqa: N802 — mesmo nome da classe do SDK
    from openai import OpenAI as _OpenAI

    return _OpenAI(*args, **kwargs)


class _LazyModule:
    def __init__(self, name: str) -> None:
        self._name = name

    def __getattr__(self, attr: str) -> Any:
        return getattr(importlib.import_module(self._name), attr)


genai = _LazyModule("google.genai")

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
    MISTRAL_API_KEY,
    MISTRAL_MODEL,
)

logger = logging.getLogger("odessa.ai")

ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_API_VERSION = "2023-06-01"


MAX_CONVERSATION_TURNS = 16

# Quando o operador troca para uma IA de nuvem (Gemini/Mistral), a IA local é
# desligada: o modelo sai da memória e o keep-alive para de recarregá-lo. Volta
# sozinha na próxima resposta pedida ao Ollama.
_local_ai_paused = False


def pause_local_ai() -> None:
    global _local_ai_paused
    _local_ai_paused = True


def local_ai_paused() -> bool:
    return _local_ai_paused


# ── Uma conexão só com o Ollama ─────────────────────────────────────────────
# Antes cada geração abria um httpx.Client novo. Criar o cliente monta um
# contexto SSL (no Windows isso lê o repositório de certificados): era a função
# mais quente do servidor numa live simulada.
_http_lock = threading.Lock()
_ollama_http: Any = None


def _ollama_client() -> Any:
    global _ollama_http
    import httpx

    with _http_lock:
        if _ollama_http is None:
            from server.core.http_clients import shared_ssl_context

            _ollama_http = httpx.Client(timeout=OLLAMA_TIMEOUT, verify=shared_ssl_context())
        return _ollama_http


def close_http_clients() -> None:
    global _ollama_http
    with _http_lock:
        client, _ollama_http = _ollama_http, None
    close = getattr(client, "close", None)
    if callable(close):
        close()


def reset_local_ai_state() -> None:
    """Volta ao estado de quem acabou de abrir (usado entre testes)."""
    close_http_clients()
    _preferred_local.update(model=None, url=None)


# ── Um modelo só ────────────────────────────────────────────────────────────
# O chat manda o modelo escolhido na tela de IA; o que roda em segundo plano
# (prompt de vídeo, memória) usava o padrão do servidor. Com modelos diferentes
# o Ollama descarregava um e carregava o outro (~3 GB) a cada troca: 28 trocas
# em 40 min numa live simulada. Agora o fundo usa o último modelo do chat.
_preferred_local: dict[str, Optional[str]] = {"model": None, "url": None}


def remember_local_model(model: Optional[str], url: Optional[str]) -> None:
    if (model or "").strip():
        _preferred_local["model"] = model.strip()
        _preferred_local["url"] = (url or "").strip() or None


# ── Fila da IA local ────────────────────────────────────────────────────────
# O Ollama gera uma resposta por vez. Sem fila, o chat esperava atrás do prompt
# de vídeo e da memória. Agora há uma vez por geração, com prioridade:
# chat > memória > fundo. Quem espera demais desiste (o chat não responde uma
# mensagem de 1 min atrás; o fundo tenta na próxima).
PRIORITY_LEVELS = {"chat": 0, "memory": 1, "background": 2}
MAX_WAIT_S = {0: 45.0, 1: 90.0, 2: 120.0}


class LocalAiBusy(RuntimeError):
    pass


class LocalAiGate:
    def __init__(self) -> None:
        self._cond = threading.Condition()
        self._busy = False
        self._waiting = [0, 0, 0]

    @contextmanager
    def slot(self, priority: str = "chat", max_wait_s: Optional[float] = None):
        level = PRIORITY_LEVELS.get(priority, 0)
        deadline = time.monotonic() + (MAX_WAIT_S[level] if max_wait_s is None else max_wait_s)
        with self._cond:
            self._waiting[level] += 1
            try:
                while self._busy or any(self._waiting[higher] for higher in range(level)):
                    left = deadline - time.monotonic()
                    if left <= 0:
                        raise LocalAiBusy(f"IA local ocupada (prioridade {priority}): pedido descartado")
                    self._cond.wait(left)
                self._busy = True
            finally:
                self._waiting[level] -= 1
                self._cond.notify_all()
        try:
            yield
        finally:
            with self._cond:
                self._busy = False
                self._cond.notify_all()


local_ai_gate = LocalAiGate()


def _conversation_turns(conversation: list[dict[str, str]] | None) -> list[dict[str, str]]:
    """Valida a conversa: só user/assistant com texto, últimos turnos, termina em user."""
    turns = [
        {"role": turn["role"], "content": str(turn["content"]).strip()}
        for turn in (conversation or [])
        if isinstance(turn, dict) and turn.get("role") in ("user", "assistant") and str(turn.get("content") or "").strip()
    ][-MAX_CONVERSATION_TURNS:]
    while turns and turns[0]["role"] != "user":
        turns.pop(0)
    if not turns or turns[-1]["role"] != "user":
        return []
    return turns


def _chat_messages(conversation: list[dict[str, str]] | None, user_prompt: str) -> list[dict[str, str]]:
    """Mesma conversa para TODA IA: turnos reais quando houver, senão o prompt único."""
    return _conversation_turns(conversation) or [{"role": "user", "content": user_prompt}]


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
        conversation: list[dict[str, str]] | None = None,
        api_key: str | None = None,
    ) -> str:
        """Gera texto via Claude (Anthropic Messages API)."""
        import httpx

        key = (api_key or "").strip() or self.anthropic_api_key
        if not key:
            raise RuntimeError("ANTHROPIC_API_KEY não está configurada no backend")

        payload: dict[str, Any] = {
            "model": (model or ANTHROPIC_MODEL).strip(),
            "max_tokens": max_tokens,
            "temperature": temperature,
            "system": system_prompt,
            "messages": _chat_messages(conversation, user_prompt),
        }
        headers = {
            "x-api-key": key,
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

    def generate_gemini_text(
        self,
        system_prompt: str,
        user_prompt: str,
        temperature: float,
        *,
        model: str | None = None,
        json_mode: bool = False,
        conversation: list[dict[str, str]] | None = None,
        api_key: str | None = None,
    ) -> str:
        """Gera texto via Gemini, com a conversa em turnos (user/model)."""
        client = genai.Client(api_key=api_key.strip()) if (api_key or "").strip() else self.gemini_client
        if not client:
            raise RuntimeError("GEMINI_API_KEY não está configurada")
        config: dict[str, Any] = {
            "system_instruction": system_prompt,
            "temperature": temperature,
            # Sem "raciocínio" escondido: ele gastava os tokens e a resposta vinha vazia.
            "thinking_config": {"thinking_budget": 0},
        }
        if json_mode:
            config["response_mime_type"] = "application/json"
        contents = [
            {"role": "model" if turn["role"] == "assistant" else "user", "parts": [{"text": turn["content"]}]}
            for turn in _chat_messages(conversation, user_prompt)
        ]
        result = client.models.generate_content(model=model or "gemini-2.5-flash", contents=contents, config=config)
        return result.text or ""

    def generate_openai_text(
        self,
        system_prompt: str,
        user_prompt: str,
        temperature: float,
        *,
        json_mode: bool = False,
        conversation: list[dict[str, str]] | None = None,
        api_key: str | None = None,
    ) -> str:
        client = OpenAI(api_key=api_key.strip(), base_url=OPENAI_BASE_URL) if (api_key or "").strip() else self.openai_client
        if not client:
            raise RuntimeError("OPENAI_API_KEY is not configured on the backend")

        kwargs: dict[str, Any] = {
            "model": OPENAI_TEXT_MODEL,
            "messages": [{"role": "system", "content": system_prompt}, *_chat_messages(conversation, user_prompt)],
            "temperature": temperature,
        }
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}

        response = client.chat.completions.create(**kwargs)
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
        conversation: list[dict[str, str]] | None = None,
    ) -> str:
        """Gera texto via Ollama local usando a API nativa /api/chat.

        Com `conversation`, as mensagens vão como turnos de verdade (user/assistant)
        e `user_prompt` é ignorado: medido no qwen2.5:3b, o histórico em turnos dá
        respostas coerentes onde o histórico colado como texto gerava confusão
        ("Tchau" para quem acabou de chegar, resposta para a pessoa errada).
        """
        import httpx

        global _local_ai_paused
        _local_ai_paused = False  # voltou a usar a IA local
        model = model or _preferred_local["model"]
        url = (base_url or _preferred_local["url"] or OLLAMA_BASE_URL).strip().rstrip("/")
        # num_predict limita o tamanho da geração — as respostas do chat já são
        # pedidas curtas (poucas frases), então 220 tokens só existe como teto
        # de segurança contra o modelo divagar e demorar mais que o necessário.
        # json_mode (decisões da Diretora) retorna um objeto maior, por isso
        # ganha um teto bem mais folgado em vez do mesmo limite do chat.
        # 120 tokens bastam para uma fala de chat; num PC disputado com OBS e
        # navegador a geração fica em ~5 tok/s, e cada token a mais é espera.
        num_predict = 700 if json_mode else 120
        payload: dict[str, Any] = {
            "model": (model or OLLAMA_MODEL).strip(),
            "stream": False,
            "messages": [
                {"role": "system", "content": system_prompt},
                *(_conversation_turns(conversation) or [{"role": "user", "content": user_prompt}]),
            ],
            # repeat_penalty acima do padrão do Ollama (1.1) para reduzir o
            # modelo travando em repetição de palavras/frases dentro da mesma
            # resposta — sintoma relatado com respostas tipo "oi oi, legal legal".
            "options": {
                "temperature": temperature,
                "num_predict": num_predict,
                # 1.3 penalizava palavras comuns já presentes no prompt e o modelo
                # passava a escrever português torto ("Obrigada muito", "Não
                # souberia"). 1.05 + top_p 0.9: texto natural sem ficar repetitivo.
                "repeat_penalty": 1.05,
                "top_p": 0.9,
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
        if payload["model"].lower().startswith("qwen3"):
            # Qwen3 "pensa" escondido antes de responder: segundos a mais por fala.
            payload["think"] = False

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
                response = _ollama_client().post(f"{url}/api/chat", json=payload)
                if response.status_code == 404 and payload["model"] != OLLAMA_MODEL:
                    # Modelo pedido não está instalado (ex.: tela aberta antes de o
                    # modelo pesado ser removido): usa o modelo padrão instalado em
                    # vez de deixar a persona muda com um 503.
                    logger.warning(
                        "[OLLAMA] modelo %s não instalado; usando o padrão %s",
                        payload["model"],
                        OLLAMA_MODEL,
                    )
                    payload["model"] = OLLAMA_MODEL
                    response = _ollama_client().post(f"{url}/api/chat", json=payload)
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

    def generate_mistral_text(
        self,
        system_prompt: str,
        user_prompt: str,
        temperature: float,
        *,
        api_key: str,
        json_mode: bool = False,
        conversation: list[dict[str, str]] | None = None,
    ) -> str:
        """Gera texto na Mistral (API compatível com OpenAI), com a conversa em turnos."""
        import httpx

        payload: dict[str, Any] = {
            "model": MISTRAL_MODEL,
            "messages": [
                {"role": "system", "content": system_prompt},
                *(_conversation_turns(conversation) or [{"role": "user", "content": user_prompt}]),
            ],
            "temperature": temperature,
            "max_tokens": 700 if json_mode else 150,
        }
        if json_mode:
            payload["response_format"] = {"type": "json_object"}
        with httpx.Client(timeout=30.0) as client:
            response = client.post(
                "https://api.mistral.ai/v1/chat/completions",
                json=payload,
                headers={"Authorization": f"Bearer {api_key}"},
            )
        if response.status_code == 401:
            raise RuntimeError("chave recusada pela Mistral (401). Confira a chave em Configurações → IA e chaves.")
        if response.status_code == 429:
            raise RuntimeError("limite de uso da Mistral atingido (429). Aguarde um pouco.")
        response.raise_for_status()
        text = ((response.json().get("choices") or [{}])[0].get("message") or {}).get("content") or ""
        if not text.strip():
            raise RuntimeError("Mistral retornou uma resposta vazia")
        logger.info("[MISTRAL] chat response model=%s chars=%d", MISTRAL_MODEL, len(text))
        return text.strip()

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
        conversation: list[dict[str, str]] | None = None,
        provider_key: str | None = None,
        priority: str = "chat",
    ) -> Tuple[str, str]:
        """
        AI Provider Router: Tries configured providers in order,
        then falls back to local simulation or neutral response.
        """
        from server.config import AI_PROVIDER, ENABLE_LOCAL_FALLBACK
        selected_provider = (provider or AI_PROVIDER).strip().lower()
        if priority == "chat":
            remember_local_model(local_model_name, local_model_url)

        # Priority 1: Configured Provider
        providers_to_try = []
        if selected_provider == "mistral":
            # Se a Mistral falhar (chave errada, cota), o chat não fica mudo: IA local.
            providers_to_try = ["mistral", "ollama"]
        elif selected_provider in {"ollama", "local"}:
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
            if provider == "mistral":
                key = (provider_key or "").strip() or MISTRAL_API_KEY
                if not key:
                    errors.append("Mistral: nenhuma chave configurada")
                    continue
                try:
                    text = self.generate_mistral_text(
                        system_prompt, user_prompt, temperature, api_key=key, json_mode=json_mode, conversation=conversation
                    )
                    if text.strip():
                        return text, "mistral"
                except Exception as exc:
                    logger.warning("[AI ROUTER] Mistral failed: %s", exc)
                    errors.append(f"Mistral: {exc}")

            if provider == "ollama":
                try:
                    with local_ai_gate.slot(priority):
                        text = self.generate_ollama_text(
                            system_prompt,
                            user_prompt,
                            temperature,
                            model=local_model_name,
                            base_url=local_model_url,
                            json_mode=json_mode,
                            conversation=conversation,
                        )
                    if text.strip():
                        return text, "ollama"
                except Exception as exc:
                    logger.warning("[AI ROUTER] Ollama failed: %s", exc)
                    errors.append(f"Ollama: {exc}")

            cloud_key = (provider_key or "").strip() if provider == selected_provider else ""
            if provider == "claude" and (self.anthropic_api_key or cloud_key):
                try:
                    text = self.generate_claude_text(
                        system_prompt,
                        user_prompt,
                        temperature,
                        conversation=conversation,
                        api_key=cloud_key or None,
                    )
                    if text.strip():
                        return text, "claude"
                except Exception as exc:
                    logger.warning("[AI ROUTER] Claude failed: %s", exc)
                    errors.append(f"Claude: {exc}")

            if provider == "gemini" and (self.gemini_client or cloud_key):
                try:
                    text = self.generate_gemini_text(
                        system_prompt,
                        user_prompt,
                        temperature,
                        model=gemini_model,
                        json_mode=json_mode,
                        conversation=conversation,
                        api_key=cloud_key or None,
                    )
                    if text.strip():
                        return text, "gemini"
                except Exception as exc:
                    logger.warning("[AI ROUTER] Gemini failed: %s", exc)
                    errors.append(f"Gemini: {exc}")

            if provider == "openai" and (self.openai_client or cloud_key):
                try:
                    text = self.generate_openai_text(
                        system_prompt,
                        user_prompt,
                        temperature,
                        json_mode=json_mode,
                        conversation=conversation,
                        api_key=cloud_key or None,
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

    while True:
        if local_ai_paused() or not await _live_session_active():
            await asyncio.sleep(interval_seconds)
            continue
        # Mantém aquecido o modelo que o chat usa (o padrão do servidor faria o
        # Ollama trocar de modelo a cada ping).
        model = _preferred_local["model"] or OLLAMA_MODEL
        url = (_preferred_local["url"] or OLLAMA_BASE_URL).strip().rstrip("/")
        try:
            from server.core.http_clients import shared_ssl_context

            async with httpx.AsyncClient(timeout=10.0, verify=shared_ssl_context()) as client:
                await client.post(
                    f"{url}/api/generate",
                    json={"model": model, "prompt": "", "keep_alive": OLLAMA_KEEP_ALIVE},
                )
            logger.info("[OLLAMA] keep-alive ping ok (model=%s)", model)
        except Exception as exc:
            logger.info("[OLLAMA] keep-alive ping falhou (Ollama pode estar desligado): %s", exc)
        await asyncio.sleep(interval_seconds)
