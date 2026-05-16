"""Fixtures and configuration for pytest."""
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# Add server module to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from server.main import app
from server.core.auth import ADMIN_PASSWORD


@pytest.fixture
def client():
    """FastAPI test client."""
    with TestClient(app) as test_client:
        test_client.post("/auth/login", json={"password": ADMIN_PASSWORD})
        yield test_client


@pytest.fixture
def sample_image_base64():
    """Sample base64 encoded image (1x1 white pixel PNG)."""
    return (
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="
    )
