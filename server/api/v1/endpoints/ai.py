import asyncio
import json
import logging
import re
import shutil
import subprocess
import time
from collections import deque
from typing import Any
import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from server.config import GEMINI_API_KEY
from server.models import AIRespondRequest, AIDecideRequest
from server.utils.text_utils import extract_json_object

router = APIRouter(tags=["AI"])
logger = logging.getLogger("odessa.routes.ai")

# Nome de modelo vira parte do caminho da URL do Google: só caracteres seguros.
GEMINI_MODEL_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")


class RateLimiter:
    """Janela deslizante em memória (por processo): no máximo `limit` chamadas em `window_s`."""

    def __init__(self, limit: int, window_s: float, clock=time.monotonic):
        self._limit = limit
        self._window = window_s
        self._clock = clock
        self._hits: deque[float] = deque()

    def allow(self) -> bool:
        now = self._clock()
        while self._hits and now - self._hits[0] >= self._window:
            self._hits.popleft()
        if len(self._hits) >= self._limit:
            return False
        self._hits.append(now)
        return True


_gemini_rate_limiter = RateLimiter(limit=30, window_s=60.0)


async def _check_ollama(timeout: float = 2.5) -> dict[str, Any]:
    """Verifica se o Ollama está acessível e se o modelo configurado está instalado."""
    from server.config import OLLAMA_BASE_URL, OLLAMA_MODEL

    result: dict[str, Any] = {
        "configured": True,
        "url": OLLAMA_BASE_URL,
        "model": OLLAMA_MODEL,
        "reachable": False,
        "modelInstalled": False,
        "installedModels": [],
    }
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.get(f"{OLLAMA_BASE_URL}/api/tags")
        result["reachable"] = response.is_success
        if response.is_success:
            models = [item.get("name") for item in response.json().get("models", [])]
            result["installedModels"] = models
            result["modelInstalled"] = OLLAMA_MODEL in models
    except Exception:
        pass
    return result


class GeminiProxyRequest(BaseModel):
    key: str | None = None
    model: str | None = None
    payload: dict[str, Any] | None = None


@router.post("/gemini")
async def gemini_proxy(request: GeminiProxyRequest):
    """Proxy same-origem para a Gemini generateContent.

    O browser não consegue chamar a Gemini direto (CORS), então o cliente envia
    { key, model, payload } e este endpoint encaminha ao Google. A chave vem no
    corpo (guardada no cliente); se ausente, cai na GEMINI_API_KEY do servidor.
    """
    api_key = (request.key or "").strip() or (GEMINI_API_KEY or "")
    if not api_key:
        raise HTTPException(status_code=503, detail="Nenhuma chave Gemini disponível (cliente nem servidor).")
    model = (request.model or "").strip() or "gemini-2.5-flash"
    if not GEMINI_MODEL_RE.fullmatch(model):
        raise HTTPException(status_code=400, detail="Modelo Gemini inválido.")
    payload = request.payload
    if not payload or not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="payload (corpo do generateContent) é obrigatório.")
    if not _gemini_rate_limiter.allow():
        raise HTTPException(status_code=429, detail="Muitas chamadas ao Gemini. Aguarde um instante.")

    # A chave vai no header (não na URL): a query string aparece em logs de
    # acesso, proxies e mensagens de erro.
    upstream_url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    try:
        async with httpx.AsyncClient(timeout=25.0) as client:
            resp = await client.post(upstream_url, json=payload, headers={"x-goog-api-key": api_key})
        try:
            data = resp.json()
        except Exception:
            data = {"raw": resp.text}
        return data
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Proxy Gemini: tempo esgotado ao contatar o Google.")
    except Exception as exc:
        # O detalhe fica só no log do servidor: a mensagem da exceção pode
        # conter a URL/cabeçalhos da requisição.
        logger.error("[ai/gemini proxy] %s", exc, exc_info=True)
        raise HTTPException(status_code=502, detail="Proxy Gemini falhou ao contatar o Google.") from exc


@router.get("/status")
async def ai_status():
    """Retorna o provedor configurado e se o Ollama local está acessível."""
    from server.config import AI_PROVIDER, ANTHROPIC_API_KEY, ANTHROPIC_MODEL

    ollama = await _check_ollama()
    claude = {"configured": bool(ANTHROPIC_API_KEY), "model": ANTHROPIC_MODEL}
    return {"provider": AI_PROVIDER, "ollama": ollama, "claude": claude}


@router.post("/ollama/connect")
async def ollama_connect():
    """Garante que o Ollama esteja rodando e com o modelo configurado instalado.

    Usado pelo botão "Conectar Ollama" no Diagnóstico: se o serviço não estiver
    acessível, tenta iniciar `ollama serve` (processo já instalado no PATH do
    usuário); se estiver acessível mas o modelo configurado não estiver
    instalado, dispara `ollama pull <modelo>` em segundo plano (download pode
    levar minutos — o chamador deve reexecutar o diagnóstico depois para
    conferir se já terminou).
    """
    ollama_exe = shutil.which("ollama")

    status = await _check_ollama()
    started = False

    if not status["reachable"]:
        if not ollama_exe:
            raise HTTPException(
                status_code=503,
                detail="Ollama não foi encontrado no PATH. Instale em https://ollama.com/download e tente novamente.",
            )
        try:
            creationflags = subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0
            subprocess.Popen(
                [ollama_exe, "serve"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=creationflags,
            )
            started = True
        except Exception as exc:
            logger.error("[ollama/connect] falha ao iniciar 'ollama serve': %s", exc, exc_info=True)
            raise HTTPException(status_code=500, detail=f"Falha ao iniciar o Ollama: {exc}") from exc

        # Espera o servidor subir (cold start do processo, não do modelo).
        for _ in range(15):
            await asyncio.sleep(1)
            status = await _check_ollama()
            if status["reachable"]:
                break

    if not status["reachable"]:
        raise HTTPException(
            status_code=503,
            detail="O Ollama foi iniciado mas não respondeu a tempo. Tente de novo em alguns segundos.",
        )

    pulling = False
    if not status["modelInstalled"]:
        exe = ollama_exe or "ollama"
        try:
            creationflags = subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0
            subprocess.Popen(
                [exe, "pull", status["model"]],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=creationflags,
            )
            pulling = True
        except Exception as exc:
            logger.error("[ollama/connect] falha ao baixar modelo: %s", exc, exc_info=True)
            raise HTTPException(
                status_code=500,
                detail=f"Ollama conectado, mas falhou ao baixar o modelo {status['model']}: {exc}",
            ) from exc

    return {
        "ok": True,
        "started": started,
        "reachable": status["reachable"],
        "modelInstalled": status["modelInstalled"],
        "pulling": pulling,
        "model": status["model"],
        "message": (
            f"Baixando o modelo {status['model']} em segundo plano — isso pode levar alguns minutos. "
            "Reexecute o diagnóstico depois para conferir."
            if pulling
            else "Ollama conectado e modelo já instalado."
        ),
    }


def get_ai_service():
    from server.services.ai_service import ai_service

    return ai_service

@router.post("/respond")
def ai_respond(request: AIRespondRequest):
    try:
        user_prompt = request.user_prompt or request.chat_context
        text, provider = get_ai_service().generate_ai_text_with_fallback(
            gemini_model=request.model,
            system_prompt=request.persona_prompt,
            user_prompt=user_prompt,
            temperature=request.temperature,
            local_model_url=request.local_model_url,
            local_model_name=request.local_model_name,
            provider=request.provider,
        )
        return {"response": text, "provider": provider}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("[AI RESPOND EXCEPTION] %s", exc, exc_info=True)
        raise HTTPException(status_code=502, detail=str(exc)) from exc

@router.post("/decide")
def ai_decide(request: AIDecideRequest):
    if not request.events:
        raise HTTPException(status_code=400, detail="events is required")

    events_payload = [
        {
            "id": event.id,
            "source": event.source,
            "zoneName": event.zoneName,
            "kind": event.kind,
            "text": event.text,
            "createdAt": event.createdAt,
            "metadata": event.metadata or {},
        }
        for event in request.events[-5:]
    ]
    tools_payload = request.tools or []
    rules_payload = request.rules or []
    context_payload = request.context or {}

    decision_contract = {
        "context_analysis": "analise breve (PASSO 1: PENSAR)",
        "sentiment": "positivo | negativo | neutro | hype | caotico",
        "intent": "respond_chat | thank_gift | redeem_gift | moderate | switch_scene | media_request | topic_shift | handle_alert | log_only",
        "reason": "por que esta decisao foi escolhida",
        "priority": "low | normal | high | urgent",
        "actions": [
            {
                "id": "action-1",
                "type": "speak | chat_reply | etc",
                "capability": "tts.speak | etc",
                "label": "nome humano",
                "payload": {},
                "requiresApproval": False,
                "simulated": True,
                "status": "queued",
            }
        ],
        "speech": "O que a streamer vai falar (PASSO FINAL: FALAR)",
    }

    user_prompt = (
        "Eventos recentes:\n"
        f"{json.dumps(events_payload, ensure_ascii=False)}\n\n"
        "Ferramentas:\n"
        f"{json.dumps(tools_payload, ensure_ascii=False)}\n\n"
        "Regras:\n"
        f"{json.dumps(rules_payload, ensure_ascii=False)}\n\n"
        "Contexto:\n"
        f"{json.dumps(context_payload, ensure_ascii=False)}\n\n"
        "Retorne APENAS um objeto JSON valido seguindo exatamente este contrato:\n"
        f"{json.dumps(decision_contract, ensure_ascii=False)}\n\n"
    )

    try:
        text, provider = get_ai_service().generate_ai_text_with_fallback(
            gemini_model=request.model,
            system_prompt=request.persona_prompt,
            user_prompt=user_prompt,
            temperature=request.temperature,
            json_mode=True,
        )
        try:
            parsed = extract_json_object(text or "{}")
            parsed["provider"] = provider
            return parsed
        except Exception:
            # Simple fallback if JSON parsing fails twice
            logger.error("[AI DECIDE JSON EXCEPTION] %s", text)
            raise HTTPException(status_code=502, detail="AI returned invalid JSON decision")

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("[AI DECIDE EXCEPTION] %s", exc, exc_info=True)
        raise HTTPException(status_code=502, detail=str(exc)) from exc
