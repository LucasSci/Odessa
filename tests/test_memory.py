import pytest
from server.main import app

@pytest.mark.unit
def test_memory_stats(client):
    """Test /memory/stats endpoint."""
    response = client.get("/memory/stats")
    assert response.status_code == 200
    data = response.json()
    assert "usersRecognized" in data
    assert "interactions" in data
    assert "gifts" in data

@pytest.mark.unit
def test_memory_round_context_missing_events(client):
    """Test /memory/round-context with missing events."""
    response = client.post("/memory/round-context", json={})
    # FastAPI validation error
    assert response.status_code == 422

@pytest.mark.unit
def test_memory_round_context_success(client):
    """Test /memory/round-context success."""
    response = client.post(
        "/memory/round-context",
        json={
            "events": [
                {
                    "id": "mem-1",
                    "source": "ocr",
                    "text": "Teste de memoria",
                    "kind": "chat",
                    "createdAt": "2026-05-03T12:00:00Z",
                    "time": "12:00:00"
                }
            ]
        }
    )
    assert response.status_code == 200
    data = response.json()
    assert "context" in data
    assert "usersRecognized" in data
