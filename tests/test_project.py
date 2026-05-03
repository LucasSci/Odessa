import pytest
from unittest.mock import MagicMock, patch

@pytest.mark.unit
def test_project_tasks(client):
    """Test /project/tasks endpoint."""
    response = client.get("/project/tasks")
    assert response.status_code == 200
    data = response.json()
    assert "tasks" in data
    assert "total" in data

@pytest.mark.unit
@patch("server.main.generate_ai_text_with_fallback")
def test_project_create_plan_success(mock_gen, client):
    """Test /project/create-plan success."""
    mock_gen.return_value = ('{"title": "Test Plan", "tasks": []}', "gemini")
    
    response = client.post(
        "/project/create-plan",
        json={
            "title": "Novo Plano",
            "brief": "Fazer testes",
            "area": "backend",
            "priority": "high",
            "requestedBy": "Lucas"
        }
    )
    assert response.status_code == 200
    data = response.json()
    assert data["ok"] == True
    assert "projectPlan" in data

@pytest.mark.unit
@patch("server.main.generate_ai_text_with_fallback")
def test_project_night_shift_success(mock_gen, client):
    """Test /project/night-shift success."""
    mock_gen.return_value = ('{"title": "Night Shift", "advancements": []}', "gemini")
    
    response = client.post(
        "/project/night-shift",
        json={
            "objective": "Avançar nos testes",
            "focusAreas": ["backend"],
            "durationMinutes": 60,
            "maxAdvancements": 3,
            "requestedBy": "Lucas"
        }
    )
    assert response.status_code == 200
    data = response.json()
    assert data["ok"] == True
    assert "nightShift" in data
