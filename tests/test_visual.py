import pytest
from unittest.mock import patch, MagicMock

@pytest.mark.unit
def test_visual_lab_runs(client):
    """Test /visual-lab/runs endpoint."""
    response = client.get("/visual-lab/runs")
    assert response.status_code == 200
    data = response.json()
    assert "runs" in data

@pytest.mark.unit
@patch("server.main.generate_ai_text_with_fallback")
def test_visual_lab_run_success(mock_gen, client):
    """Test /visual-lab/run success."""
    mock_gen.return_value = ('{"summary": "Test", "assetRequests": []}', "gemini")
    
    response = client.post(
        "/visual-lab/run",
        json={
            "objective": "Gerar Odessa",
            "mode": "creative",
            "maxPrompts": 1,
            "maxImages": 0,
            "requestedBy": "Lucas"
        }
    )
    assert response.status_code == 200
    data = response.json()
    assert data["ok"] == True
    assert "visualRun" in data
