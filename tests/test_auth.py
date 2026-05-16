from fastapi.testclient import TestClient

from server.main import app
from server.core.auth import ADMIN_PASSWORD


def test_login_with_wrong_password_is_rejected():
    with TestClient(app) as client:
        response = client.post("/auth/login", json={"password": "wrong"})
        assert response.status_code == 401
        assert "odessa_admin_session" not in response.cookies


def test_login_me_and_logout():
    with TestClient(app) as client:
        login = client.post("/auth/login", json={"password": ADMIN_PASSWORD})
        assert login.status_code == 200
        login_data = login.json()
        assert login_data["authenticated"] is True
        assert login_data["role"] == "admin"
        assert login_data["sessionToken"]

        me = client.get("/auth/me")
        assert me.status_code == 200
        assert me.json() == {"authenticated": True, "role": "admin"}

        logout = client.post("/auth/logout")
        assert logout.status_code == 200
        assert client.get("/auth/me").status_code == 401


def test_operational_api_requires_session():
    with TestClient(app) as client:
        assert client.get("/api/v1/video/config").status_code == 401
        assert client.get("/health").status_code == 200


def test_video_playback_is_public_for_video_elements():
    with TestClient(app) as client:
        response = client.get("/api/v1/video/play/01_FLUXO_idle_sorriso_leve")
        assert response.status_code in {200, 404}
        assert response.status_code != 401


def test_bearer_session_token_authenticates_api():
    with TestClient(app) as client:
        login = client.post("/auth/login", json={"password": ADMIN_PASSWORD})
        token = login.json()["sessionToken"]

        stateless_client = TestClient(app)
        response = stateless_client.get("/api/v1/video/config", headers={"Authorization": f"Bearer {token}"})
        assert response.status_code == 200
