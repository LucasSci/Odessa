import pytest
from unittest.mock import patch
from server.main import app

@pytest.mark.unit
@patch("server.main.N8N_WEBHOOK_SECRET", "test-secret")
def test_n8n_events_unauthorized(client):
    """Test /n8n/events without secret."""
    response = client.post("/n8n/events", json={"event": {"text": "hello"}})
    # If N8N_WEBHOOK_SECRET is set, it should return 401
    assert response.status_code == 401

@pytest.mark.unit
@patch("server.main.N8N_WEBHOOK_SECRET", "test-secret")
def test_n8n_events_success(client):
    """Test /n8n/events with correct secret."""
    response = client.post(
        "/n8n/events",
        json={
            "event": {
                "id": "n8n-1",
                "text": "hello",
                "source": "n8n",
                "time": "12:00:00",
                "createdAt": "2026-05-03T12:00:00Z"
            }
        },
        headers={"X-Odessa-Secret": "test-secret"}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["accepted"] == 1

@pytest.mark.unit
def test_n8n_consume_events(client):
    """Test GET /n8n/events."""
    response = client.get("/n8n/events")
    assert response.status_code == 200
    data = response.json()
    assert "events" in data
    assert "remaining" in data

@pytest.mark.unit
def test_n8n_audit_recent(client):
    """Test /n8n/audit/recent."""
    response = client.get("/n8n/audit/recent")
    assert response.status_code == 200
    data = response.json()
    assert "items" in data
