from typing import Any, Optional

from fastapi import APIRouter, Query
from pydantic import BaseModel

from server.config import OBS_OCR_SOURCE_NAME
from server.services.obs_service import obs_service


router = APIRouter(tags=["OBS"])


class ObsScreenshotRequest(BaseModel):
    sourceName: Optional[str] = None
    width: Optional[int] = None
    height: Optional[int] = None
    format: str = "png"


class ObsEnsureSourceRequest(BaseModel):
    sourceName: Optional[str] = None
    sceneName: Optional[str] = None
    url: Optional[str] = None
    width: int = 1280
    height: int = 720


class ObsSwitchSceneRequest(BaseModel):
    sceneName: Optional[str] = None
    scene: Optional[str] = None
    requestedScene: Optional[str] = None


class ObsSettingsRequest(BaseModel):
    enabled: Optional[bool] = None
    websocketUrl: Optional[str] = None
    websocketHost: Optional[str] = None
    websocketPort: Optional[int | str] = None
    websocketPassword: Optional[str] = None
    ocrSourceName: Optional[str] = None
    chatSourceName: Optional[str] = None
    stageSourceName: Optional[str] = None
    stageUrl: Optional[str] = None
    startupSceneName: Optional[str] = None
    liveSceneName: Optional[str] = None
    transmissionMode: Optional[str] = None
    canvasWidth: Optional[int] = None
    canvasHeight: Optional[int] = None
    sceneWhitelist: Optional[list[str] | str] = None
    allowedScenes: Optional[list[str] | str] = None


class ObsLiveLayoutRequest(BaseModel):
    chatSourceName: Optional[str] = None
    stageSourceName: Optional[str] = None
    stageUrl: Optional[str] = None
    startupSceneName: Optional[str] = None
    liveSceneName: Optional[str] = None
    transmissionMode: Optional[str] = None
    canvasWidth: Optional[int] = None
    canvasHeight: Optional[int] = None


class ObsTransmissionRequest(BaseModel):
    mode: Optional[str] = None


class ObsSourceRequest(BaseModel):
    sourceName: Optional[str] = None


class ObsStartLiveRequest(BaseModel):
    voiceEnabled: bool = False
    enableChat: bool = False
    prepareObs: bool = True
    showStage: bool = True
    startAutomation: bool = True
    startCapture: bool = False
    startTransmission: bool = False
    actionMode: str = "simulated"


def _live_plan_from_request(config: ObsStartLiveRequest, health: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    mode = config.actionMode if config.actionMode in {"simulated", "approval_required", "real"} else "simulated"
    settings = obs_service.get_settings()
    risks: list[str] = []
    if config.startTransmission and settings.get("transmissionMode") == "none":
        risks.append("Transmissao marcada, mas OBS esta configurado como 'none'.")
    if mode != "real":
        risks.append("Modo seguro ativo: nenhuma acao real deve afetar a live.")
    if health and health.get("error"):
        risks.append(str(health.get("error")))

    def step(step_id: str, label: str, enabled: bool, description: str, blocked: bool = False):
        return {
            "id": step_id,
            "label": label,
            "enabled": enabled,
            "mode": mode,
            "description": description,
            "status": "blocked" if blocked else "ready",
        }

    health_blocked = bool(health and health.get("connected") is False and config.prepareObs)
    steps = [
        step("health", "Verificar saude do OBS", config.prepareObs, "Confere conexao, cenas, source do palco e source do chat.", health_blocked),
        step("setup", "Preparar cena da live", config.prepareObs, "Cria/atualiza source do palco e layout vertical no OBS.", health_blocked),
        step("stage", "Colocar palco ao vivo", config.showStage, "Troca para a cena configurada como live.", health_blocked),
        step("capture", "Iniciar captura do chat", config.startCapture, "Solicita a captura configurada na aplicacao web."),
        step("automation", "Iniciar automacao do fluxo", config.startAutomation, "Liga o runtime de gatilhos e fila de videos."),
        step("tts", "Habilitar Voz IA / TTS", config.voiceEnabled, "Permite que a runtime use fala quando uma acao pedir."),
        step("chat", "Habilitar resposta no chat", config.enableChat, "Permite respostas automatizadas quando configuradas."),
        step("transmission", "Iniciar transmissao/camera", config.startTransmission, "Chama OBS stream ou camera virtual conforme configuracao."),
    ]
    return {
        "ok": not any(item["enabled"] and item["status"] == "blocked" for item in steps),
        "actionMode": mode,
        "settings": settings,
        "steps": steps,
        "risks": risks,
        "health": health,
        "error": None,
    }


@router.get("/settings")
async def obs_settings():
    return {"ok": True, "settings": obs_service.get_settings(), "error": None}


@router.post("/settings")
async def update_obs_settings(request: ObsSettingsRequest):
    settings = request.model_dump(exclude_unset=True)
    try:
        return {"ok": True, "settings": await obs_service.configure(settings), "error": None}
    except Exception as exc:
        return {"ok": False, "settings": obs_service.get_settings(), "error": str(exc)}


@router.get("/health")
async def obs_health(sourceName: Optional[str] = Query(default=None)):
    return await obs_service.health_check(sourceName or obs_service.chat_source_name or OBS_OCR_SOURCE_NAME)


@router.get("/live-layout")
async def obs_live_layout():
    return {"ok": True, "layout": obs_service.get_live_layout(), "error": None}


@router.post("/live-layout")
async def update_obs_live_layout(request: ObsLiveLayoutRequest):
    settings = request.model_dump(exclude_unset=True)
    try:
        return {"ok": True, "layout": await obs_service.configure_live_layout(settings), "error": None}
    except Exception as exc:
        return {"ok": False, "layout": obs_service.get_live_layout(), "error": str(exc)}


@router.post("/setup-live-scene")
async def obs_setup_live_scene(request: Optional[ObsLiveLayoutRequest] = None):
    try:
        if request is not None:
            settings = request.model_dump(exclude_unset=True)
            if settings:
                await obs_service.configure_live_layout(settings)
        return await obs_service.setup_live_scene()
    except Exception as exc:
        return {"ok": False, "layout": obs_service.get_live_layout(), "error": str(exc)}


@router.post("/show-start")
async def obs_show_start():
    try:
        from server.services.video_service import video_service

        video_service.return_to_idle()
    except Exception:
        pass
    try:
        return await obs_service.show_start_scene()
    except Exception as exc:
        return {"ok": False, "status": "error", "sceneName": obs_service.startup_scene_name, "error": str(exc)}


@router.post("/show-stage")
async def obs_show_stage():
    try:
        return await obs_service.show_stage_scene()
    except Exception as exc:
        return {"ok": False, "status": "error", "sceneName": obs_service.live_scene_name, "error": str(exc)}


@router.post("/refresh-source")
async def obs_refresh_source(request: Optional[ObsSourceRequest] = None):
    try:
        return await obs_service.refresh_browser_source(request.sourceName if request else None)
    except Exception as exc:
        source_name = request.sourceName if request else None
        return {
            "ok": False,
            "status": "error",
            "sourceName": source_name or obs_service.chat_source_name or OBS_OCR_SOURCE_NAME,
            "propertyName": "refreshnocache",
            "error": str(exc),
        }


@router.post("/prepare-capture")
async def obs_prepare_capture(request: Optional[ObsSourceRequest] = None):
    try:
        return await obs_service.prepare_capture_source(request.sourceName if request else None)
    except Exception as exc:
        source_name = request.sourceName if request else None
        return {
            "ok": False,
            "status": "error",
            "sourceName": source_name or obs_service.chat_source_name or OBS_OCR_SOURCE_NAME,
            "health": None,
            "error": str(exc),
        }


@router.get("/live-health")
async def obs_live_health():
    return await obs_service.live_health()


@router.get("/live-plan")
async def obs_live_plan(
    voiceEnabled: bool = Query(default=False),
    enableChat: bool = Query(default=False),
    prepareObs: bool = Query(default=True),
    showStage: bool = Query(default=True),
    startAutomation: bool = Query(default=True),
    startCapture: bool = Query(default=False),
    startTransmission: bool = Query(default=False),
    actionMode: str = Query(default="simulated"),
):
    request = ObsStartLiveRequest(
        voiceEnabled=voiceEnabled,
        enableChat=enableChat,
        prepareObs=prepareObs,
        showStage=showStage,
        startAutomation=startAutomation,
        startCapture=startCapture,
        startTransmission=startTransmission,
        actionMode=actionMode,
    )
    health = await obs_service.live_health() if prepareObs else None
    return _live_plan_from_request(request, health)


@router.post("/start-live/dry-run")
async def obs_start_live_dry_run(request: ObsStartLiveRequest):
    health = await obs_service.live_health() if request.prepareObs else None
    return {**_live_plan_from_request(request, health), "dryRun": True}


@router.post("/start-live")
async def obs_start_live(request: ObsStartLiveRequest):
    if request.actionMode != "real":
        health = await obs_service.live_health() if request.prepareObs else None
        return {**_live_plan_from_request(request, health), "dryRun": True}
    results: list[dict[str, Any]] = []
    try:
        if request.prepareObs:
            health = await obs_service.live_health()
            if not health.get("ok"):
                setup = await obs_service.setup_live_scene()
                results.append({"id": "setup", "result": setup})
                if not setup.get("ok"):
                    return {"ok": False, "results": results, "error": setup.get("error")}
        if request.showStage:
            stage = await obs_service.show_stage_scene()
            results.append({"id": "stage", "result": stage})
            if not stage.get("ok"):
                return {"ok": False, "results": results, "error": stage.get("error")}
        if request.startTransmission:
            transmission = await obs_service.start_transmission(None)
            results.append({"id": "transmission", "result": transmission})
            if not transmission.get("ok"):
                return {"ok": False, "results": results, "error": transmission.get("error")}
        return {"ok": True, "results": results, "error": None}
    except Exception as exc:
        return {"ok": False, "results": results, "error": str(exc)}


@router.post("/transmission/start")
async def obs_start_transmission(request: Optional[ObsTransmissionRequest] = None):
    try:
        return await obs_service.start_transmission(request.mode if request else None)
    except Exception as exc:
        return {"ok": False, "status": "error", "mode": request.mode if request else None, "error": str(exc)}


@router.post("/transmission/stop")
async def obs_stop_transmission(request: Optional[ObsTransmissionRequest] = None):
    try:
        return await obs_service.stop_transmission(request.mode if request else None)
    except Exception as exc:
        return {"ok": False, "status": "error", "mode": request.mode if request else None, "error": str(exc)}


@router.get("/scenes")
async def obs_scenes():
    try:
        return await obs_service.get_scene_list()
    except Exception as exc:
        return {"ok": False, "scenes": [], "currentScene": None, "error": str(exc)}


@router.get("/sources")
async def obs_sources():
    try:
        return await obs_service.get_source_inventory()
    except Exception as exc:
        return {
            "ok": False,
            "scenes": [],
            "currentScene": None,
            "inputs": [],
            "sceneItems": [],
            "sources": [],
            "allowedScenes": obs_service.whitelist,
            "error": str(exc),
        }


@router.post("/ensure-ocr-source")
async def obs_ensure_ocr_source(request: ObsEnsureSourceRequest):
    try:
        source_name = (request.sourceName or OBS_OCR_SOURCE_NAME).strip() or OBS_OCR_SOURCE_NAME
        return await obs_service.ensure_browser_source(
            source_name=source_name,
            scene_name=request.sceneName,
            url=request.url,
            width=request.width,
            height=request.height,
        )
    except Exception as exc:
        return {
            "ok": False,
            "created": False,
            "sourceName": request.sourceName or OBS_OCR_SOURCE_NAME,
            "sceneName": request.sceneName,
            "error": str(exc),
        }


@router.post("/screenshot")
async def obs_screenshot(request: ObsScreenshotRequest):
    source_name = (request.sourceName or OBS_OCR_SOURCE_NAME).strip() or OBS_OCR_SOURCE_NAME
    try:
        return await obs_service.get_source_screenshot(
            source_name,
            width=request.width,
            height=request.height,
            image_format=request.format,
        )
    except Exception as exc:
        return {
            "ok": False,
            "image": None,
            "width": None,
            "height": None,
            "sourceName": source_name,
            "sourceActive": None,
            "sourceShowing": None,
            "frameHash": None,
            "capturedAt": None,
            "error": str(exc),
        }


@router.post("/switch-scene")
async def obs_switch_scene(request: ObsSwitchSceneRequest):
    scene_name = (request.sceneName or request.scene or request.requestedScene or "").strip()
    if not scene_name:
        return {"ok": False, "status": "blocked", "error": "scene_missing"}
    return await obs_service.switch_scene(scene_name)
