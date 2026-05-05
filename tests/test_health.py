import pytest
from httpx import ASGITransport, AsyncClient

from server.main import app


@pytest.mark.asyncio
async def test_health_endpoint():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        response = await ac.get("/health")
    assert response.status_code == 200
    data = response.json()
    # Validate required fields
    assert "status" in data
    assert "ocr" in data
    assert isinstance(data["status"], str)
    assert isinstance(data["ocr"], str)
