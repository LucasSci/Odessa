"""Agent relay endpoint — mirrors the Hostinger cloud API's /api/agent route.

In cloud/preview mode the frontend rewrites /obs/* calls to
/api/agent?obsAction=... (see src/lib/api.ts). This router translates that
back to the OBS router so the same backend serves both local and cloud
frontends without code changes.
"""

import inspect
from datetime import datetime, timezone
from typing import Any, Optional, get_args

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from server.api.v1.endpoints import obs as obs_router

router = APIRouter(tags=["agent"])


def _coerce_post_body(handler: Any, body: Any) -> tuple[bool, Any]:
    """Converte o body JSON cru no tipo esperado pelo handler.

    Retorna (passar_body?, body). Handlers sem parâmetro `request` são
    chamados SEM argumentos (antes: TypeError → 500). Bodies dict são
    validados no model Pydantic anotado no handler (antes: AttributeError
    acessando .mode num dict cru → 500). Body inválido → tratado como
    ausente, o handler decide o padrão.
    """
    params = inspect.signature(handler).parameters
    request_param = params.get("request")
    if request_param is None:
        return (False, None)
    if isinstance(body, dict):
        annotation = request_param.annotation
        candidates = get_args(annotation) or (annotation,)
        for candidate in candidates:
            if isinstance(candidate, type) and issubclass(candidate, BaseModel):
                try:
                    return (True, candidate.model_validate(body))
                except Exception:
                    return (False, None)
    return (True, body)


def _json(status_code: int, body: dict[str, Any]) -> JSONResponse:
    return JSONResponse(body, status_code=status_code)


@router.get("/agent/status")
async def agent_status() -> dict[str, Any]:
    """Status do agente local — no sandbox não há agente externo, mas
    retornamos ok=true para o frontend não bloquear a UI."""
    return {
        "ok": True,
        "queueSize": 0,
        "mode": "local",
        "message": "Agente local pronto",
        "localAgent": {
            "online": True,
            "lastSeenAt": datetime.now(timezone.utc).isoformat(),
            "capabilities": ["obs", "tts", "chat"],
        },
    }


@router.api_route("/agent", methods=["GET", "POST", "PUT", "DELETE"])
async def agent_relay(request: Request) -> JSONResponse:
    """Recebe /api/agent?obsAction=... e delega para a rota OBS correspondente."""
    obs_action = request.query_params.get("obsAction")
    if not obs_action:
        return _json(200, {"ok": True, "message": "Agent relay ready"})

    action = obs_action.strip("/")
    # Map obsAction → (handler_name, method)
    route_map: dict[str, tuple[str, str]] = {
        "settings": ("obs_settings", "GET"),
        "health": ("obs_health", "GET"),
        "live-layout": ("obs_live_layout", "GET"),
        "setup-live-scene": ("obs_setup_live_scene", "POST"),
        "show-start": ("obs_show_start", "POST"),
        "show-stage": ("obs_show_stage", "POST"),
        "refresh-source": ("obs_refresh_source", "POST"),
        "prepare-capture": ("obs_prepare_capture", "POST"),
        "live-health": ("obs_live_health", "GET"),
        "live-plan": ("obs_live_plan", "GET"),
        "start-live": ("obs_start_live", "POST"),
        "start-live/dry-run": ("obs_start_live_dry_run", "POST"),
        "transmission/start": ("obs_start_transmission", "POST"),
        "transmission/stop": ("obs_stop_transmission", "POST"),
        "scenes": ("obs_scenes", "GET"),
        "sources": ("obs_sources", "GET"),
        "ensure-ocr-source": ("obs_ensure_ocr_source", "POST"),
        "screenshot": ("obs_screenshot", "POST"),
        "switch-scene": ("obs_switch_scene", "POST"),
    }

    entry = route_map.get(action)
    if not entry:
        return _json(404, {"ok": False, "detail": f"Unknown obsAction: {action}"})

    handler_name, expected_method = entry
    handler = getattr(obs_router, handler_name, None)
    if handler is None:
        return _json(404, {"ok": False, "detail": f"Handler not found: {handler_name}"})

    try:
        if expected_method == "POST":
            body = None
            try:
                body = await request.json()
            except Exception:
                pass
            pass_body, coerced = _coerce_post_body(handler, body)
            if pass_body:
                result = await handler(coerced)  # type: ignore[arg-type]
            else:
                result = await handler()  # type: ignore[call-arg]
        else:
            # GET — pass through query params as kwargs
            params = dict(request.query_params)
            params.pop("obsAction", None)
            if params:
                result = await handler(**params)  # type: ignore[arg-type]
            else:
                result = await handler()  # type: ignore[call-arg]
        if isinstance(result, dict):
            return _json(200, result)
        return _json(200, {"ok": True, "data": result})
    except Exception as exc:
        return _json(500, {"ok": False, "error": str(exc)})
