"""Desligar o Odessa: para a bridge, tira a IA local da memória, fecha só o Ollama
que o Odessa abriu e encerra o servidor pelo caminho normal (SIGINT)."""
import asyncio
import subprocess

from server.api.v1.endpoints import ai, system


class FakeBridge:
    def __init__(self):
        self.is_running = True
        self.stopped = False

    async def stop(self):
        self.stopped = True
        self.is_running = False
        return {"ok": True}


def test_desligar_para_tudo_e_sai_pelo_sigint(monkeypatch):
    from server.services import bridge_manager as bm

    bridge = FakeBridge()
    calls = []
    monkeypatch.setattr(bm, "bridge_manager", bridge)

    async def fake_unload():
        calls.append("unload")
        return {"ok": True}

    monkeypatch.setattr(ai, "ollama_unload", fake_unload)
    monkeypatch.setattr(ai, "stop_owned_ollama", lambda: calls.append("stop_ollama") or True)
    monkeypatch.setattr(system.signal, "raise_signal", lambda sig: calls.append(("signal", sig)))

    asyncio.run(system._stop_everything())

    assert bridge.stopped
    assert calls == ["unload", "stop_ollama", ("signal", system.signal.SIGINT)]


def test_rota_responde_na_hora_e_nao_dispara_duas_vezes(client, monkeypatch):
    started = []

    async def fake_stop():
        started.append(1)

    monkeypatch.setattr(system, "_stop_everything", fake_stop)
    monkeypatch.setattr(system, "_shutting_down", False)
    assert client.post("/api/v1/system/shutdown").json() == {"ok": True, "shuttingDown": True}
    assert client.post("/api/v1/system/shutdown").json()["shuttingDown"] is True
    assert client.get("/api/v1/system/status").json()["shuttingDown"] is True
    assert len(started) <= 1


def test_so_fecha_o_ollama_que_o_odessa_abriu(monkeypatch):
    monkeypatch.setattr(ai, "_owned_ollama_proc", None)
    assert ai.stop_owned_ollama() is False  # Ollama do usuário: não é tocado

    proc = subprocess.Popen(["python", "-c", "import time; time.sleep(30)"])
    monkeypatch.setattr(ai, "_owned_ollama_proc", proc)
    assert ai.stop_owned_ollama() is True
    assert proc.poll() is not None
    assert ai._owned_ollama_proc is None
