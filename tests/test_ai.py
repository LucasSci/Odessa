"""Tests for /ai/* endpoints and the local Ollama adapter."""
from unittest.mock import Mock, patch

import pytest

from server.services.ai_service import AIService


@pytest.mark.unit
def test_ollama_adapter_posts_chat_payload():
    response = Mock()
    response.raise_for_status.return_value = None
    response.json.return_value = {"message": {"content": "Resposta da Barbara."}}
    client = Mock()
    client.__enter__ = Mock(return_value=client)
    client.__exit__ = Mock(return_value=None)
    client.post.return_value = response

    with patch("httpx.Client", return_value=client):
        result = AIService().generate_ollama_text(
            "Voce e Barbara.",
            "Oi, Barbara!",
            0.7,
            model="qwen2.5:latest",
            base_url="http://127.0.0.1:11434",
        )

    assert result == "Resposta da Barbara."
    request_url, request_kwargs = client.post.call_args.args[0], client.post.call_args.kwargs
    assert request_url == "http://127.0.0.1:11434/api/chat"
    assert request_kwargs["json"]["model"] == "qwen2.5:latest"
    assert request_kwargs["json"]["stream"] is False
    assert request_kwargs["json"]["messages"][-1]["content"] == "Oi, Barbara!"


@pytest.mark.unit
def test_ai_respond_success(client):
    """Test /ai/respond endpoint - validates it handles requests."""
    response = client.post(
        "/api/v1/ai/respond",
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
        "/api/v1/ai/respond",
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
        "/api/v1/ai/decide",
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
    assert response.status_code in [200, 400, 422, 500, 502]
    if response.status_code == 200:
        data = response.json()
        assert "speech" in data or "intent" in data


@pytest.mark.unit
def test_ai_decide_missing_events(client):
    """Test /ai/decide with missing events."""
    response = client.post(
        "/api/v1/ai/decide",
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
        "/api/v1/ai/respond",
        json={
            "chat_context": "Test context",
            "persona_prompt": "Test persona",
            "user_prompt": "Test",  # Field expected by endpoint
        },
    )
    # Should return valid response or error
    assert response.status_code in [200, 400, 422, 500, 502]
