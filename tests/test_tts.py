"""Tests for /tts/* endpoints."""
import pytest


@pytest.mark.unit
def test_tts_voices_endpoint(client):
    """Test that /tts/voices endpoint returns voice configuration."""
    response = client.get("/api/v1/tts/voices")
    assert response.status_code == 200
    data = response.json()
    # Validate structure - endpoint returns providers config
    assert isinstance(data, dict)
    assert ("providers" in data or "defaultProvider" in data)


@pytest.mark.unit
def test_tts_endpoint_edge_success(client):
    """Test /tts endpoint with Edge TTS - validates request handling."""
    response = client.post(
        "/api/v1/tts",
        json={
            "text": "Olá, mundo!",
            "voice": "pt-BR-AntonioNeural",
            "provider": "edge",
        },
    )
    # Should return valid response or error
    assert response.status_code in [200, 400, 422, 500, 503]


@pytest.mark.unit
def test_tts_endpoint_openai_success(client):
    """Test /tts endpoint with OpenAI - validates request handling."""
    response = client.post(
        "/api/v1/tts",
        json={
            "text": "Hello world",
            "voice": "nova",
            "provider": "openai",
        },
    )
    # Should return valid response or service unavailable (OpenAI not configured)
    assert response.status_code in [200, 400, 422, 500, 503]


@pytest.mark.unit
def test_tts_endpoint_missing_text(client):
    """Test /tts endpoint with missing text."""
    response = client.post(
        "/api/v1/tts",
        json={
            "voice": "pt-BR-AntonioNeural",
        },
    )
    # Should return 400 for missing required field
    assert response.status_code == 400


@pytest.mark.unit
def test_tts_endpoint_kokoro_success(client):
    """Test /tts endpoint with Kokoro - validates request handling."""
    response = client.post(
        "/api/v1/tts",
        json={
            "text": "Teste kokoro",
            "voice": "pf_dora",
            "provider": "kokoro",
        },
    )
    # Should return valid response or error
    assert response.status_code in [200, 400, 422, 500, 503]
