import pytest
from starlette.websockets import WebSocketDisconnect


def test_websocket_da_bridge_recusa_origem_de_site_malicioso(client):
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/tango-bridge/live", headers={"origin": "https://evil.example"}):
            pass


def test_websocket_da_bridge_recusa_host_estranho(client):
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/tango-bridge/live", headers={"host": "evil.example"}):
            pass


def test_http_da_bridge_sem_bridge_ativa_devolve_502_e_nao_vaza_nada(client):
    response = client.get("/tango-bridge/status")
    assert response.status_code == 502
    assert response.json() == {"error": "bridge_unreachable"}
