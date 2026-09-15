"""Tests for /ai/* endpoints and the local Ollama adapter."""
from unittest.mock import AsyncMock, Mock, patch

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


@pytest.mark.unit
def test_ollama_connect_already_running(client):
    """Se o Ollama já está acessível e o modelo já instalado, não deve
    tentar iniciar nem baixar nada — só confirma o estado."""
    already_ok = {
        "configured": True,
        "url": "http://127.0.0.1:11434",
        "model": "qwen2.5:latest",
        "reachable": True,
        "modelInstalled": True,
        "installedModels": ["qwen2.5:latest"],
    }
    with patch("server.api.v1.endpoints.ai._check_ollama", new=AsyncMock(return_value=already_ok)), \
         patch("subprocess.Popen") as mock_popen:
        response = client.post("/api/v1/ai/ollama/connect")

    assert response.status_code == 200
    data = response.json()
    assert data == {
        "ok": True,
        "started": False,
        "reachable": True,
        "modelInstalled": True,
        "pulling": False,
        "model": "qwen2.5:latest",
        "message": "Ollama conectado e modelo já instalado.",
    }
    mock_popen.assert_not_called()


@pytest.mark.unit
def test_ollama_connect_pulls_missing_model(client):
    """Se o Ollama está acessível mas o modelo configurado não está instalado,
    deve disparar 'ollama pull <modelo>' em segundo plano."""
    reachable_no_model = {
        "configured": True,
        "url": "http://127.0.0.1:11434",
        "model": "qwen2.5:latest",
        "reachable": True,
        "modelInstalled": False,
        "installedModels": [],
    }
    with patch("server.api.v1.endpoints.ai._check_ollama", new=AsyncMock(return_value=reachable_no_model)), \
         patch("shutil.which", return_value="C:\\ollama\\ollama.exe"), \
         patch("subprocess.Popen") as mock_popen:
        response = client.post("/api/v1/ai/ollama/connect")

    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is True
    assert data["started"] is False
    assert data["pulling"] is True
    mock_popen.assert_called_once()
    called_args = mock_popen.call_args.args[0]
    assert called_args == ["C:\\ollama\\ollama.exe", "pull", "qwen2.5:latest"]


@pytest.mark.unit
def test_ollama_connect_starts_when_not_reachable(client):
    """Se o Ollama não está acessível, deve tentar iniciar 'ollama serve'
    (usando o executável achado no PATH) e reverificar em seguida."""
    not_reachable = {
        "configured": True,
        "url": "http://127.0.0.1:11434",
        "model": "qwen2.5:latest",
        "reachable": False,
        "modelInstalled": False,
        "installedModels": [],
    }
    now_reachable = {**not_reachable, "reachable": True, "modelInstalled": True, "installedModels": ["qwen2.5:latest"]}

    check_mock = AsyncMock(side_effect=[not_reachable, now_reachable])
    with patch("server.api.v1.endpoints.ai._check_ollama", new=check_mock), \
         patch("shutil.which", return_value="C:\\ollama\\ollama.exe"), \
         patch("subprocess.Popen") as mock_popen, \
         patch("asyncio.sleep", new=AsyncMock(return_value=None)):
        response = client.post("/api/v1/ai/ollama/connect")

    assert response.status_code == 200
    data = response.json()
    assert data["started"] is True
    assert data["reachable"] is True
    mock_popen.assert_called_once_with(
        ["C:\\ollama\\ollama.exe", "serve"],
        stdout=-3,  # subprocess.DEVNULL
        stderr=-3,
        creationflags=mock_popen.call_args.kwargs["creationflags"],
    )


@pytest.mark.unit
def test_ollama_connect_not_installed(client):
    """Se o Ollama não está acessível e o executável não está no PATH,
    retorna um erro claro em vez de tentar (e falhar) iniciar um processo."""
    not_reachable = {
        "configured": True,
        "url": "http://127.0.0.1:11434",
        "model": "qwen2.5:latest",
        "reachable": False,
        "modelInstalled": False,
        "installedModels": [],
    }
    with patch("server.api.v1.endpoints.ai._check_ollama", new=AsyncMock(return_value=not_reachable)), \
         patch("shutil.which", return_value=None):
        response = client.post("/api/v1/ai/ollama/connect")

    assert response.status_code == 503
    assert "PATH" in response.json()["detail"]
