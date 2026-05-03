"""Tests for /ai/* endpoints."""
import pytest
from unittest.mock import MagicMock, patch


@pytest.mark.unit
@patch("server.main.gemini_client")
def test_ai_respond_success(mock_gemini, client):
    """Test /ai/respond success with Gemini."""
    # Setup mock
    mock_response = MagicMock()
    mock_response.text = "Mocked AI Response"
    mock_gemini.models.generate_content.return_value = mock_response

    response = client.post(
        "/ai/respond",
        json={
            "chat_context": "User: Hello\nJuju:",
            "persona_prompt": "You are Juju.",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["response"] == "Mocked AI Response"
    assert data["provider"] == "gemini"


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
@patch("server.main.gemini_client")
def test_ai_decide_success(mock_gemini, client):
    """Test /ai/decide success with Gemini."""
    # Setup mock
    mock_response = MagicMock()
    mock_response.text = '{"speech": "Hello there!", "intent": "respond_chat", "confidence": 0.9, "actions": [{"type": "speak", "payload": {"text": "Hello there!"}}]}'
    mock_gemini.models.generate_content.return_value = mock_response

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
    assert response.status_code == 200
    data = response.json()
    assert data["speech"] == "Hello there!"
    assert data["intent"] == "respond_chat"
    assert len(data["actions"]) > 0
    assert data["actions"][0]["type"] == "speak"


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
@patch("server.main.gemini_client", None)
@patch("server.main.openai_client")
def test_ai_fallback_to_openai(mock_openai, client):
    """Test fallback to OpenAI when Gemini is unavailable."""
    # Setup OpenAI mock
    mock_completion = MagicMock()
    mock_completion.choices[0].message.content = "OpenAI Response"
    mock_openai.chat.completions.create.return_value = mock_completion

    response = client.post(
        "/ai/respond",
        json={
            "chat_context": "Test context",
            "persona_prompt": "Test persona",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["response"] == "OpenAI Response"
    assert data["provider"] == "openai"
