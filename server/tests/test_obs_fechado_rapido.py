"""Com o OBS fechado, o Odessa responde na hora em vez de esperar ~4 s de conexão recusada."""
import asyncio
import time

import pytest

from server.services import obs_service as module


def test_obs_fechado_responde_na_hora_no_programa(monkeypatch):
    monkeypatch.setenv("ODESSA_DESKTOP", "1")
    monkeypatch.setattr(module, "_obs_process_running", lambda: False)
    service = module.OBSService()
    service.enabled = True
    service.connected = False
    service._last_connect_attempt = 0.0
    start = time.monotonic()
    with pytest.raises(RuntimeError, match="OBS está fechado"):
        asyncio.run(service.connect(force=True))
    assert time.monotonic() - start < 0.5


def test_url_local_reconhecida():
    assert module._is_local_url("ws://localhost:4455")
    assert module._is_local_url("ws://127.0.0.1:4455")
    assert not module._is_local_url("ws://192.168.0.10:4455")
