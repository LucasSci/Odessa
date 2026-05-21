from fastapi.testclient import TestClient
from server.main import app
from server.services.video_service import video_service

client = TestClient(app)


def setup_module(module):
    # Ensure service loads latest config from disk
    video_service.refresh_config()


def test_exact_gift_match():
    resp = client.get("/api/v1/video/next", params={"trigger": "gift", "giftName": "Rosa"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == "04"


def test_regex_gift_match():
    resp = client.get("/api/v1/video/next", params={"trigger": "gift", "giftName": "rosinha"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == "02"


def test_wildcard_default():
    resp = client.get("/api/v1/video/next", params={"trigger": "gift", "giftName": "something_unknown"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == "05"
