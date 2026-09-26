"""Modo extensão: a aba do Tango já logada no Edge/Chrome do usuário alimenta a bridge.

Cobre o protocolo WebSocket da bridge (/extension), o proxy do backend
(/tango-bridge/extension: Origin de extensão + token de pareamento) e a pasta
"sem pacote" gerada pelo botão Preparar extensão.
"""
import asyncio
import importlib.util
import json
import sys
from pathlib import Path

import pytest
from starlette.websockets import WebSocketDisconnect

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="module")
def tango():
    sys.path.insert(0, str(ROOT / "tango_chat"))
    try:
        spec = importlib.util.spec_from_file_location("tango_chat_ext_under_test", ROOT / "tango_chat" / "tango_chat.py")
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module  # dataclasses resolve anotações pelo módulo
        spec.loader.exec_module(module)
    finally:
        sys.path.remove(str(ROOT / "tango_chat"))
    return module


async def _with_bridge(tango, scenario):
    from aiohttp.test_utils import TestClient, TestServer

    tango.bridge = tango.TangoChatBridge()
    await tango.bridge.connect(force_mode="extension")
    client = TestClient(TestServer(tango.create_app()))
    await client.start_server()
    try:
        await scenario(client, tango.bridge)
    finally:
        await client.close()


async def _hello(client, url="https://tango.me/stream/abc", version="1.1.0"):
    ws = await client.ws_connect("/extension")
    hello = {"type": "hello", "url": url, "browser": "Microsoft Edge"}
    if version:
        hello["version"] = version
    await ws.send_json(hello)
    config = await asyncio.wait_for(ws.receive_json(), 5)
    return ws, config


def test_extensao_conecta_recebe_seletores_e_alimenta_o_chat(tango):
    async def scenario(client, bridge):
        assert bridge.get_status()["status"] == "waiting_extension"
        ws, config = await _hello(client)
        assert config["type"] == "config"
        assert config["observer"]["messageSelector"] == tango.SELETOR_MENSAGEM

        status = bridge.get_status()
        assert status["status"] == "connected"
        assert status["mode"] == "extension"
        assert status["browserName"] == "Microsoft Edge"
        assert status["extensionConnected"] is True

        await ws.send_json({"type": "message", "username": "viewer1", "text": "oi Odessa"})
        msg = await asyncio.wait_for(bridge.incoming.get(), 5)
        assert (msg.username, msg.text) == ("viewer1", "oi Odessa")

        await ws.close()
        for _ in range(50):
            if bridge.get_status()["status"] == "waiting_extension":
                break
            await asyncio.sleep(0.05)
        assert bridge.get_status()["status"] == "waiting_extension"
        assert bridge.get_status()["extensionConnected"] is False

    asyncio.run(_with_bridge(tango, scenario))


def test_envio_pela_extensao_e_confirmado_pelo_eco_do_chat(tango):
    async def scenario(client, bridge):
        ws, _ = await _hello(client)

        async def fake_tab():
            frame = await asyncio.wait_for(ws.receive_json(), 5)
            assert frame["type"] == "send"
            assert frame["text"] == "Olá, chat!"
            assert frame["inputSelector"] == tango.SELETOR_INPUT_TEXTO
            await ws.send_json({"type": "send_result", "id": frame["id"], "ok": True})
            await ws.send_json({"type": "message", "username": "Odessa", "text": "Olá, chat!"})

        tab = asyncio.create_task(fake_tab())
        result = await bridge.send_message("Olá, chat!")
        await tab
        assert result["confirmed"] is True
        echoed = await asyncio.wait_for(bridge.incoming.get(), 5)
        assert echoed.own is True
        await ws.close()

    asyncio.run(_with_bridge(tango, scenario))


def test_falha_de_envio_na_aba_vira_senderror_com_etapa(tango):
    async def scenario(client, bridge):
        ws, _ = await _hello(client)

        async def fake_tab():
            frame = await asyncio.wait_for(ws.receive_json(), 5)
            await ws.send_json({"type": "send_result", "id": frame["id"], "ok": False, "stage": "not_submitted", "error": "ficou no campo"})

        tab = asyncio.create_task(fake_tab())
        with pytest.raises(tango.SendError) as info:
            await bridge.send_message("não vai")
        await tab
        assert info.value.stage == "not_submitted"
        await ws.close()

    asyncio.run(_with_bridge(tango, scenario))


def test_aba_nova_assume_e_a_antiga_recebe_4000(tango):
    async def scenario(client, bridge):
        first, _ = await _hello(client, "https://tango.me/stream/velha")
        second, _ = await _hello(client, "https://tango.me/stream/nova")
        closed = await asyncio.wait_for(first.receive(), 5)
        assert closed.type.name in {"CLOSE", "CLOSED"}
        assert closed.data == 4000, (closed, first.close_code)
        assert bridge.get_status()["pageUrl"] == "https://tango.me/stream/nova"
        assert bridge.get_status()["status"] == "connected"
        await second.close()

    asyncio.run(_with_bridge(tango, scenario))


# ── Proxy do backend ──────────────────────────────────────────────────


def test_proxy_recusa_origem_que_nao_e_extensao(client):
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/tango-bridge/extension", headers={"origin": "https://tango.me"}):
            pass


def test_proxy_recusa_token_de_pareamento_errado(client):
    with client.websocket_connect("/tango-bridge/extension", headers={"origin": "chrome-extension://abc"}) as ws:
        ws.send_text(json.dumps({"type": "hello", "pairToken": "errado"}))
        with pytest.raises(WebSocketDisconnect) as info:
            ws.receive_text()
    assert info.value.code == 4001


def test_proxy_respeita_bridge_parada_pelo_usuario(client, monkeypatch):
    from server.services import browser_extension
    from server.services.bridge_manager import bridge_manager

    monkeypatch.setattr(bridge_manager, "user_stopped", True)
    token = browser_extension.get_pairing_token()
    with client.websocket_connect("/tango-bridge/extension", headers={"origin": "chrome-extension://abc"}) as ws:
        ws.send_text(json.dumps({"type": "hello", "pairToken": token}))
        with pytest.raises(WebSocketDisconnect) as info:
            ws.receive_text()
    assert info.value.code == 4002


def test_preparar_extensao_gera_pasta_carregavel(client, tmp_path, monkeypatch):
    monkeypatch.setenv("ODESSA_EXTENSION_DIR", str(tmp_path / "ext"))
    response = client.post("/api/v1/chat-automation/bridge/extension/prepare", json={"reveal": False})
    assert response.status_code == 200
    data = response.json()
    folder = Path(data["path"])
    for name in ("manifest.json", "background.js", "content.js", "chat_observer.js", "popup.html", "popup.js", "config.js"):
        assert (folder / name).exists(), name
    manifest = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["manifest_version"] == 3
    assert "chat_observer.js" in manifest["content_scripts"][0]["js"]

    from server.services import browser_extension

    config_js = (folder / "config.js").read_text(encoding="utf-8")
    assert browser_extension.get_pairing_token() in config_js
    assert "/tango-bridge/extension" in config_js
    assert client.get("/api/v1/chat-automation/bridge/extension").json()["prepared"] is True


def test_video_da_aba_pela_extensao_chega_ao_live(tango):
    import base64
    import struct

    async def scenario(client, bridge):
        ext, _ = await _hello(client)
        await ext.send_json({"type": "page", "url": "https://tango.me/stream/abc", "title": "Live", "w": 1200, "h": 700})

        viewer = await client.ws_connect("/live")
        # 1º espectador liga a captura na extensão
        assert (await asyncio.wait_for(ext.receive_json(), 5)) == {"type": "screencast", "on": True}
        viewport = await asyncio.wait_for(viewer.receive_json(), 5)
        assert viewport["type"] == "viewport" and viewport["w"] == 1200

        jpeg = b"\xff\xd8fake-jpeg\xff\xd9"
        await ext.send_json({"type": "frame", "data": "data:image/jpeg;base64," + base64.b64encode(jpeg).decode(), "w": 1200, "h": 700})
        frame = await asyncio.wait_for(viewer.receive_bytes(), 5)
        assert struct.unpack(">HH", frame[:4]) == (1200, 700)
        assert frame[4:] == jpeg

        await ext.send_json({"type": "capture_error", "error": "aba escondida"})
        assert (await asyncio.wait_for(viewer.receive_json(), 5))["error"] == "aba escondida"

        # último espectador saiu: a extensão para de capturar
        await viewer.close()
        assert (await asyncio.wait_for(ext.receive_json(), 5)) == {"type": "screencast", "on": False}
        await ext.close()

    asyncio.run(_with_bridge(tango, scenario))


def test_extensao_antiga_sem_video_avisa_o_painel(tango):
    async def scenario(client, bridge):
        ext, _ = await _hello(client, version=None)  # 1.0.0 não mandava versão
        assert bridge.get_status()["extensionVersion"] == "1.0.0"
        viewer = await client.ws_connect("/live")
        notice = await asyncio.wait_for(viewer.receive_json(), 5)
        assert notice["type"] == "error"
        assert "desatualizada" in notice["error"] and "Recarregar" in notice["error"]
        await viewer.close()
        await ext.close()

    asyncio.run(_with_bridge(tango, scenario))


def test_barra_de_endereco_do_painel_navega_a_aba_da_extensao(tango):
    async def scenario(client, bridge):
        ext, _ = await _hello(client)
        ok = await client.post("/goto", json={"url": "https://www.tango.me/stream/xyz"})
        assert ok.status == 200
        assert (await asyncio.wait_for(ext.receive_json(), 5)) == {"type": "navigate", "url": "https://www.tango.me/stream/xyz"}
        blocked = await client.post("/goto", json={"url": "https://evil.example/"})
        assert blocked.status == 400
        await ext.close()

    asyncio.run(_with_bridge(tango, scenario))
