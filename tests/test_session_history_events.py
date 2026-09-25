import pytest
from fastapi.testclient import TestClient

from server.api.v1.endpoints import session_history as endpoint
from server.main import app
from server.services.session_history import SessionHistoryService


@pytest.fixture()
def client(tmp_path, monkeypatch):
    service = SessionHistoryService(base_dir=tmp_path)
    monkeypatch.setattr(endpoint, "get_session_history_service", lambda: service)
    with TestClient(app) as test_client:
        yield test_client


@pytest.mark.parametrize(
    "event_type",
    [
        "ai.reply.skipped",
        "persona.selfconfig.proposed",
        "persona.selfconfig.applied",
        "persona.selfconfig.rejected",
        "persona.selfconfig.photoRequested",
    ],
)
def test_eventos_do_frontend_sao_aceitos(client, event_type):
    response = client.post("/api/v1/session-history/events", json={"type": event_type, "data": {"reason": "x"}})
    assert response.status_code == 200, response.text


def test_motivo_do_governador_fica_no_historico(client):
    client.post(
        "/api/v1/session-history/events",
        json={"type": "ai.reply.skipped", "data": {"username": "ana", "text": "pix?", "reason": "moderation_risk"}},
    )
    events = client.get("/api/v1/session-history").json()["events"]
    skipped = [e for e in events if e["type"] == "ai.reply.skipped"]
    assert skipped and skipped[-1]["data"]["reason"] == "moderation_risk"


def test_tipo_desconhecido_continua_rejeitado(client):
    assert client.post("/api/v1/session-history/events", json={"type": "qualquer", "data": {}}).status_code == 400
