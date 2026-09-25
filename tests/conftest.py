"""Fixtures and configuration for pytest."""
import os
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# Add server module to path
sys.path.insert(0, str(Path(__file__).parent.parent))

# Hosts que os clientes de teste usam (TestClient = "testserver", httpx = o
# base_url do teste). Precisa vir ANTES de importar server.main: a guarda de
# Host lê isto na importação. Em produção o padrão é só localhost/127.0.0.1.
os.environ.setdefault("ODESSA_ALLOWED_HOSTS", "localhost,127.0.0.1,[::1],testserver,test")

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


@pytest.fixture(autouse=True)
def _fresh_login_rate_limit(monkeypatch):
    """Cada teste começa com o limite de tentativas de login zerado."""
    from server.api.v1.endpoints import auth as auth_endpoint
    from server.core.rate_limit import KeyedRateLimiter

    monkeypatch.setattr(auth_endpoint, "_login_limiter", KeyedRateLimiter(limit=10, window_s=60.0))
