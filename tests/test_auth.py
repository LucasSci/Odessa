from fastapi.testclient import TestClient

from server.main import app


def test_auth_endpoints_are_open_when_login_is_disabled():
    with TestClient(app) as client:
        login = client.post("/auth/login", json={"password": "wrong"})
        assert login.status_code == 200
        login_data = login.json()
        assert login_data["authenticated"] is True
        assert login_data["authDisabled"] is True
        assert login_data["sessionToken"] == ""

        me = client.get("/auth/me")
        assert me.status_code == 200
        assert me.json()["authenticated"] is True
        assert me.json()["authDisabled"] is True

        logout = client.post("/auth/logout")
        assert logout.status_code == 200
        assert client.get("/auth/me").status_code == 200


def test_operational_api_is_available_without_session():
    with TestClient(app) as client:
        assert client.get("/api/v1/video/config").status_code == 200
        assert client.get("/health").status_code == 200


def test_video_playback_is_public_for_video_elements():
    with TestClient(app) as client:
        response = client.get("/api/v1/video/play/01_FLUXO_idle_sorriso_leve")
        assert response.status_code in {200, 404}
        assert response.status_code != 401


def test_bearer_token_is_not_required_for_api_access():
    with TestClient(app) as client:
        response = client.get("/api/v1/video/config", headers={"Authorization": "Bearer invalid"})
        assert response.status_code == 200
