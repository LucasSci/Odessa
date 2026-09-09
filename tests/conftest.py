"""Fixtures and configuration for pytest."""
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# Add server module to path
sys.path.insert(0, str(Path(__file__).parent.parent))

import server.core.auth as auth_core
from server.main import app

@pytest.fixture
def client():
    """FastAPI test client."""
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def sample_image_base64():
    """Sample base64 encoded image (1x1 white pixel PNG)."""
    return (
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="
    )


@pytest.fixture(autouse=True)
def _dev_auth_by_default(monkeypatch):
    """Testes funcionais rodam em modo dev (auth desativada).

    Testes de AUTENTICAÇÃO (tests/test_auth.py) sobrescrevem este default com
    monkeypatch explícito de AUTH_DISABLED=False — o monkeypatch do teste é
    aplicado depois da fixture e vence.
    """
    monkeypatch.setattr(auth_core, "AUTH_DISABLED", True)
