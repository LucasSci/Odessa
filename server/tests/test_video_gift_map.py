from fastapi.testclient import TestClient
from server.main import app
from server.services.video_service import video_service

# Use um host válido para o RequestGuard (ex: 127.0.0.1 ou localhost) em TestClient,
# caso contrário ele recebe 'testserver' e devolve 400 Bad Request.
client = TestClient(app, base_url="http://127.0.0.1")


def setup_module(module):
    # Ensure service loads latest config from disk
    video_service.refresh_config()


def test_exact_gift_match(monkeypatch):
    monkeypatch.setattr("server.core.auth.AUTH_DISABLED", True)
    resp = client.get("/api/v1/video/next", params={"trigger": "gift", "giftName": "Rosa"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == "04"


def test_regex_gift_match(monkeypatch):
    monkeypatch.setattr("server.core.auth.AUTH_DISABLED", True)
    resp = client.get("/api/v1/video/next", params={"trigger": "gift", "giftName": "rosinha"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == "02"


def test_wildcard_default(monkeypatch):
    monkeypatch.setattr("server.core.auth.AUTH_DISABLED", True)
    resp = client.get("/api/v1/video/next", params={"trigger": "gift", "giftName": "something_unknown"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == "05"
