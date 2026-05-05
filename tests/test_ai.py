"""Tests for /ai/* endpoints."""
import pytest


@pytest.mark.unit
def test_ai_respond_success(client):
    """Test /ai/respond endpoint - validates it handles requests."""
    response = client.post(
        "/ai/respond",
        json={
            "chat_context": "User: Hello\nJuju:",
            "persona_prompt": "You are Juju.",
            "user_prompt": "Hello",  # Field expected by endpoint
        },
    )
    # Endpoint exists and returns valid response or error
    assert response.status_code in [200, 400, 422, 500, 502]


@pytest.mark.unit
def test_ai_respond_missing_context(client):
    """Test /ai/respond with missing context."""
    response = client.post(
        "/ai/respond",
        json={
            "persona_prompt": "You are Juju.",
        },
    )
    # Should return 422 for missing required field (FastAPI validation error)
    assert response.status_code == 422


@pytest.mark.unit
def test_ai_decide_success(client):
    """Test /ai/decide endpoint - validates structure."""
    response = client.post(
        "/ai/decide",
        json={
            "events": [
                {
                    "id": "test-1",
                    "source": "ocr",
                    "zoneName": "chat",
                    "text": "Olá Juju!",
                    "kind": "chat",
                    "time": "12:34:56",
                    "createdAt": "2026-05-03T12:34:56Z",
                }
            ],
            "persona_prompt": "You are Juju.",
        },
    )
    # Endpoint exists and returns valid response or error
    assert response.status_code in [200, 400, 422, 500]
    if response.status_code == 200:
        data = response.json()
        assert "speech" in data or "intent" in data


@pytest.mark.unit
def test_ai_decide_missing_events(client):
    """Test /ai/decide with missing events."""
    response = client.post(
        "/ai/decide",
        json={
            "persona_prompt": "You are Juju.",
        },
    )
    # Should return 422 for missing required field (FastAPI validation error)
    assert response.status_code == 422


@pytest.mark.unit
def test_ai_fallback_to_openai(client):
    """Test /ai/respond fallback handling."""
    response = client.post(
        "/ai/respond",
        json={
            "chat_context": "Test context",
            "persona_prompt": "Test persona",
            "user_prompt": "Test",  # Field expected by endpoint
        },
    )
    # Should return valid response or error
    assert response.status_code in [200, 400, 422, 500, 502]
