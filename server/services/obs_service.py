import base64
import hashlib
import io
import json
import logging
import urllib.parse
from datetime import datetime, timezone
from typing import Any, Optional

from PIL import Image, ImageStat, UnidentifiedImageError

from server.config import (
    OBS_ENABLED,
    OBS_LIVE_SCENE_NAME,
    OBS_OCR_SOURCE_NAME,
    OBS_SCENE_WHITELIST,
    OBS_STAGE_CANVAS_HEIGHT,
    OBS_STAGE_CANVAS_WIDTH,
    OBS_STAGE_SOURCE_NAME,
    OBS_STAGE_URL,
    OBS_STARTUP_SCENE_NAME,
    OBS_TRANSMISSION_MODE,
    OBS_WEBSOCKET_PASSWORD,
    OBS_WEBSOCKET_URL,
    PROJECT_ROOT,
    RUNTIME_DIR,
)

try:
    import simpleobsws
except Exception:  # pragma: no cover - depends on local environment package install
    simpleobsws = None


logger = logging.getLogger("odessa.obs")
OBS_SETTINGS_FILE = RUNTIME_DIR / "obs_settings.json"
DEFAULT_BROWSER_SOURCE_FILE = PROJECT_ROOT / "public" / "obs-chat-ocr.html"
DEFAULT_STAGE_URL = OBS_STAGE_URL
NOT_IDENTIFIED_MARKERS = (
    "notidentified",
    "not identified",
    "without being identified",
    "identified with obs-websocket",
)
DEFAULT_BROWSER_SOURCE_HTML = """
<!doctype html>
<html>
  <head><meta charset="utf-8"></head>
  <body style="margin:0;background:#f8fafc;color:#111827;font:28px Arial,sans-serif;display:flex;align-items:center;justify-content:center;width:100vw;height:100vh;text-align:center;">
    <div>
      <strong>Odessa Chat OCR</strong><br>
      Configure esta Browser Source com o chat da live.
    </div>
  </body>
</html>
""".strip()


class OBSService:
    def __init__(self):
        settings = self._load_settings()
        self.enabled = bool(settings.get("enabled", OBS_ENABLED))
        self.ws_url = self._normalize_ws_url(settings.get("websocketUrl", OBS_WEBSOCKET_URL))
        self.password = str(settings.get("websocketPassword", OBS_WEBSOCKET_PASSWORD))
        self.ocr_source_name = (
            str(settings.get("ocrSourceName", OBS_OCR_SOURCE_NAME)).strip() or OBS_OCR_SOURCE_NAME
        )
        self.chat_source_name = (
            str(settings.get("chatSourceName", self.ocr_source_name)).strip() or self.ocr_source_name
        )
        self.stage_source_name = (
            str(settings.get("stageSourceName", OBS_STAGE_SOURCE_NAME)).strip() or OBS_STAGE_SOURCE_NAME
        )
        self.stage_url = str(settings.get("stageUrl", DEFAULT_STAGE_URL)).strip() or DEFAULT_STAGE_URL
        self.startup_scene_name = (
            str(settings.get("startupSceneName", OBS_STARTUP_SCENE_NAME)).strip() or OBS_STARTUP_SCENE_NAME
        )
        self.live_scene_name = (
            str(settings.get("liveSceneName", OBS_LIVE_SCENE_NAME)).strip() or OBS_LIVE_SCENE_NAME
        )
        self.transmission_mode = self._normalize_transmission_mode(
            settings.get("transmissionMode", OBS_TRANSMISSION_MODE)
        )
        self.canvas_width = self._positive_int(settings.get("canvasWidth"), OBS_STAGE_CANVAS_WIDTH)
        self.canvas_height = self._positive_int(settings.get("canvasHeight"), OBS_STAGE_CANVAS_HEIGHT)
        raw_whitelist = settings.get("sceneWhitelist", OBS_SCENE_WHITELIST)
        if isinstance(raw_whitelist, str):
            raw_whitelist = raw_whitelist.split(",")
        self.whitelist = [str(scene).strip() for scene in raw_whitelist if str(scene).strip()]
        self.connected = False
        self._client: Any = None

    @staticmethod
    def _positive_int(value: Any, fallback: int) -> int:
        try:
            parsed = int(value)
            return parsed if parsed > 0 else fallback
        except (TypeError, ValueError):
            return fallback

    @staticmethod
    def _normalize_transmission_mode(value: Any) -> str:
        raw = str(value or "stream").strip().lower().replace("-", "_")
        aliases = {
            "obs_stream": "stream",
            "rtmp": "stream",
            "virtualcam": "virtual_camera",
            "virtual_cam": "virtual_camera",
            "camera": "virtual_camera",
            "off": "none",
            "disabled": "none",
        }
        normalized = aliases.get(raw, raw)
        return normalized if normalized in {"stream", "virtual_camera", "none"} else "stream"

    def _load_settings(self) -> dict[str, Any]:
        if not OBS_SETTINGS_FILE.exists():
            return {}
        try:
            return json.loads(OBS_SETTINGS_FILE.read_text(encoding="utf-8"))
        except Exception as exc:
            logger.warning("[OBS_ERROR] Could not load OBS settings: %s", exc)
            return {}

    def _save_settings(self) -> None:
        OBS_SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
        OBS_SETTINGS_FILE.write_text(
            json.dumps(
                {
                    "enabled": self.enabled,
                    "websocketUrl": self.ws_url,
                    "websocketPassword": self.password,
                    "ocrSourceName": self.ocr_source_name,
                    "chatSourceName": self.chat_source_name,
                    "stageSourceName": self.stage_source_name,
                    "stageUrl": self.stage_url,
                    "startupSceneName": self.startup_scene_name,
                    "liveSceneName": self.live_scene_name,
                    "transmissionMode": self.transmission_mode,
                    "canvasWidth": self.canvas_width,
                    "canvasHeight": self.canvas_height,
                    "sceneWhitelist": self.whitelist,
                },
                indent=2,
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )

    @staticmethod
    def _normalize_ws_url(value: Any) -> str:
        raw = str(value or OBS_WEBSOCKET_URL or "ws://localhost:4455").strip()
        if not raw:
            raw = "ws://localhost:4455"
        if not raw.lower().startswith(("ws://", "wss://")):
            raw = f"ws://{raw}"

        scheme, rest = raw.split("://", 1)
        host_port, _, path = rest.partition("/")
        if not host_port:
            host_port = "localhost:4455"
        if ":" not in host_port:
            host_port = f"{host_port}:4455"
        return f"{scheme}://{host_port}{f'/{path}' if path else ''}"

    @staticmethod
    def _is_not_identified_error(message: Any) -> bool:
        normalized = str(message or "").replace("_", "").replace("-", "").lower()
        return any(marker.replace("_", "").replace("-", "") in normalized for marker in NOT_IDENTIFIED_MARKERS)

    def get_settings(self) -> dict[str, Any]:
        return {
            "enabled": self.enabled,
            "websocketUrl": self.ws_url,
            "passwordConfigured": bool(self.password),
            "ocrSourceName": self.ocr_source_name,
            "chatSourceName": self.chat_source_name,
            "stageSourceName": self.stage_source_name,
            "stageUrl": self.stage_url,
            "startupSceneName": self.startup_scene_name,
            "liveSceneName": self.live_scene_name,
            "transmissionMode": self.transmission_mode,
            "canvasWidth": self.canvas_width,
            "canvasHeight": self.canvas_height,
            "sceneWhitelist": self.whitelist,
            "allowedScenes": self.whitelist,
        }

    def get_live_layout(self) -> dict[str, Any]:
        return {
            "chatSourceName": self.chat_source_name,
            "stageSourceName": self.stage_source_name,
            "stageUrl": self.stage_url,
            "startupSceneName": self.startup_scene_name,
            "liveSceneName": self.live_scene_name,
            "transmissionMode": self.transmission_mode,
            "canvasWidth": self.canvas_width,
            "canvasHeight": self.canvas_height,
        }

    async def configure(self, settings: dict[str, Any]) -> dict[str, Any]:
        should_disconnect = False
        if "enabled" in settings:
            self.enabled = bool(settings["enabled"])
        if settings.get("websocketUrl"):
            next_url = self._normalize_ws_url(settings["websocketUrl"])
            if next_url != self.ws_url:
                self.ws_url = next_url
                should_disconnect = True
        elif settings.get("websocketHost") or settings.get("websocketPort"):
            host = str(settings.get("websocketHost") or "localhost").strip() or "localhost"
            port = str(settings.get("websocketPort") or "4455").strip() or "4455"
            next_url = self._normalize_ws_url(f"{host}:{port}")
            if next_url != self.ws_url:
                self.ws_url = next_url
                should_disconnect = True
        if "websocketPassword" in settings and settings["websocketPassword"] is not None:
            next_password = str(settings["websocketPassword"])
            if next_password != self.password:
                self.password = next_password
                should_disconnect = True
        if settings.get("ocrSourceName"):
            self.ocr_source_name = str(settings["ocrSourceName"]).strip() or self.ocr_source_name
            if not settings.get("chatSourceName"):
                self.chat_source_name = self.ocr_source_name
        if settings.get("chatSourceName"):
            self.chat_source_name = str(settings["chatSourceName"]).strip() or self.chat_source_name
            self.ocr_source_name = self.chat_source_name
        if settings.get("stageSourceName"):
            self.stage_source_name = str(settings["stageSourceName"]).strip() or self.stage_source_name
        if settings.get("stageUrl"):
            self.stage_url = str(settings["stageUrl"]).strip() or self.stage_url
        if settings.get("startupSceneName"):
            self.startup_scene_name = str(settings["startupSceneName"]).strip() or self.startup_scene_name
        if settings.get("liveSceneName"):
            self.live_scene_name = str(settings["liveSceneName"]).strip() or self.live_scene_name
        if "transmissionMode" in settings:
            self.transmission_mode = self._normalize_transmission_mode(settings["transmissionMode"])
        if "canvasWidth" in settings:
            self.canvas_width = self._positive_int(settings["canvasWidth"], self.canvas_width)
        if "canvasHeight" in settings:
            self.canvas_height = self._positive_int(settings["canvasHeight"], self.canvas_height)
        if "sceneWhitelist" in settings or "allowedScenes" in settings:
            raw_whitelist = settings.get("allowedScenes", settings.get("sceneWhitelist"))
            if isinstance(raw_whitelist, str):
                raw_whitelist = raw_whitelist.split(",")
            self.whitelist = [str(scene).strip() for scene in raw_whitelist if str(scene).strip()]

        if should_disconnect:
            await self.disconnect()
        self._save_settings()
        return self.get_settings()

    async def connect(self) -> None:
        if not self.enabled:
            raise RuntimeError("OBS WebSocket disabled. Set OBS_ENABLED=true.")
        if simpleobsws is None:
            raise RuntimeError("simpleobsws is not installed. Run pip install -r server/requirements.txt.")
        if self.connected and self._client is not None:
            return

        logger.info("[OBS] Connecting to %s", self.ws_url)
        self._client = simpleobsws.WebSocketClient(url=self.ws_url, password=self.password)
        try:
            await self._client.connect()
            identified = await self._client.wait_until_identified()
            if identified is False:
                raise RuntimeError(
                    "OBS WebSocket identification timed out. Check the OBS WebSocket password/settings."
                )
            self.connected = True
            logger.info("[OBS] Connected")
        except Exception as exc:
            client = self._client
            self.connected = False
            self._client = None
            if client is not None:
                try:
                    await client.disconnect()
                except Exception:
                    pass
            logger.error("[OBS_ERROR] WebSocket offline or authentication failed: %s", exc)
            raise RuntimeError(f"OBS WebSocket unavailable: {exc}") from exc

    async def disconnect(self) -> None:
        if self._client is None:
            self.connected = False
            return
        try:
            await self._client.disconnect()
        except Exception as exc:
            logger.warning("[OBS_ERROR] Disconnect failed: %s", exc)
        finally:
            self.connected = False
            self._client = None

    async def _call(
        self,
        request_type: str,
        request_data: Optional[dict[str, Any]] = None,
        *,
        _retry_not_identified: bool = True,
    ) -> dict[str, Any]:
        await self.connect()
        assert self._client is not None
        try:
            response = await self._client.call(simpleobsws.Request(request_type, request_data or {}))
        except Exception as exc:
            self.connected = False
            if _retry_not_identified and self._is_not_identified_error(exc):
                logger.warning("[OBS] %s ran before Identify completed; reconnecting once", request_type)
                await self.disconnect()
                return await self._call(
                    request_type,
                    request_data,
                    _retry_not_identified=False,
                )
            logger.error("[OBS_ERROR] %s failed: %s", request_type, exc)
            raise RuntimeError(f"{request_type} failed: {exc}") from exc

        ok = response.ok() if callable(getattr(response, "ok", None)) else bool(getattr(response, "ok", False))
        if not ok:
            status = getattr(response, "requestStatus", None) or {}
            comment = ""
            if isinstance(status, dict):
                comment = str(status.get("comment") or status.get("code") or "")
            elif status:
                comment = str(status)
            if _retry_not_identified and self._is_not_identified_error(comment):
                logger.warning("[OBS] %s was rejected before Identify completed; reconnecting once", request_type)
                self.connected = False
                await self.disconnect()
                return await self._call(
                    request_type,
                    request_data,
                    _retry_not_identified=False,
                )
            logger.error("[OBS_ERROR] %s rejected: %s", request_type, comment or "unknown error")
            raise RuntimeError(f"{request_type} rejected: {comment or 'unknown error'}")
        return getattr(response, "responseData", None) or {}

    async def get_version(self) -> dict[str, Any]:
        return await self._call("GetVersion")

    async def get_scene_list(self) -> dict[str, Any]:
        data = await self._call("GetSceneList")
        scenes = [scene.get("sceneName") for scene in data.get("scenes", []) if scene.get("sceneName")]
        current_scene = data.get("currentProgramSceneName")
        logger.info("[OBS] Current scene: %s", current_scene)
        return {
            "ok": True,
            "scenes": scenes,
            "currentScene": current_scene,
            "allowedScenes": self.whitelist,
            "error": None,
        }

    async def get_input_list(self) -> dict[str, Any]:
        data = await self._call("GetInputList")
        inputs = [
            {
                "name": item.get("inputName"),
                "kind": item.get("inputKind"),
                "uuid": item.get("inputUuid"),
            }
            for item in data.get("inputs", [])
            if item.get("inputName")
        ]
        return {"ok": True, "inputs": inputs, "error": None}

    async def get_source_inventory(self) -> dict[str, Any]:
        scene_data = await self.get_scene_list()
        scenes = scene_data.get("scenes", [])
        current_scene = scene_data.get("currentScene")
        input_data = await self.get_input_list()
        inputs = input_data.get("inputs", [])
        scene_items: list[dict[str, Any]] = []

        for scene_name in scenes:
            try:
                data = await self._call("GetSceneItemList", {"sceneName": scene_name})
            except Exception as exc:
                scene_items.append(
                    {
                        "sceneName": scene_name,
                        "sourceName": None,
                        "enabled": False,
                        "error": str(exc),
                    }
                )
                continue
            for item in data.get("sceneItems", []):
                scene_items.append(
                    {
                        "sceneName": scene_name,
                        "sourceName": item.get("sourceName"),
                        "sourceType": item.get("sourceType"),
                        "inputKind": item.get("inputKind"),
                        "enabled": bool(item.get("sceneItemEnabled")),
                        "sceneItemId": item.get("sceneItemId"),
                    }
                )

        source_names = sorted(
            {
                str(value).strip()
                for value in [
                    *[item.get("name") for item in inputs],
                    *[item.get("sourceName") for item in scene_items],
                ]
                if str(value or "").strip()
            },
            key=str.casefold,
        )
        return {
            "ok": True,
            "scenes": scenes,
            "currentScene": current_scene,
            "inputs": inputs,
            "sceneItems": scene_items,
            "sources": source_names,
            "allowedScenes": self.whitelist,
            "error": None,
        }

    async def source_exists(self, source_name: str) -> dict[str, Any]:
        target = source_name.strip()
        inventory = await self.get_source_inventory()
        exact_inputs = [
            item for item in inventory.get("inputs", []) if item.get("name", "").lower() == target.lower()
        ]
        exact_items = [
            item
            for item in inventory.get("sceneItems", [])
            if str(item.get("sourceName", "")).lower() == target.lower()
        ]
        exact_scenes = [
            scene for scene in inventory.get("scenes", []) if str(scene).lower() == target.lower()
        ]
        candidates = [
            name
            for name in [*inventory.get("sources", []), *inventory.get("scenes", [])]
            if target.lower() in name.lower() or name.lower() in target.lower()
        ]
        return {
            "exists": bool(exact_inputs or exact_items or exact_scenes),
            "inputExists": bool(exact_inputs or exact_items),
            "sceneExists": bool(exact_scenes),
            "inputs": exact_inputs,
            "sceneItems": exact_items,
            "scenes": exact_scenes,
            "candidates": candidates[:8],
            "inventory": inventory,
        }

    @staticmethod
    def _browser_source_url(url: Optional[str]) -> str:
        if url and str(url).strip():
            return str(url).strip()
        return "data:text/html;charset=utf-8," + urllib.parse.quote(DEFAULT_BROWSER_SOURCE_HTML)

    def _browser_source_settings(
        self,
        url: Optional[str],
        width: int,
        height: int,
    ) -> dict[str, Any]:
        settings: dict[str, Any] = {
            "width": int(width or 1280),
            "height": int(height or 720),
            "reroute_audio": False,
            "restart_when_active": False,
            "shutdown": False,
        }
        if url and str(url).strip():
            settings.update({"is_local_file": False, "url": str(url).strip()})
            return settings
        if DEFAULT_BROWSER_SOURCE_FILE.exists():
            settings.update(
                {
                    "is_local_file": True,
                    "local_file": str(DEFAULT_BROWSER_SOURCE_FILE),
                }
            )
            return settings
        settings.update({"is_local_file": False, "url": self._browser_source_url(url)})
        return settings

    async def repair_browser_source_placeholder(
        self,
        source_name: str,
        url: Optional[str],
        width: int,
        height: int,
    ) -> dict[str, Any] | None:
        try:
            data = await self._call("GetInputSettings", {"inputName": source_name})
        except Exception:
            return None
        if data.get("inputKind") != "browser_source":
            return None
        current = data.get("inputSettings", {})
        current_url = str(current.get("url") or "")
        current_local_file = str(current.get("local_file") or "")
        should_update = bool(url and str(url).strip()) or (
            not current_local_file and (not current_url or current_url.startswith("data:text/html"))
        )
        if not should_update:
            return None
        settings = self._browser_source_settings(url, width, height)
        await self._call(
            "SetInputSettings",
            {"inputName": source_name, "inputSettings": settings, "overlay": True},
        )
        return {"ok": True, "sourceName": source_name, "updatedSettings": True}

    async def refresh_browser_source(self, source_name: Optional[str] = None) -> dict[str, Any]:
        target_source = (source_name or self.chat_source_name or self.ocr_source_name).strip()
        if not target_source:
            return {"ok": False, "status": "blocked", "sourceName": target_source, "error": "source_missing"}

        input_kind = None
        try:
            settings = await self._call("GetInputSettings", {"inputName": target_source})
            input_kind = settings.get("inputKind")
        except Exception as exc:
            logger.warning("[OBS] Could not inspect source before refresh (%s): %s", target_source, exc)

        if input_kind and input_kind != "browser_source":
            return {
                "ok": False,
                "status": "skipped",
                "sourceName": target_source,
                "inputKind": input_kind,
                "error": "source_is_not_browser_source",
            }

        await self._call(
            "PressInputPropertiesButton",
            {"inputName": target_source, "propertyName": "refreshnocache"},
        )
        logger.info("[OBS] Browser Source refreshed without cache: %s", target_source)
        return {
            "ok": True,
            "status": "refreshed",
            "sourceName": target_source,
            "inputKind": input_kind or "browser_source",
            "propertyName": "refreshnocache",
            "error": None,
        }

    async def ensure_source_scene_item(
        self,
        source_name: str,
        scene_name: str,
        off_canvas: bool = True,
        scene_item_enabled: bool = True,
        transform: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        scene_items = await self._call("GetSceneItemList", {"sceneName": scene_name})
        existing_item = next(
            (
                item
                for item in scene_items.get("sceneItems", [])
                if str(item.get("sourceName", "")).lower() == source_name.lower()
            ),
            None,
        )
        created = False
        if existing_item:
            scene_item_id = existing_item.get("sceneItemId")
            if bool(existing_item.get("sceneItemEnabled")) != scene_item_enabled:
                await self._call(
                    "SetSceneItemEnabled",
                    {
                        "sceneName": scene_name,
                        "sceneItemId": scene_item_id,
                        "sceneItemEnabled": scene_item_enabled,
                    },
                )
        else:
            data = await self._call(
                "CreateSceneItem",
                {
                    "sceneName": scene_name,
                    "sourceName": source_name,
                    "sceneItemEnabled": scene_item_enabled,
                },
            )
            scene_item_id = data.get("sceneItemId")
            created = True

        if scene_item_id is not None and (off_canvas or transform):
            next_transform = transform or {
                "positionX": -4000.0,
                "positionY": -4000.0,
                "scaleX": 1.0,
                "scaleY": 1.0,
            }
            await self._call(
                "SetSceneItemTransform",
                {
                    "sceneName": scene_name,
                    "sceneItemId": scene_item_id,
                    "sceneItemTransform": next_transform,
                },
            )

        return {
            "ok": True,
            "created": created,
            "sceneName": scene_name,
            "sceneItemId": scene_item_id,
            "offCanvas": off_canvas,
            "enabled": scene_item_enabled,
            "transform": transform,
            "error": None,
        }

    async def ensure_browser_source(
        self,
        source_name: Optional[str] = None,
        scene_name: Optional[str] = None,
        url: Optional[str] = None,
        width: int = 1280,
        height: int = 720,
        remember_as_ocr: bool = True,
    ) -> dict[str, Any]:
        target_source = (source_name or self.ocr_source_name).strip() or self.ocr_source_name
        inventory = await self.get_source_inventory()
        target_scene = (scene_name or inventory.get("currentScene") or "").strip()
        if not target_scene:
            return {"ok": False, "created": False, "sourceName": target_source, "error": "scene_missing"}

        state = await self.source_exists(target_source)
        current_scene = inventory.get("currentScene")
        if state["inputExists"]:
            settings_repair = await self.repair_browser_source_placeholder(
                target_source,
                url,
                width,
                height,
            )
            render_item = None
            if current_scene:
                render_item = await self.ensure_source_scene_item(target_source, current_scene, off_canvas=True)
            return {
                "ok": True,
                "created": False,
                "sourceName": target_source,
                "sceneName": target_scene,
                "renderSceneItem": render_item,
                "settingsRepair": settings_repair,
                "sources": state["inventory"].get("sources", []),
                "error": None,
            }

        renamed_scene = None
        if state["sceneExists"]:
            existing_scenes = set(str(scene) for scene in inventory.get("scenes", []))
            base_scene_name = f"{target_source} Scene"
            next_scene_name = base_scene_name
            suffix = 2
            while next_scene_name in existing_scenes:
                next_scene_name = f"{base_scene_name} {suffix}"
                suffix += 1
            conflict_scene = state["scenes"][0]
            await self._call(
                "SetSceneName",
                {"sceneName": conflict_scene, "newSceneName": next_scene_name},
            )
            renamed_scene = {"from": conflict_scene, "to": next_scene_name}
            target_scene = next_scene_name
            logger.info("[OBS] Renamed scene name conflict: %s -> %s", conflict_scene, next_scene_name)

        settings = self._browser_source_settings(url, width, height)
        await self._call(
            "CreateInput",
            {
                "sceneName": target_scene,
                "inputName": target_source,
                "inputKind": "browser_source",
                "inputSettings": settings,
                "sceneItemEnabled": True,
            },
        )
        logger.info("[OBS] Created Browser Source: %s in scene %s", target_source, target_scene)
        render_item = None
        if current_scene:
            render_item = await self.ensure_source_scene_item(target_source, current_scene, off_canvas=True)
        if remember_as_ocr:
            self.ocr_source_name = target_source
            self.chat_source_name = target_source
            self._save_settings()
        return {
            "ok": True,
            "created": True,
            "sourceName": target_source,
            "sceneName": target_scene,
            "inputKind": "browser_source",
            "renamedScene": renamed_scene,
            "renderSceneItem": render_item,
            "error": None,
        }

    async def configure_live_layout(self, settings: dict[str, Any]) -> dict[str, Any]:
        await self.configure(settings)
        return self.get_live_layout()

    def _allow_managed_scene(self, scene_name: str) -> None:
        clean = str(scene_name or "").strip()
        if not clean:
            return
        if not any(scene.lower() == clean.lower() for scene in self.whitelist):
            self.whitelist.append(clean)

    async def ensure_scene(self, scene_name: str) -> dict[str, Any]:
        requested = str(scene_name or "").strip()
        if not requested:
            return {"ok": False, "created": False, "sceneName": requested, "error": "scene_missing"}

        scene_data = await self.get_scene_list()
        existing = next(
            (scene for scene in scene_data.get("scenes", []) if str(scene).lower() == requested.lower()),
            None,
        )
        if existing:
            return {"ok": True, "created": False, "sceneName": existing, "error": None}

        await self._call("CreateScene", {"sceneName": requested})
        logger.info("[OBS] Created scene: %s", requested)
        return {"ok": True, "created": True, "sceneName": requested, "error": None}

    async def get_video_settings(self) -> dict[str, Any]:
        data = await self._call("GetVideoSettings")
        base_width = self._positive_int(data.get("baseWidth") or data.get("base_width"), 1920)
        base_height = self._positive_int(data.get("baseHeight") or data.get("base_height"), 1080)
        output_width = self._positive_int(data.get("outputWidth") or data.get("output_width"), base_width)
        output_height = self._positive_int(data.get("outputHeight") or data.get("output_height"), base_height)
        return {
            "baseWidth": base_width,
            "baseHeight": base_height,
            "outputWidth": output_width,
            "outputHeight": output_height,
            "raw": data,
        }

    @staticmethod
    def _fit_transform(
        source_width: int,
        source_height: int,
        canvas_width: int,
        canvas_height: int,
    ) -> dict[str, Any]:
        safe_source_width = max(1, int(source_width or 1))
        safe_source_height = max(1, int(source_height or 1))
        safe_canvas_width = max(1, int(canvas_width or safe_source_width))
        safe_canvas_height = max(1, int(canvas_height or safe_source_height))
        scale = min(
            safe_canvas_width / safe_source_width,
            safe_canvas_height / safe_source_height,
        )
        rendered_width = safe_source_width * scale
        rendered_height = safe_source_height * scale
        return {
            "positionX": round((safe_canvas_width - rendered_width) / 2, 3),
            "positionY": round((safe_canvas_height - rendered_height) / 2, 3),
            "scaleX": scale,
            "scaleY": scale,
            "rotation": 0.0,
            "cropLeft": 0,
            "cropRight": 0,
            "cropTop": 0,
            "cropBottom": 0,
        }

    async def setup_live_scene(self) -> dict[str, Any]:
        self._allow_managed_scene(self.startup_scene_name)
        self._allow_managed_scene(self.live_scene_name)
        self._save_settings()

        video_settings = await self.get_video_settings()
        obs_canvas_width = video_settings["baseWidth"]
        obs_canvas_height = video_settings["baseHeight"]

        start_scene = await self.ensure_scene(self.startup_scene_name)
        live_scene = await self.ensure_scene(self.live_scene_name)
        if not start_scene.get("ok") or not live_scene.get("ok"):
            return {
                "ok": False,
                "layout": self.get_live_layout(),
                "error": start_scene.get("error") or live_scene.get("error") or "scene_setup_failed",
            }

        stage_source = (self.stage_source_name or OBS_STAGE_SOURCE_NAME).strip()
        chat_source = (self.chat_source_name or self.ocr_source_name or OBS_OCR_SOURCE_NAME).strip()
        stage_transform = self._fit_transform(
            self.canvas_width,
            self.canvas_height,
            obs_canvas_width,
            obs_canvas_height,
        )

        stage_input = await self.ensure_browser_source(
            source_name=stage_source,
            scene_name=self.live_scene_name,
            url=self.stage_url,
            width=self.canvas_width,
            height=self.canvas_height,
            remember_as_ocr=False,
        )
        await self.repair_browser_source_placeholder(
            stage_source,
            self.stage_url,
            self.canvas_width,
            self.canvas_height,
        )

        live_stage_item = await self.ensure_source_scene_item(
            stage_source,
            self.live_scene_name,
            off_canvas=False,
            scene_item_enabled=True,
            transform=stage_transform,
        )
        start_stage_item = await self.ensure_source_scene_item(
            stage_source,
            self.startup_scene_name,
            off_canvas=False,
            scene_item_enabled=True,
            transform=stage_transform,
        )

        chat_input = await self.ensure_browser_source(
            source_name=chat_source,
            scene_name=self.live_scene_name,
            width=1280,
            height=720,
            remember_as_ocr=True,
        )
        chat_item = await self.ensure_source_scene_item(
            chat_source,
            self.live_scene_name,
            off_canvas=True,
            scene_item_enabled=True,
        )

        self.stage_source_name = stage_source
        self.chat_source_name = chat_source
        self.ocr_source_name = chat_source
        self._save_settings()

        source_refreshes = []
        for refresh_source in (stage_source, chat_source):
            try:
                source_refreshes.append(await self.refresh_browser_source(refresh_source))
            except Exception as exc:
                source_refreshes.append(
                    {
                        "ok": False,
                        "status": "error",
                        "sourceName": refresh_source,
                        "error": str(exc),
                    }
                )

        return {
            "ok": True,
            "layout": self.get_live_layout(),
            "videoSettings": video_settings,
            "scenes": {
                "startup": start_scene,
                "live": live_scene,
            },
            "stageSource": stage_input,
            "chatSource": chat_input,
            "sceneItems": {
                "liveStage": live_stage_item,
                "startupStage": start_stage_item,
                "chat": chat_item,
            },
            "sourceRefreshes": source_refreshes,
            "allowedScenes": self.whitelist,
            "error": None,
        }

    async def prepare_capture_source(self, source_name: Optional[str] = None) -> dict[str, Any]:
        target_source = (source_name or self.chat_source_name or self.ocr_source_name).strip()
        setup = await self.setup_live_scene()
        stage = await self.show_stage_scene()
        refresh = await self.refresh_browser_source(target_source)
        health = await self.health_check(target_source)
        return {
            "ok": bool(health.get("ok")),
            "status": "ready" if health.get("ok") else "not_ready",
            "sourceName": target_source,
            "setup": setup,
            "stage": stage,
            "refresh": refresh,
            "health": health,
            "error": None if health.get("ok") else health.get("error"),
        }

    async def show_start_scene(self) -> dict[str, Any]:
        self._allow_managed_scene(self.startup_scene_name)
        self._save_settings()
        return await self.switch_scene(self.startup_scene_name)

    async def show_stage_scene(self) -> dict[str, Any]:
        self._allow_managed_scene(self.live_scene_name)
        self._save_settings()
        return await self.switch_scene(self.live_scene_name)

    async def get_transmission_status(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "ok": True,
            "mode": self.transmission_mode,
            "streamActive": False,
            "virtualCameraActive": False,
            "streamError": None,
            "virtualCameraError": None,
        }
        try:
            stream = await self._call("GetStreamStatus")
            result["streamActive"] = bool(stream.get("outputActive") or stream.get("streaming"))
            result["streamRaw"] = stream
        except Exception as exc:
            result["streamError"] = str(exc)

        try:
            virtual_camera = await self._call("GetVirtualCamStatus")
            result["virtualCameraActive"] = bool(
                virtual_camera.get("outputActive")
                or virtual_camera.get("virtualCamActive")
                or virtual_camera.get("active")
            )
            result["virtualCameraRaw"] = virtual_camera
        except Exception as exc:
            result["virtualCameraError"] = str(exc)

        if result["streamError"] and result["virtualCameraError"]:
            result["ok"] = False
            result["error"] = f"{result['streamError']} | {result['virtualCameraError']}"
        else:
            result["error"] = None
        return result

    async def start_transmission(self, mode: Optional[str] = None) -> dict[str, Any]:
        target_mode = self._normalize_transmission_mode(mode or self.transmission_mode)
        if target_mode == "none":
            return {"ok": True, "status": "skipped", "mode": target_mode, "error": None}

        status = await self.get_transmission_status()
        if target_mode == "stream":
            if status.get("streamActive"):
                return {"ok": True, "status": "already_active", "mode": target_mode, "error": None}
            await self._call("StartStream")
        else:
            if status.get("virtualCameraActive"):
                return {"ok": True, "status": "already_active", "mode": target_mode, "error": None}
            await self._call("StartVirtualCam")
        return {"ok": True, "status": "started", "mode": target_mode, "error": None}

    async def stop_transmission(self, mode: Optional[str] = None) -> dict[str, Any]:
        target_mode = self._normalize_transmission_mode(mode or self.transmission_mode)
        if target_mode == "none":
            return {"ok": True, "status": "skipped", "mode": target_mode, "error": None}

        status = await self.get_transmission_status()
        if target_mode == "stream":
            if not status.get("streamActive"):
                return {"ok": True, "status": "already_stopped", "mode": target_mode, "error": None}
            await self._call("StopStream")
        else:
            if not status.get("virtualCameraActive"):
                return {"ok": True, "status": "already_stopped", "mode": target_mode, "error": None}
            await self._call("StopVirtualCam")
        return {"ok": True, "status": "stopped", "mode": target_mode, "error": None}

    async def live_health(self) -> dict[str, Any]:
        base: dict[str, Any] = {
            "ok": False,
            "connected": False,
            "layout": self.get_live_layout(),
            "currentScene": None,
            "availableScenes": [],
            "allowedScenes": self.whitelist,
            "chatSourceReady": False,
            "stageSourceReady": False,
            "startupSceneReady": False,
            "liveSceneReady": False,
            "screenshotReady": False,
            "transmission": None,
            "error": None,
        }

        try:
            await self.connect()
            base["connected"] = True
            inventory = await self.get_source_inventory()
            scenes = inventory.get("scenes", [])
            base["currentScene"] = inventory.get("currentScene")
            base["availableScenes"] = scenes
            base["allowedScenes"] = self.whitelist
            base["startupSceneReady"] = any(
                scene.lower() == self.startup_scene_name.lower() for scene in scenes
            )
            base["liveSceneReady"] = any(scene.lower() == self.live_scene_name.lower() for scene in scenes)

            chat_presence = await self.source_exists(self.chat_source_name)
            stage_presence = await self.source_exists(self.stage_source_name)
            base["chatSourceExists"] = chat_presence["exists"]
            base["stageSourceExists"] = stage_presence["exists"]
            base["chatSourceNames"] = [
                item.get("sceneName") for item in chat_presence.get("sceneItems", []) if item.get("sceneName")
            ]
            base["stageSourceNames"] = [
                item.get("sceneName") for item in stage_presence.get("sceneItems", []) if item.get("sceneName")
            ]
            base["chatSourceReady"] = bool(chat_presence["inputExists"])
            base["stageSourceReady"] = bool(stage_presence["inputExists"])

            if base["chatSourceReady"]:
                try:
                    screenshot = await self.get_source_screenshot(self.chat_source_name)
                    base["screenshotReady"] = True
                    base["chatImageWidth"] = screenshot["width"]
                    base["chatImageHeight"] = screenshot["height"]
                    base["sourceActive"] = screenshot.get("sourceActive")
                    base["sourceShowing"] = screenshot.get("sourceShowing")
                    base["frameHash"] = screenshot.get("frameHash")
                    base["capturedAt"] = screenshot.get("capturedAt")
                except Exception as exc:
                    base["screenshotError"] = str(exc)

            try:
                base["videoSettings"] = await self.get_video_settings()
            except Exception as exc:
                base["videoSettingsError"] = str(exc)

            try:
                base["transmission"] = await self.get_transmission_status()
            except Exception as exc:
                base["transmission"] = {"ok": False, "error": str(exc)}

            missing = [
                label
                for label, ready in [
                    ("startup_scene", base["startupSceneReady"]),
                    ("live_scene", base["liveSceneReady"]),
                    ("chat_source", base["chatSourceReady"]),
                    ("stage_source", base["stageSourceReady"]),
                    ("chat_screenshot", base["screenshotReady"]),
                ]
                if not ready
            ]
            base["ok"] = not missing
            base["error"] = None if not missing else f"Live layout incomplete: {', '.join(missing)}"
            return base
        except Exception as exc:
            logger.error("[OBS_ERROR] live health failed: %s", exc)
            return {**base, "connected": self.connected, "error": str(exc)}

    async def get_current_program_scene(self) -> Optional[str]:
        data = await self._call("GetCurrentProgramScene")
        current_scene = data.get("currentProgramSceneName")
        logger.info("[OBS] Current scene: %s", current_scene)
        return current_scene

    async def get_source_active(self, source_name: str) -> dict[str, Any]:
        data = await self._call("GetSourceActive", {"sourceName": source_name})
        active = bool(data.get("sourceActive") or data.get("videoActive"))
        showing = bool(data.get("sourceShowing") or data.get("videoShowing"))
        logger.info("[OBS] Source active: %s", active or showing)
        return {"active": active, "showing": showing, "raw": data}

    async def get_source_screenshot(
        self,
        source_name: str,
        width: Optional[int] = None,
        height: Optional[int] = None,
        image_format: str = "png",
        source_state: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        active_state = source_state
        if active_state is None:
            try:
                active_state = await self.get_source_active(source_name)
            except Exception as exc:
                active_state = {"active": None, "showing": None, "error": str(exc)}

        request_data: dict[str, Any] = {
            "sourceName": source_name,
            "imageFormat": (image_format or "png").lstrip("."),
        }
        if width:
            request_data["imageWidth"] = int(width)
        if height:
            request_data["imageHeight"] = int(height)

        data = await self._call("GetSourceScreenshot", request_data)
        image_data = data.get("imageData") or ""
        image, image_width, image_height = self._validate_screenshot(image_data)
        frame_hash = self._frame_hash(image)
        captured_at = datetime.now(timezone.utc).isoformat()
        logger.info("[OBS] OCR source: %s", source_name)
        logger.info("[OBS] Screenshot captured: %sx%s", image_width, image_height)
        return {
            "ok": True,
            "image": image,
            "width": image_width,
            "height": image_height,
            "sourceName": source_name,
            "sourceActive": active_state.get("active") if isinstance(active_state, dict) else None,
            "sourceShowing": active_state.get("showing") if isinstance(active_state, dict) else None,
            "sourceState": active_state,
            "frameHash": frame_hash,
            "capturedAt": captured_at,
            "error": None,
        }

    async def switch_scene(self, scene_name: str) -> dict[str, Any]:
        requested_scene = scene_name.strip()
        allowed_scene = next(
            (scene for scene in self.whitelist if scene.lower() == requested_scene.lower()),
            None,
        )
        if not allowed_scene:
            logger.warning("[OBS] Blocked scene outside whitelist: %s", requested_scene)
            return {"ok": False, "status": "blocked", "error": "scene_not_whitelisted"}

        await self._call("SetCurrentProgramScene", {"sceneName": allowed_scene})
        logger.info("[ACTION] obs.switch_scene -> %s", allowed_scene)
        return {
            "ok": True,
            "status": "done",
            "scene": allowed_scene,
            "currentScene": allowed_scene,
            "sceneName": allowed_scene,
            "error": None,
        }

    async def health_check(self, source_name: Optional[str] = None) -> dict[str, Any]:
        target_source = (source_name or self.ocr_source_name).strip() or self.ocr_source_name
        base = {
            "ok": False,
            "connected": False,
            "sourceReady": False,
            "sourceName": target_source,
            "currentScene": None,
            "screenshotReady": False,
            "sceneSwitchReady": False,
            "availableScenes": [],
            "allowedScenes": self.whitelist,
            "imageWidth": None,
            "imageHeight": None,
            "sourceActive": None,
            "sourceShowing": None,
            "frameHash": None,
            "capturedAt": None,
            "error": None,
        }

        try:
            await self.connect()
            base["connected"] = True
            scene_data = await self.get_scene_list()
            available_scenes = scene_data.get("scenes", [])
            current_scene = scene_data.get("currentScene")
            base["currentScene"] = current_scene
            base["availableScenes"] = available_scenes
            base["allowedScenes"] = self.whitelist
            base["sceneSwitchReady"] = bool(
                self.whitelist
                and any(
                    allowed.lower() == scene.lower()
                    for allowed in self.whitelist
                    for scene in available_scenes
                )
            )
            source_presence = await self.source_exists(target_source)
            base["sourceExists"] = source_presence["exists"]
            base["availableSources"] = source_presence["inventory"].get("sources", [])
            base["sourceCandidates"] = source_presence["candidates"]
            base["sourceSceneNames"] = [
                item.get("sceneName") for item in source_presence.get("sceneItems", []) if item.get("sceneName")
            ]
            if not source_presence["exists"]:
                return {
                    **base,
                    "connected": True,
                    "error": (
                        f'Source not found: "{target_source}". '
                        f"Available sources: {', '.join(source_presence['inventory'].get('sources', [])[:12]) or 'none'}"
                    ),
                }
            if source_presence["sceneExists"] and not source_presence["inputExists"]:
                return {
                    **base,
                    "connected": True,
                    "sourceExists": True,
                    "error": (
                        f'"{target_source}" exists as a scene, not as an OCR source/input. '
                        "Use /obs/ensure-ocr-source or create a Browser Source with this exact name."
                    ),
                }
            source_state = await self.get_source_active(target_source)
            screenshot = await self.get_source_screenshot(target_source, source_state=source_state)
            base.update(
                {
                    "ok": True,
                    "sourceReady": bool(source_state["active"] or source_state["showing"] or screenshot["ok"]),
                    "screenshotReady": True,
                    "imageWidth": screenshot["width"],
                    "imageHeight": screenshot["height"],
                    "sourceActive": source_state.get("active"),
                    "sourceShowing": source_state.get("showing"),
                    "frameHash": screenshot.get("frameHash"),
                    "capturedAt": screenshot.get("capturedAt"),
                    "error": None,
                }
            )
            return base
        except Exception as exc:
            message = str(exc)
            if "GetSourceActive" in message or "GetSourceScreenshot" in message:
                message = f'Source not ready: "{target_source}" ({message})'
            logger.error("[OBS_ERROR] %s", message)
            return {**base, "connected": self.connected, "error": message}

    @staticmethod
    def _frame_hash(image_data: str) -> str:
        encoded = image_data.split(",", 1)[1] if "," in image_data else image_data
        try:
            raw = base64.b64decode(encoded)
        except Exception:
            raw = image_data.encode("utf-8", errors="ignore")
        return hashlib.sha256(raw).hexdigest()[:24]

    @staticmethod
    def _validate_screenshot(image_data: str) -> tuple[str, int, int]:
        if not image_data or not isinstance(image_data, str):
            raise RuntimeError("Screenshot empty or invalid")

        if "," in image_data:
            header, encoded = image_data.split(",", 1)
            mime = header.split(";")[0].replace("data:", "") or "image/png"
        else:
            encoded = image_data
            mime = "image/png"

        try:
            raw = base64.b64decode(encoded)
            with Image.open(io.BytesIO(raw)) as image:
                rgba = image.convert("RGBA")
                width, height = rgba.size
                if width < 2 or height < 2:
                    raise RuntimeError("Screenshot empty or invalid")

                alpha = rgba.getchannel("A")
                alpha_extrema = alpha.getextrema()
                if alpha_extrema[1] <= 2:
                    raise RuntimeError("Screenshot empty or transparent")

                rgb = rgba.convert("RGB")
                stat = ImageStat.Stat(rgb)
                channel_max = max(max(extrema) for extrema in stat.extrema)
                mean_luma = sum(stat.mean) / len(stat.mean)
                if channel_max <= 8 and mean_luma <= 3:
                    raise RuntimeError("Screenshot empty or black")
        except UnidentifiedImageError as exc:
            raise RuntimeError("Screenshot empty or invalid") from exc

        normalized = image_data if image_data.startswith("data:image/") else f"data:{mime};base64,{encoded}"
        return normalized, width, height


obs_service = OBSService()
