import pytest
import os
from pathlib import Path
from server.main import app

@pytest.mark.unit
def test_health_endpoint_details(client):
    """Test /health endpoint in detail."""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "memory" in data
    assert "obs" in data
    assert "n8n" in data

@pytest.mark.unit
def test_read_root(client):
    """Test root endpoint."""
    response = client.get("/")
    assert response.status_code == 200
    assert "running" in response.json()["message"]

@pytest.mark.unit
def test_get_regions(client):
    """Test /regions endpoint."""
    response = client.get("/regions")
    assert response.status_code == 200
    data = response.json()
    assert "chat_region" in data
    assert "gifts_region" in data

@pytest.mark.unit
def test_log_endpoints(client):
    """Test /log and /clear-log endpoints."""
    # Clear first
    response = client.post("/clear-log")
    assert response.status_code == 200
    
    # Get log
    response = client.get("/log")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data["log"], list)
    assert data["total_lines"] == 0

@pytest.mark.unit
def test_tts_voices(client):
    """Test /tts/voices endpoint."""
    response = client.get("/tts/voices")
    assert response.status_code == 200
    data = response.json()
    assert "providers" in data
    assert "voices" in data
    assert len(data["voices"]) > 0
