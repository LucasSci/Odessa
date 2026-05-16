import base64
import io

import pytest
from PIL import Image

from server.services.obs_service import OBSService


def _data_url(color: tuple[int, int, int, int]) -> str:
    image = Image.new("RGBA", (16, 16), color)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def test_validate_screenshot_accepts_non_empty_image():
    image, width, height = OBSService._validate_screenshot(_data_url((20, 40, 80, 255)))

    assert image.startswith("data:image/png;base64,")
    assert width == 16
    assert height == 16


def test_validate_screenshot_rejects_black_image():
    with pytest.raises(RuntimeError, match="black"):
        OBSService._validate_screenshot(_data_url((0, 0, 0, 255)))


def test_validate_screenshot_rejects_transparent_image():
    with pytest.raises(RuntimeError, match="transparent"):
        OBSService._validate_screenshot(_data_url((255, 255, 255, 0)))


@pytest.mark.asyncio
async def test_switch_scene_uses_whitelisted_scene_case_insensitively():
    service = OBSService()
    service.whitelist = ["Live Principal"]
    calls = []

    async def fake_call(request_type, request_data):
        calls.append((request_type, request_data))
        return {}

    service._call = fake_call

    result = await service.switch_scene("live principal")

    assert result["ok"] is True
    assert result["scene"] == "Live Principal"
    assert calls == [("SetCurrentProgramScene", {"sceneName": "Live Principal"})]


@pytest.mark.asyncio
async def test_switch_scene_blocks_non_whitelisted_scene():
    service = OBSService()
    service.whitelist = ["Live Principal"]

    result = await service.switch_scene("Outra Cena")

    assert result["ok"] is False
    assert result["status"] == "blocked"


@pytest.mark.asyncio
async def test_action_executor_accepts_scene_aliases(monkeypatch):
    from server.services.automation.executor import action_executor

    calls = []

    async def fake_switch(scene):
        calls.append(scene)
        return {"ok": True, "status": "done", "sceneName": scene}

    monkeypatch.setattr("server.services.automation.executor.obs_service.switch_scene", fake_switch)

    result = await action_executor.execute(
        {"type": "switch_scene", "payload": {"sceneName": "Live Principal"}}
    )

    assert result["status"] == "done"
    assert calls == ["Live Principal"]


def test_get_settings_exposes_allowed_scenes_alias():
    service = OBSService()
    service.whitelist = ["Live Principal", "Idle"]

    settings = service.get_settings()

    assert settings["allowedScenes"] == ["Live Principal", "Idle"]
    assert settings["sceneWhitelist"] == ["Live Principal", "Idle"]


@pytest.mark.asyncio
async def test_connect_fails_when_identification_times_out(monkeypatch):
    service = OBSService()
    service.enabled = True
    disconnected = False

    class FakeClient:
        async def connect(self):
            return None

        async def wait_until_identified(self):
            return False

        async def disconnect(self):
            nonlocal disconnected
            disconnected = True

    class FakeSimpleObs:
        @staticmethod
        def WebSocketClient(**_kwargs):
            return FakeClient()

    monkeypatch.setattr("server.services.obs_service.simpleobsws", FakeSimpleObs)

    with pytest.raises(RuntimeError, match="identification timed out"):
        await service.connect()

    assert disconnected is True
    assert service.connected is False
    assert service._client is None


@pytest.mark.asyncio
async def test_call_retries_once_after_not_identified(monkeypatch):
    service = OBSService()
    service.enabled = True
    attempts = 0

    class FakeRequest:
        def __init__(self, request_type, request_data):
            self.request_type = request_type
            self.request_data = request_data

    class FakeResponse:
        responseData = {"retried": True}

        def ok(self):
            return True

    class FakeClient:
        async def connect(self):
            return None

        async def wait_until_identified(self):
            return True

        async def disconnect(self):
            return None

        async def call(self, _request):
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                raise RuntimeError(
                    "Calls to requests cannot be made without being identified with obs-websocket."
                )
            return FakeResponse()

    class FakeSimpleObs:
        Request = FakeRequest

        @staticmethod
        def WebSocketClient(**_kwargs):
            return FakeClient()

    monkeypatch.setattr("server.services.obs_service.simpleobsws", FakeSimpleObs)

    result = await service._call("GetSceneList")

    assert result == {"retried": True}
    assert attempts == 2
    assert service.connected is True


@pytest.mark.asyncio
async def test_get_source_active_accepts_obs_video_keys():
    service = OBSService()

    async def fake_call(request_type, request_data):
        assert request_type == "GetSourceActive"
        assert request_data == {"sourceName": "Odessa Chat OCR"}
        return {"videoActive": True, "videoShowing": True}

    service._call = fake_call

    result = await service.get_source_active("Odessa Chat OCR")

    assert result["active"] is True
    assert result["showing"] is True


@pytest.mark.asyncio
async def test_refresh_browser_source_presses_refreshnocache():
    service = OBSService()
    calls = []

    async def fake_call(request_type, request_data=None):
        calls.append((request_type, request_data or {}))
        if request_type == "GetInputSettings":
            return {"inputKind": "browser_source", "inputSettings": {}}
        if request_type == "PressInputPropertiesButton":
            return {}
        raise AssertionError(request_type)

    service._call = fake_call

    result = await service.refresh_browser_source("Odessa Chat OCR")

    assert result["ok"] is True
    assert result["propertyName"] == "refreshnocache"
    assert ("PressInputPropertiesButton", {"inputName": "Odessa Chat OCR", "propertyName": "refreshnocache"}) in calls


@pytest.mark.asyncio
async def test_get_source_screenshot_reports_frame_metadata():
    service = OBSService()

    async def fake_call(request_type, request_data=None):
        if request_type == "GetSourceActive":
            return {"sourceActive": True, "sourceShowing": True}
        if request_type == "GetSourceScreenshot":
            return {"imageData": _data_url((20, 40, 80, 255))}
        raise AssertionError(request_type)

    service._call = fake_call

    result = await service.get_source_screenshot("Odessa Chat OCR")

    assert result["ok"] is True
    assert result["sourceActive"] is True
    assert result["sourceShowing"] is True
    assert result["frameHash"]
    assert result["capturedAt"]


@pytest.mark.asyncio
async def test_setup_live_scene_creates_managed_scenes_sources_and_transforms():
    service = OBSService()
    service.whitelist = []
    service.chat_source_name = "Odessa Chat OCR"
    service.ocr_source_name = "Odessa Chat OCR"
    service.stage_source_name = "Odessa Stage Overlay"
    service.startup_scene_name = "Odessa START"
    service.live_scene_name = "Odessa LIVE"
    service.stage_url = "http://localhost:3000/#overlay"
    service.canvas_width = 1080
    service.canvas_height = 1920
    service._save_settings = lambda: None

    scenes = ["Cena"]
    inputs = {}
    items = {"Cena": []}
    calls = []
    next_item_id = 1

    async def fake_call(request_type, request_data=None):
      nonlocal next_item_id
      request_data = request_data or {}
      calls.append((request_type, request_data))
      if request_type == "GetVideoSettings":
          return {"baseWidth": 1920, "baseHeight": 1080, "outputWidth": 1920, "outputHeight": 1080}
      if request_type == "GetSceneList":
          return {"scenes": [{"sceneName": scene} for scene in scenes], "currentProgramSceneName": "Cena"}
      if request_type == "CreateScene":
          scenes.append(request_data["sceneName"])
          items.setdefault(request_data["sceneName"], [])
          return {}
      if request_type == "GetInputList":
          return {"inputs": [{"inputName": name, "inputKind": kind} for name, kind in inputs.items()]}
      if request_type == "GetSceneItemList":
          return {"sceneItems": items.setdefault(request_data["sceneName"], [])}
      if request_type == "CreateInput":
          inputs[request_data["inputName"]] = request_data["inputKind"]
          item = {
              "sceneItemId": next_item_id,
              "sourceName": request_data["inputName"],
              "sceneItemEnabled": request_data.get("sceneItemEnabled", True),
              "inputKind": request_data["inputKind"],
          }
          next_item_id += 1
          items.setdefault(request_data["sceneName"], []).append(item)
          return {}
      if request_type == "CreateSceneItem":
          item = {
              "sceneItemId": next_item_id,
              "sourceName": request_data["sourceName"],
              "sceneItemEnabled": request_data.get("sceneItemEnabled", True),
          }
          next_item_id += 1
          items.setdefault(request_data["sceneName"], []).append(item)
          return {"sceneItemId": item["sceneItemId"]}
      if request_type == "GetInputSettings":
          return {"inputKind": inputs.get(request_data["inputName"], "browser_source"), "inputSettings": {}}
      if request_type in {"SetInputSettings", "SetSceneItemTransform", "SetSceneItemEnabled", "PressInputPropertiesButton"}:
          return {}
      raise AssertionError(f"Unexpected OBS call: {request_type}")

    service._call = fake_call

    result = await service.setup_live_scene()

    assert result["ok"] is True
    assert "Odessa START" in scenes
    assert "Odessa LIVE" in scenes
    assert "Odessa START" in service.whitelist
    assert "Odessa LIVE" in service.whitelist
    assert inputs["Odessa Stage Overlay"] == "browser_source"
    assert inputs["Odessa Chat OCR"] == "browser_source"
    assert any(
        call[0] == "SetSceneItemTransform"
        and call[1]["sceneName"] == "Odessa LIVE"
        and call[1]["sceneItemTransform"]["positionY"] == 0
        for call in calls
    )
    assert any(
        call[0] == "SetSceneItemTransform"
        and call[1]["sceneName"] == "Odessa LIVE"
        and call[1]["sceneItemTransform"]["positionX"] == -4000.0
        for call in calls
    )


@pytest.mark.asyncio
async def test_live_health_reports_missing_chat_and_stage_sources():
    service = OBSService()
    service.chat_source_name = "Chat"
    service.stage_source_name = "Stage"
    service.startup_scene_name = "Odessa START"
    service.live_scene_name = "Odessa LIVE"
    service.connected = True

    async def fake_connect():
        service.connected = True

    async def fake_inventory():
        return {
            "scenes": ["Odessa START", "Odessa LIVE"],
            "currentScene": "Odessa LIVE",
            "inputs": [],
            "sceneItems": [],
            "sources": [],
            "allowedScenes": [],
        }

    async def fake_source_exists(source_name):
        return {"exists": False, "inputExists": False, "sceneItems": []}

    async def fake_transmission_status():
        return {"ok": True, "streamActive": False, "virtualCameraActive": False}

    service.connect = fake_connect
    service.get_source_inventory = fake_inventory
    service.source_exists = fake_source_exists
    service.get_transmission_status = fake_transmission_status

    result = await service.live_health()

    assert result["ok"] is False
    assert result["connected"] is True
    assert result["startupSceneReady"] is True
    assert result["liveSceneReady"] is True
    assert result["chatSourceReady"] is False
    assert result["stageSourceReady"] is False
    assert "chat_source" in result["error"]


@pytest.mark.asyncio
async def test_transmission_start_uses_configured_modes():
    service = OBSService()
    calls = []

    async def fake_call(request_type, request_data=None):
        calls.append((request_type, request_data or {}))
        if request_type == "GetStreamStatus":
            return {"outputActive": False}
        if request_type == "GetVirtualCamStatus":
            return {"outputActive": False}
        if request_type in {"StartStream", "StartVirtualCam"}:
            return {}
        raise AssertionError(request_type)

    service._call = fake_call

    stream = await service.start_transmission("stream")
    virtual_camera = await service.start_transmission("virtual_camera")

    assert stream["status"] == "started"
    assert virtual_camera["status"] == "started"
    assert ("StartStream", {}) in calls
    assert ("StartVirtualCam", {}) in calls
