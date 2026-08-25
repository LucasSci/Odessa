from typing import Any

from fastapi import APIRouter, Query
from pydantic import BaseModel

from server.services.chat_automation_service import chat_automation_service
from server.services.bridge_manager import bridge_manager, load_bridge_config, save_bridge_config


router = APIRouter(tags=["chat-automation"])


class ChatAutomationConfigRequest(BaseModel):
    allowlist: list[dict[str, Any]]


class ChatAutomationTargetRequest(BaseModel):
    mode: str = "selector"
    url: str = ""
    inputSelector: str | None = None
    inputPoint: dict[str, Any] | None = None
    sendPoint: dict[str, Any] | None = None
    viewport: dict[str, Any] | None = None


class ChatAutomationSendRequest(ChatAutomationTargetRequest):
    text: str
    dryRun: bool = True
    submit: bool = True


class BridgeStartRequest(BaseModel):
    mode: str = ""
    autoconnect: bool = True
    config: dict[str, Any] | None = None


class BridgeConfigRequest(BaseModel):
    mode: str = ""
    cdpUrl: str = "http://127.0.0.1:9222"
    roomUrl: str = "https://tango.me/stream/broadcast"
    port: int = 7555
    autoconnect: bool = True
    selectors: dict[str, str] | None = None


@router.get("/config")
def get_chat_automation_config():
    return chat_automation_service.get_config()


@router.post("/config")
def update_chat_automation_config(request: ChatAutomationConfigRequest):
    return chat_automation_service.update_config(request.allowlist)


@router.post("/validate")
def validate_chat_automation_target(request: ChatAutomationTargetRequest):
    return chat_automation_service.validate_target(
        request.url,
        request.inputSelector,
        mode=request.mode,
        input_point=request.inputPoint,
    )


@router.post("/send")
def send_chat_automation_message(request: ChatAutomationSendRequest):
    return chat_automation_service.send(
        request.url,
        request.text,
        input_selector=request.inputSelector,
        dry_run=request.dryRun,
        submit=request.submit,
        mode=request.mode,
        input_point=request.inputPoint,
        send_point=request.sendPoint,
        viewport=request.viewport,
    )


# ── Bridge Process Management ─────────────────────────────────────────


@router.get("/bridge/status")
async def get_bridge_status():
    """Status do processo da bridge e conectividade."""
    return await bridge_manager.get_status()


@router.post("/bridge/start")
async def start_bridge(request: BridgeStartRequest | None = None):
    """Inicia o processo tango_chat.py."""
    req = request or BridgeStartRequest()
    config = req.config or load_bridge_config()
    return await bridge_manager.start(
        mode=req.mode,
        autoconnect=req.autoconnect,
        config=config,
    )


@router.post("/bridge/stop")
async def stop_bridge():
    """Para o processo tango_chat.py."""
    return await bridge_manager.stop()


@router.get("/bridge/config")
def get_bridge_config():
    """Lê a configuração da bridge."""
    return load_bridge_config()


@router.post("/bridge/config")
def update_bridge_config(request: BridgeConfigRequest):
    """Salva a configuração da bridge."""
    return save_bridge_config(request.model_dump())


@router.get("/bridge/logs")
def get_bridge_logs(limit: int = Query(default=100, ge=1, le=500)):
    """Últimas linhas de log do processo da bridge."""
    return bridge_manager.get_logs(limit=limit)


# ── Chrome Live Helpers Endpoints ─────────────────────────────────────


class ChromeLaunchRequest(BaseModel):
    url: str = "https://tango.me/stream/broadcast"
    port: int = 9222


@router.post("/bridge/launch-chrome")
async def api_launch_chrome(request: ChromeLaunchRequest | None = None):
    """Inicia o Google Chrome com porta de depuração para acoplamento na live."""
    from server.services.bridge_manager import launch_chrome_for_live
    req = request or ChromeLaunchRequest()
    return await launch_chrome_for_live(url=req.url, port=req.port)


@router.get("/bridge/chrome-tabs")
async def api_get_chrome_tabs(port: int = Query(default=9222)):
    """Verifica e lista as abas abertas no Chrome com debug ativo."""
    from server.services.bridge_manager import get_chrome_debug_tabs
    return await get_chrome_debug_tabs(port=port)


@router.post("/bridge/create-shortcut")
def api_create_shortcut(request: ChromeLaunchRequest | None = None):
    """Cria um atalho no Desktop do Windows para abrir o Chrome da Live com 1 clique."""
    from server.services.bridge_manager import create_desktop_shortcut
    req = request or ChromeLaunchRequest()
    return create_desktop_shortcut(url=req.url, port=req.port)


