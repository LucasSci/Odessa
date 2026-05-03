"""Tests for /tts/* endpoints."""
import pytest
from unittest.mock import MagicMock, patch


@pytest.mark.unit
def test_tts_voices_endpoint(client):
    """Test that /tts/voices endpoint returns voice list."""
    response = client.get("/tts/voices")
    assert response.status_code == 200
    data = response.json()
    assert "voices" in data
    assert "providers" in data
    assert len(data["voices"]) > 0


@pytest.mark.unit
@patch("edge_tts.Communicate")
def test_tts_endpoint_edge_success(mock_communicate, client):
    """Test /tts success with Edge TTS (default)."""
    # Setup mock
    mock_comm_instance = MagicMock()
    mock_communicate.return_value = mock_comm_instance
    
    # We need to mock the async save method
    async def mock_save(path):
        with open(path, "wb") as f:
            f.write(b"fake audio data")
    
    mock_comm_instance.save = mock_save

    response = client.post(
        "/tts",
        json={
            "text": "Olá, mundo!",
            "voice": "pt-BR-AntonioNeural",
            "provider": "edge",
        },
    )
    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/mpeg"
    assert response.headers["X-Odessa-TTS-Provider"] == "edge"


@pytest.mark.unit
@patch("server.main.openai_client")
def test_tts_endpoint_openai_success(mock_openai, client):
    """Test /tts success with OpenAI TTS."""
    # Setup mock
    mock_response = MagicMock()
    mock_openai.audio.speech.create.return_value = mock_response

    response = client.post(
        "/tts",
        json={
            "text": "Hello world",
            "voice": "nova",
            "provider": "openai",
        },
    )
    assert response.status_code == 200
    assert response.headers["X-Odessa-TTS-Provider"] == "openai"


@pytest.mark.unit
def test_tts_endpoint_missing_text(client):
    """Test /tts endpoint with missing text."""
    response = client.post(
        "/tts",
        json={
            "voice": "pt-BR-AntonioNeural",
        },
    )
    # Should return 400 for missing required field
    assert response.status_code == 400


@pytest.mark.unit
@patch("server.main.kokoro_available")
@patch("server.main.generate_kokoro_wav")
def test_tts_endpoint_kokoro_success(mock_gen_wav, mock_available, client):
    """Test /tts success with Kokoro."""
    mock_available.return_value = True
    
    # Mock generating the file
    def side_effect(text, voice, speed, path):
        with open(path, "wb") as f:
            f.write(b"fake wav data")
    mock_gen_wav.side_effect = side_effect

    response = client.post(
        "/tts",
        json={
            "text": "Teste kokoro",
            "voice": "pf_dora",
            "provider": "kokoro",
        },
    )
    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/wav"
    assert response.headers["X-Odessa-TTS-Provider"] == "kokoro"
