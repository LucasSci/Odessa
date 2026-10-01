"""Memória que cresce: fatos por pessoa, o que a persona contou de si e resumos."""
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


def chat(user, text, **extra):
    return {"kind": "chat", "source": "bridge", "text": f"{user}: {text}", "metadata": {"user": user, "message": text}, **extra}


def reply(user, text):
    return {"kind": "reply", "source": "bridge", "text": text, "metadata": {"user": user, "persona": "viktoria"}}


@pytest.mark.parametrize(
    "text, expected",
    [
        ("meu nome é carlos, prazer", ("nome", "se chama Carlos")),
        ("sou de Campinas", ("cidade", "é de Campinas")),
        ("moro em São José dos Campos", ("cidade", "é de São José dos Campos")),
        ("tenho 34 anos", ("idade", "tem 34 anos")),
        ("torço pro Corinthians", ("time", "torce pro Corinthians")),
        ("sou programador", ("trabalho", "trabalho: programador")),
        ("eu adoro pizza de calabresa", ("gosto", "gosta de pizza de calabresa")),
    ],
)
def test_fatos_rapidos(text, expected):
    assert expected in memory_learning.extract_quick_facts(text)


def test_frases_que_nao_sao_fatos():
    assert memory_learning.extract_quick_facts("amo você demais") == []
    assert memory_learning.extract_quick_facts("me chamo linda? kkk") == []
    assert memory_learning.extract_quick_facts("oi tudo bem") == []


def test_mensagem_do_chat_ja_vira_fato_e_resposta_da_persona_nao_conta_como_mensagem(mem_db):
    memory_service.upsert_round_memory([chat("carlos_sp", "sou de Campinas"), reply("carlos_sp", "Campinas é linda à noite.")])
    profile = memory_service.get_profile("carlos_sp")
    assert profile["profile"]["total_messages"] == 1
    assert [f["fact"] for f in profile["facts"]] == ["é de Campinas"]
    assert {i["kind"] for i in profile["interactions"]} == {"chat", "reply"}


WORDS = ["pizza", "jazz", "praia", "futebol", "cinema", "vinho", "rock", "samba", "games", "anime", "leitura", "corrida", "cafe", "sushi", "pagode", "trilha", "xadrez", "teatro", "dança", "funk", "academia", "pesca", "carros", "motos", "gatos", "cachorros", "series", "novela", "churrasco", "cerveja", "chocolate", "violao", "bateria", "surfe", "skate"]


def test_fato_repetido_nao_duplica_e_valor_unico_substitui(mem_db):
    uid = "carlos_sp"
    assert memory_learning.add_viewer_fact(uid, "cidade", "é de Campinas")
    assert not memory_learning.add_viewer_fact(uid, "cidade", "É de Campinas!")
    assert memory_learning.add_viewer_fact(uid, "cidade", "mudou para Santos")
    assert [f["fact"] for f in memory_learning.list_viewer_facts(uid)] == ["mudou para Santos"]
    for i in range(memory_learning.MAX_FACTS_PER_VIEWER + 5):
        memory_learning.add_viewer_fact(uid, "gosto", f"gosta de {WORDS[i]}")
    assert len(memory_learning.list_viewer_facts(uid)) == memory_learning.MAX_FACTS_PER_VIEWER


def test_aprende_com_a_ia_ativa_e_entra_no_prompt(mem_db):
    events = [chat("carlos_sp", f"msg {i}") for i in range(3)] + [
        chat("carlos_sp", "trabalho com TI, programador"),
        reply("carlos_sp", "TI cansa, eu sei. Meu vinho favorito é Malbec, ajuda."),
        chat("carlos_sp", "tenho um cachorro chamado Thor"),
    ]
    memory_service.upsert_round_memory(events)
    seen = {}

    def fake_ai(system, user):
        seen["user"] = user
        return json.dumps({
            "fatos_pessoa": [{"categoria": "trabalho", "fato": "trabalha com TI"}, {"categoria": "vida", "fato": "tem um cachorro chamado Thor"}],
            "fatos_streamer": ["disse que o vinho favorito é Malbec"],
            "resumo": "Carlos contou do trabalho em TI e do cachorro Thor.",
        })

    result = memory_learning.learn_pending("viktoria", "Viktoria", fake_ai, min_new=3)
    assert result["learned"][0]["facts"] == 2
    assert "Viktoria: TI cansa" in seen["user"] and "carlos_sp: tenho um cachorro" in seen["user"]
    assert "carlos_sp: carlos_sp:" not in seen["user"]

    context = memory_learning.build_prompt_context("carlos_sp", "viktoria", "Viktoria")
    assert "trabalha com TI" in context["context"]
    assert "Thor" in context["context"]
    assert "Carlos contou do trabalho" in context["context"]
    assert "Malbec" in context["context"]
    # Já aprendido: não manda a mesma conversa de novo.
    assert memory_learning.pending_users(min_new=1) == []


def test_pessoa_nova_e_ia_com_resposta_ruim(mem_db):
    memory_service.upsert_round_memory([chat("nova", "oi")])
    context = memory_learning.build_prompt_context("nova", "viktoria", "Viktoria")
    assert "é novo(a) aqui" in context["context"]
    memory_service.upsert_round_memory([chat("nova", f"oi {i}") for i in range(10)])
    result = memory_learning.learn_pending("viktoria", "Viktoria", lambda s, u: "não sei", min_new=3)
    assert "error" in result["learned"][0]


def test_resetar_apaga_a_memoria_nova(mem_db):
    memory_service.upsert_round_memory([chat("carlos_sp", "sou de Campinas")])
    memory_learning.add_persona_fact("viktoria", "disse que gosta de jazz")
    memory_service.clear_all()
    assert memory_learning.list_viewer_facts("carlos_sp") == []
    assert memory_learning.list_persona_facts("viktoria") == []
