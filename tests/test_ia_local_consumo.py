"""Consumo da IA local (Ollama): núcleos limitados, RAM liberada fora da live.

Sem limite, o Ollama usa todos os núcleos e o modelo ficava carregado o tempo
todo com o Odessa aberto — o PC inteiro travava (OBS, navegador, a própria live).
"""
import asyncio

import httpx
import pytest

from server.services import ai_service as ai_module


class _FakeResponse:
    def raise_for_status(self):
        return None

    def json(self):
        return {"message": {"content": "oi, chat!"}}


def test_resposta_limita_nucleos_e_tempo_do_modelo_na_ram(monkeypatch):
    sent = {}

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def post(self, url, json):
            sent.update(json)
            return _FakeResponse()

    monkeypatch.setattr(httpx, "Client", FakeClient)
    text = ai_module.ai_service.generate_ollama_text("sistema", "usuário", 0.7)

    assert text == "oi, chat!"
    assert sent["options"]["num_thread"] == ai_module.OLLAMA_NUM_THREAD
    assert 2 <= sent["options"]["num_thread"] < 12
    assert sent["keep_alive"] == ai_module.OLLAMA_KEEP_ALIVE == "10m"


def _run_one_keepalive_cycle(monkeypatch, live: bool) -> list:
    pings = []

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def post(self, url, json):
            pings.append(json)

    async def live_active():
        return live

    class StopLoop(Exception):
        pass

    async def fake_sleep(_seconds):
        raise StopLoop

    monkeypatch.setattr(httpx, "AsyncClient", FakeAsyncClient)
    monkeypatch.setattr(ai_module, "_live_session_active", live_active)
    monkeypatch.setattr(asyncio, "sleep", fake_sleep)
    monkeypatch.setattr("server.config.AI_PROVIDER", "ollama")
    with pytest.raises(StopLoop):
        asyncio.run(ai_module.ollama_keepalive_loop())
    return pings


def test_sem_live_o_modelo_nao_fica_preso_na_memoria(monkeypatch):
    assert _run_one_keepalive_cycle(monkeypatch, live=False) == []


def test_durante_a_live_o_modelo_fica_aquecido(monkeypatch):
    pings = _run_one_keepalive_cycle(monkeypatch, live=True)
    assert len(pings) == 1
    assert pings[0]["keep_alive"] == "10m"
