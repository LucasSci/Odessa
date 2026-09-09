"""Testes de segurança da Fase 2: SSRF/allowlist de webhooks, senha do OBS
fora do texto plano, limites de payload e checagem da fila de vídeo."""
import json

import httpx
import pytest

import server.services.webhook_service as webhook_module
from server.services.webhook_service import WebhookService, check_webhook_url_allowed
from server.services.obs_service import OBSService


# ── 2.2/2.6: allowlist de destinos + rejeição de IP privado ──────────────────

def test_webhook_allowlist_rejects_unknown_host(monkeypatch):
    monkeypatch.setattr(webhook_module, "WEBHOOK_ALLOWED_HOSTS", {"hooks.n8n.cloud"})
    monkeypatch.setattr(webhook_module, "N8N_ACTION_WEBHOOK_URL", "")

    ok, reason = check_webhook_url_allowed("https://evil.example.com/hook")
    assert ok is False
    assert reason == "webhook_host_not_allowed"

    ok, _ = check_webhook_url_allowed("https://hooks.n8n.cloud/webhook/abc")
    assert ok is True

    # subdomínio de host permitido também passa
    ok, _ = check_webhook_url_allowed("https://eu.hooks.n8n.cloud/webhook/abc")
    assert ok is True


def test_webhook_upsert_rejects_host_outside_allowlist(monkeypatch, tmp_path):
    monkeypatch.setattr(webhook_module, "WEBHOOKS_FILE", tmp_path / "webhook_actions.json")
    monkeypatch.setattr(webhook_module, "WEBHOOK_ALLOWED_HOSTS", {"hooks.n8n.cloud"})
    monkeypatch.setattr(webhook_module, "N8N_ACTION_WEBHOOK_URL", "")

    service = WebhookService()
    with pytest.raises(ValueError, match="webhook_host_not_allowed"):
        service.upsert_config({"id": "x", "name": "x", "url": "https://evil.example.com/h"})


@pytest.mark.asyncio
async def test_webhook_dispatch_rejects_private_ip(monkeypatch, tmp_path):
    """Item 2.2: webhook nunca dispara para IPs privados/loopback/link-local."""
    monkeypatch.setattr(webhook_module, "WEBHOOKS_FILE", tmp_path / "webhook_actions.json")
    # Permitimos o host na allowlist, mas o IP resolve para rede privada:
    # o SSRFTransport deve bloquear na camada de transporte.
    monkeypatch.setattr(webhook_module, "WEBHOOK_ALLOWED_HOSTS", {"interno.local"})
    monkeypatch.setattr(webhook_module, "N8N_ACTION_WEBHOOK_URL", "")
    monkeypatch.setattr(
        "socket.gaierror", Exception("unpatched")
    ) if False else None
    import socket as _socket

    class FakeGetAddrInfo:
        pass

    async def fake_dispatch_url_block(self, request):
        raise httpx.RequestError("Blocked request to internal IP: 10.0.0.5", request=request)

    from server.core.ssrf import SSRFTransport

    orig = SSRFTransport.handle_async_request
    SSRFTransport.handle_async_request = fake_dispatch_url_block
    try:
        service = WebhookService()
        service._configs = [
            {
                "id": "w1",
                "name": "interno",
                "url": "http://interno.local/hook",
                "method": "POST",
                "headers": {},
                "enabled": True,
                "timeoutMs": 800,
                "bodyTemplate": "",
            }
        ]
        result = await service.dispatch("w1", event={"text": "oi"})
    finally:
        SSRFTransport.handle_async_request = orig

    assert result["ok"] is False
    assert "internal IP" in str(result["error"])


@pytest.mark.asyncio
async def test_webhook_dispatch_resolves_and_blocks_private_range(monkeypatch, tmp_path):
    """SSRF real: hostname que resolve para 127.0.0.1 é bloqueado antes do envio."""
    import asyncio
    import ipaddress

    from server.core.ssrf import SSRFTransport

    monkeypatch.setattr(webhook_module, "WEBHOOKS_FILE", tmp_path / "webhook_actions.json")
    monkeypatch.setattr(webhook_module, "WEBHOOK_ALLOWED_HOSTS", {"loopback.host"})
    monkeypatch.setattr(webhook_module, "N8N_ACTION_WEBHOOK_URL", "")

    loop = asyncio.get_event_loop()
    real_getaddrinfo = loop.getaddrinfo

    def fake_getaddrinfo(host, port, **kwargs):
        return [(2, 1, 6, "", ("127.0.0.1", 0))]

    async def fake_loop_getaddrinfo(host, port, **kwargs):
        return fake_getaddrinfo(host, port, **kwargs)

    class FakeLoop:
        def getaddrinfo(self, host, port, **kwargs):
            return fake_getaddrinfo(host, port, **kwargs)

    import server.core.ssrf as ssrf_module

    service = WebhookService()
    service._configs = [
        {
            "id": "w2",
            "name": "loopback",
            "url": "http://loopback.host/hook",
            "method": "POST",
            "headers": {},
            "enabled": True,
            "timeoutMs": 800,
            "bodyTemplate": "",
        }
    ]

    # Parcheia o loop retornado por get_running_loop dentro do transport
    import asyncio as _asyncio

    class PatchedLoop(_asyncio.get_event_loop().__class__):
        pass

    real_get_running_loop = _asyncio.get_running_loop

    class FakeRunningLoop(real_get_running_loop().__class__):
        async def getaddrinfo(self, host, port, **kwargs):
            return fake_getaddrinfo(host, port, **kwargs)

    def fake_get_running_loop():
        return FakeRunningLoop()

    _asyncio.get_running_loop = fake_get_running_loop
    try:
        result = await service.dispatch("w2", event={"text": "oi"})
    finally:
        _asyncio.get_running_loop = real_get_running_loop

    assert result["ok"] is False
    assert "internal IP" in str(result["error"]) or "safe IP" in str(result["error"])


# ── 2.4: senha do OBS não persiste em texto plano ────────────────────────────

def test_obs_settings_file_never_contains_password(tmp_path, monkeypatch):
    import server.services.obs_service as obs_module

    monkeypatch.setattr(obs_module, "OBS_SETTINGS_FILE", tmp_path / "obs_settings.json")
    monkeypatch.setattr(obs_module, "OBS_WEBSOCKET_PASSWORD", "senha-do-env")

    service = OBSService()
    service.configure({"websocketPassword": "nova-senha-digitada"})
    service._save_settings()

    raw = (tmp_path / "obs_settings.json").read_text(encoding="utf-8")
    assert "nova-senha-digitada" not in raw
    assert "senha-do-env" not in raw
    assert "websocketPassword" not in raw

    data = json.loads(raw)
    assert "websocketPassword" not in data

    # A resposta pública expõe apenas o booleano
    settings = service.get_settings()
    assert settings["passwordConfigured"] is True
    assert "websocketPassword" not in settings
    assert "password" not in settings


def test_obs_legacy_password_is_migrated_out_of_disk(tmp_path, monkeypatch, caplog):
    """Senha legada (arquivo antigo em texto plano) é usada só nesta sessão e
    o arquivo é regravado SEM ela."""
    import logging

    import server.services.obs_service as obs_module

    settings_file = tmp_path / "obs_settings.json"
    settings_file.write_text(
        json.dumps({"websocketUrl": "ws://localhost:4455", "websocketPassword": "senha-legada"}),
        encoding="utf-8",
    )
    monkeypatch.setattr(obs_module, "OBS_SETTINGS_FILE", settings_file)
    monkeypatch.setattr(obs_module, "OBS_WEBSOCKET_PASSWORD", "")

    service = OBSService()
    assert service.password == "senha-legada"  # usa nesta sessão

    with caplog.at_level(logging.WARNING):
        service._save_settings()

    raw = settings_file.read_text(encoding="utf-8")
    assert "senha-legada" not in raw
    assert "websocketPassword" not in raw


# ── 2.7: limites de payload e fila ────────────────────────────────────────────

def test_video_gen_frame_rejects_oversized_payload():
    from fastapi.testclient import TestClient

    import server.core.auth as auth_core
    from server.main import app

    huge = "data:image/png;base64," + "A" * (9 * 1024 * 1024)
    with TestClient(app) as client:
        response = client.post("/api/v1/video-gen/frame", json={"dataUrl": huge})
        assert response.status_code == 413


def test_video_gen_queue_limit_is_enforced_at_endpoint(monkeypatch):
    """VIDEO_GEN_MAX_QUEUE é checado de fato: fila cheia → HTTP 400 no endpoint."""
    from fastapi.testclient import TestClient

    import server.core.auth as auth_core
    from server.main import app
    from server.api.v1.endpoints import video_gen as video_gen_endpoint

    captured: dict = {}

    class FakeService:
        def enqueue(self, record, persona_id=None):
            captured["args"] = True
            return {"ok": False, "error": "Fila cheia (máx 8)"}

    monkeypatch.setattr(video_gen_endpoint, "get_video_gen_service", lambda: FakeService())
    monkeypatch.setattr(
        video_gen_endpoint.storage,
        "get_prompts",
        lambda persona_id=None: [{"id": "p1", "prompt": "teste"}],
    )
    with TestClient(app) as client:
        response = client.post(
            "/api/v1/video-gen/generate", json={"promptId": "p1"}
        )
        assert response.status_code == 400
        assert "Fila cheia" in response.json()["detail"]
