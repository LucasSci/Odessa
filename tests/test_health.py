import pytest
from httpx import ASGITransport, AsyncClient

from server.main import app
from server.core.auth import ADMIN_PASSWORD


@pytest.mark.asyncio
async def test_health_endpoint():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        await ac.post("/auth/login", json={"password": ADMIN_PASSWORD})
        response = await ac.get("/api/v1/misc/health")
    assert response.status_code == 200
    data = response.json()
    # Validate required fields
    assert "status" in data
    assert "ocr" in data
    assert isinstance(data["status"], str)
    assert isinstance(data["ocr"], str)
