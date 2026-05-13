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
    assert data["id"] in ["04", "02", "05", "grok-36d81c34-d3c6-4602-8a14-0b966b7c8176-720p"]


def test_regex_gift_match():
    resp = client.get("/api/v1/video/next", params={"trigger": "gift", "giftName": "rosinha"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] in ["04", "02", "05", "grok-36d81c34-d3c6-4602-8a14-0b966b7c8176-720p"]


def test_wildcard_default():
    resp = client.get("/api/v1/video/next", params={"trigger": "gift", "giftName": "something_unknown"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] in ["04", "02", "05", "grok-36d81c34-d3c6-4602-8a14-0b966b7c8176-720p"]
