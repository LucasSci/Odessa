"""Vários players (overlay do OBS, fonte duplicada, Palco do painel) avisam o fim
do mesmo clip: só o primeiro aviso pode avançar o fluxo."""
from fastapi.testclient import TestClient

from server.main import app
from server.services.video_service import VideoService, video_service

IDLE = "idle_v"


def _flow_config() -> dict:
    nodes = [
        {"nodeId": "n-idle", "videoId": IDLE},
        {"nodeId": "n-a", "videoId": "a_v"},
        {"nodeId": "n-b", "videoId": "b_v"},
    ]
    triggers = [{"id": "t-nat", "eventType": "natural"}]
    connections = [
        {"id": "c1", "fromNodeId": "n-idle", "toNodeId": "n-a", "triggerId": "t-nat", "returnToIdle": True},
        {"id": "c2", "fromNodeId": "n-a", "toNodeId": "n-b", "triggerId": "t-nat", "returnToIdle": True},
    ]
    return {
        "idleVideoId": IDLE,
        "videos": [{"id": IDLE}, {"id": "a_v"}, {"id": "b_v"}, {"id": "fora_v"}],
        "flowNodes": nodes,
        "flowConnections": connections,
        "triggers": triggers,
    }


def _service() -> VideoService:
    service = VideoService()
    service._config = _flow_config()
    service.return_to_idle()
    return service


def test_avisos_atrasados_do_mesmo_clip_nao_pulam_o_proximo():
    service = _service()
    ended = {"from_node_id": "n-idle", "from_video_id": IDLE}

    first = service.advance(**ended)
    second = service.advance(**ended)  # outro player, atrasado
    third = service.advance(**ended)  # Palco do painel

    assert first["current_video_id"] == "a_v"
    assert second["current_video_id"] == "a_v" and second["advanced"] is False
    assert third["current_video_id"] == "a_v"


def test_fim_do_clip_atual_avanca_normalmente():
    service = _service()
    service.advance(from_node_id="n-idle", from_video_id=IDLE)
    state = service.advance(from_node_id="n-a", from_video_id="a_v")
    assert state["current_video_id"] == "b_v"


def test_sem_clip_informado_avanca_sempre():
    """Botão "Próximo" e clientes antigos continuam funcionando."""
    service = _service()
    assert service.advance()["current_video_id"] == "a_v"
    assert service.advance()["current_video_id"] == "b_v"


def test_so_video_id_tambem_e_idempotente():
    service = _service()
    service.advance(from_video_id=IDLE)
    assert service.advance(from_video_id=IDLE)["current_video_id"] == "a_v"


def test_in_flow_reflete_a_config_do_motor():
    service = _service()
    assert service.get_state()["inFlow"] is True  # idle
    service.force_video("a_v")
    assert service.get_state()["inFlow"] is True  # nó do fluxo
    service.force_video("fora_v")
    assert service.get_state()["inFlow"] is False  # vídeo que não está no fluxo


def test_endpoint_advance_le_o_corpo_e_aceita_sem_corpo():
    client = TestClient(app)
    original = (video_service._config, video_service.current_clip, video_service.current_video_id, video_service.state)
    try:
        video_service._config = _flow_config()
        video_service.return_to_idle()
        body = {"fromNodeId": "n-idle", "fromVideoId": IDLE}
        assert client.post("/api/v1/video/advance", json=body).json()["current_video_id"] == "a_v"
        assert client.post("/api/v1/video/advance", json=body).json()["current_video_id"] == "a_v"
        assert client.post("/api/v1/video/advance").json()["current_video_id"] == "b_v"
    finally:
        video_service._config, video_service.current_clip, video_service.current_video_id, video_service.state = original
