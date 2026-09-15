"""Tests for Tango Chat Bridge management endpoints."""
from pathlib import Path

import pytest

from server.services import bridge_manager


def test_bridge_status(client):
    """Test getting bridge process and connection status."""
    response = client.get("/api/v1/chat-automation/bridge/status")
    assert response.status_code == 200
    data = response.json()
    assert "processRunning" in data
    assert "pid" in data
    assert "bridgeUrl" in data
    assert "bridgeReachable" in data


def test_bridge_config_lifecycle(client, tmp_path, monkeypatch):
    """Test getting and updating bridge configuration.

    POST /bridge/config grava direto em server/runtime/bridge_config.json —
    o MESMO arquivo que o app real usa pra saber em qual sala do Tango e com
    quais seletores conectar. Sem isolar esse caminho, rodar a suíte
    sobrescreve a configuração real do usuário com os valores de teste
    abaixo (roomUrl=test_room, seletores fake), quebrando a leitura/envio de
    chat até alguém reconfigurar manualmente pela UI de novo.
    """
    monkeypatch.setattr(bridge_manager, "BRIDGE_CONFIG_FILE", tmp_path / "bridge_config.json")

    # Get initial config
    get_res = client.get("/api/v1/chat-automation/bridge/config")
    assert get_res.status_code == 200
    initial_config = get_res.json()
    assert "mode" in initial_config
    assert "cdpUrl" in initial_config
    assert "roomUrl" in initial_config
    assert "port" in initial_config
    assert "selectors" in initial_config

    # Update config
    update_payload = {
        "mode": "standalone",
        "cdpUrl": "http://127.0.0.1:9222",
        "roomUrl": "https://tango.me/stream/test_room",
        "port": 7555,
        "autoconnect": False,
        "selectors": {
            "containerChat": '[data-testid="test-chat"]',
            "mensagem": '[data-testid^="msg-"]',
            "username": ".user",
            "textoMsg": ".text",
            "inputTexto": "textarea",
            "botaoEnviar": "button.send"
        }
    }
    post_res = client.post("/api/v1/chat-automation/bridge/config", json=update_payload)
    assert post_res.status_code == 200
    updated = post_res.json()
    assert updated["mode"] == "standalone"
    assert updated["roomUrl"] == "https://tango.me/stream/test_room"
    assert updated["autoconnect"] is False
    assert updated["selectors"]["containerChat"] == '[data-testid="test-chat"]'

    # Verify persistence
    verify_res = client.get("/api/v1/chat-automation/bridge/config")
    assert verify_res.status_code == 200
    assert verify_res.json()["roomUrl"] == "https://tango.me/stream/test_room"


def test_bridge_logs(client):
    """Test reading bridge logs endpoint."""
    response = client.get("/api/v1/chat-automation/bridge/logs?limit=50")
    assert response.status_code == 200
    data = response.json()
    assert "lines" in data
    assert "total" in data
    assert isinstance(data["lines"], list)


def test_chrome_helpers_endpoints(client, tmp_path, monkeypatch):
    """Test chrome tabs inspection and shortcut creation.

    create_desktop_shortcut() resolve Path.home()/"Desktop" internamente —
    sem isolar isso o teste cria de verdade um atalho .lnk na Área de
    Trabalho real de quem rodar a suíte.
    """
    (tmp_path / "Desktop").mkdir()
    monkeypatch.setattr(Path, "home", lambda: tmp_path)

    tabs_res = client.get("/api/v1/chat-automation/bridge/chrome-tabs?port=9222")
    assert tabs_res.status_code == 200
    data = tabs_res.json()
    assert "runningWithDebug" in data
    assert "tabs" in data

    shortcut_res = client.post("/api/v1/chat-automation/bridge/create-shortcut", json={
        "url": "https://tango.me/stream/broadcast",
        "port": 9222
    })
    assert shortcut_res.status_code == 200
    shortcut_data = shortcut_res.json()
    assert "ok" in shortcut_data

