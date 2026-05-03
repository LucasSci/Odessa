import pytest
from unittest.mock import patch, MagicMock

@pytest.mark.unit
@patch("server.main.post_json_to_n8n")
def test_get_obs_scenes_success(mock_post, client):
    """Test /obs/scenes success via n8n mock."""
    mock_post.return_value = {
        "status_code": 200,
        "body": '{"scenes": ["Gameplay", "Chat"], "currentScene": "Chat"}'
    }
    
    response = client.get("/obs/scenes")
    assert response.status_code == 200
    data = response.json()
    assert data["ok"] == True
    assert "Gameplay" in data["scenes"]
    assert data["currentScene"] == "Chat"

@pytest.mark.unit
@patch("server.main.N8N_ACTION_WEBHOOK_URL", None)
def test_get_obs_scenes_not_configured(client):
    """Test /obs/scenes when n8n is not configured."""
    response = client.get("/obs/scenes")
    assert response.status_code == 200 # Returns error in JSON body according to implementation
    data = response.json()
    assert data["ok"] == False
    assert "not configured" in data["error"]
