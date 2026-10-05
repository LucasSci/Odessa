"""Rotas da memória que cresce (ver server/tests/test_memory_learning.py)."""
import json

import pytest

from server.core.database import Database
from server.services import memory_learning, memory_service as memory_module
from server.services.memory_service import memory_service


@pytest.fixture
def mem_db(tmp_path, monkeypatch):
    database = Database(tmp_path / "memory.db")
    monkeypatch.setattr(memory_module, "db", database)
    monkeypatch.setattr(memory_learning, "db", database)
    return database


def chat(user, text):
    return {"kind": "chat", "source": "bridge", "text": f"{user}: {text}", "metadata": {"user": user, "message": text}}


def test_rotas_da_memoria(client, mem_db, monkeypatch):
    memory_service.upsert_round_memory([chat("carlos_sp", "sou de Campinas"), chat("carlos_sp", "oi de novo")])
    ctx = client.get("/api/v1/memory/context", params={"username": "carlos_sp", "persona": "viktoria", "personaName": "Viktoria"}).json()
    assert "é de Campinas" in ctx["context"]
    fact_id = memory_learning.list_viewer_facts("carlos_sp")[0]["id"]
    assert client.delete(f"/api/v1/memory/facts/{fact_id}").json() == {"ok": True}
    assert "Campinas" not in client.get("/api/v1/memory/context", params={"username": "carlos_sp"}).json()["context"]

    from server.services.ai_service import ai_service

    monkeypatch.setattr(
        ai_service,
        "generate_ai_text_with_fallback",
        lambda **kw: (json.dumps({"fatos_pessoa": [], "fatos_streamer": ["disse que ama Casablanca"], "resumo": "Papo rápido."}), "ollama"),
    )
    learned = client.post("/api/v1/memory/learn", json={"persona_id": "viktoria", "persona_name": "Viktoria", "min_new": 1}).json()
    assert learned["status"] == "done"
    facts = client.get("/api/v1/memory/persona-facts", params={"persona": "viktoria"}).json()["facts"]
    assert facts[0]["fact"] == "disse que ama Casablanca"
