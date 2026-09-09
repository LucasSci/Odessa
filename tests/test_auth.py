from fastapi.testclient import TestClient

import pytest

import server.core.auth as auth_core
from server.main import app


def _enable_auth(monkeypatch, password="senha-super-secreta"):
    monkeypatch.setattr(auth_core, "AUTH_DISABLED", False)
    monkeypatch.setattr(auth_core, "ADMIN_EMAIL", "admin@teste.local")
    monkeypatch.setattr(auth_core, "ADMIN_PASSWORD", password)


def test_login_rejects_wrong_password(monkeypatch):
    _enable_auth(monkeypatch)
    with TestClient(app) as client:
        response = client.post(
            "/auth/login",
            json={"email": "admin@teste.local", "password": "errada"},
        )
        assert response.status_code == 401


def test_login_returns_session_token_on_success(monkeypatch):
    _enable_auth(monkeypatch)
    with TestClient(app) as client:
        response = client.post(
            "/auth/login",
            json={"email": "admin@teste.local", "password": "senha-super-secreta"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["authenticated"] is True
        assert data["authDisabled"] is False
        assert data["sessionToken"]
        "odessa_admin_session" in response.cookies


def test_operational_routes_require_authentication(monkeypatch):
    _enable_auth(monkeypatch)
    with TestClient(app) as client:
        # Sem sessão → 401
        assert client.get("/api/v1/video/config").status_code == 401
        assert client.get("/api/v1/automation/status").status_code == 401
        assert client.get("/health").status_code == 200  # health público sanitizado

        # Com token Bearer válido → 200
        login = client.post(
            "/auth/login",
            json={"email": "admin@teste.local", "password": "senha-super-secreta"},
        )
        token = login.json()["sessionToken"]
        headers = {"Authorization": f"Bearer {token}"}
        assert client.get("/api/v1/video/config", headers=headers).status_code == 200


def test_invalid_bearer_token_is_rejected(monkeypatch):
    _enable_auth(monkeypatch)
    with TestClient(app) as client:
        response = client.get(
            "/api/v1/video/config", headers={"Authorization": "Bearer invalido.total"}
        )
        assert response.status_code == 401


def test_video_playback_is_public_for_video_elements(monkeypatch):
    _enable_auth(monkeypatch)
    with TestClient(app) as client:
        response = client.get("/api/v1/video/play/01_FLUXO_idle_sorriso_leve")
        assert response.status_code in {200, 404}
        assert response.status_code != 401


def test_dev_mode_env_var_disables_auth(monkeypatch):
    monkeypatch.setattr(auth_core, "AUTH_DISABLED", True)
    with TestClient(app) as client:
        login = client.post("/auth/login", json={"password": "qualquer"})
        assert login.status_code == 200
        assert login.json()["authDisabled"] is True
        assert client.get("/api/v1/video/config").status_code == 200
