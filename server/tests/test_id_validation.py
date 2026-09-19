import pytest

from server.core import persona_manager
from server.services import session_history as sh


# ── sessionId ────────────────────────────────────────────────────────────────

def test_session_id_valido():
    assert sh.is_valid_session_id("session_20260919_101500")


@pytest.mark.parametrize("value", [
    "../../data/logs/execution",
    "session_20260919_101500/../x",
    "session_2026_1015",
    "session_20260919_101500.jsonl",
    "",
    None,
    123,
])
def test_session_id_invalido(value):
    assert not sh.is_valid_session_id(value)


def test_service_nao_le_arquivo_fora_da_pasta(tmp_path):
    (tmp_path / "secret.jsonl").write_text('{"type":"x"}\n', encoding="utf-8")
    service = sh.SessionHistoryService(base_dir=tmp_path / "session-history")
    assert service._read_events("../secret") == []
    assert service._count_events("../secret") == 0
    with pytest.raises(ValueError):
        service._session_file("../secret")


# ── persona id ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize("value", ["barbara", "viktoria-2", "a_b", "x" * 40])
def test_persona_id_valido(value):
    assert persona_manager.PERSONA_ID_RE.fullmatch(value)


@pytest.mark.parametrize("value", ["../x", "a/b", "A", "-x", "x" * 41, "a b", "", "a\\b", "..", "a.json"])
def test_persona_id_invalido(value):
    assert not persona_manager.PERSONA_ID_RE.fullmatch(value)


def test_create_persona_recusa_id_com_traversal(tmp_path, monkeypatch):
    monkeypatch.setattr(persona_manager, "DATA_DIR", tmp_path / "data")
    monkeypatch.setattr(persona_manager, "PERSONAS_INDEX_PATH", tmp_path / "data" / "personas.json")
    (tmp_path / "data").mkdir()
    with pytest.raises(persona_manager.InvalidPersonaId):
        persona_manager.create_persona({"id": "../evil", "name": "x"})
    assert not (tmp_path / "persona_evil.json").exists()
    assert not list((tmp_path / "data").glob("persona_*.json"))


def test_slugify_limita_tamanho_e_gera_id_valido():
    slug = persona_manager._slugify("Um Nome Muito Longo " * 10)
    assert persona_manager.PERSONA_ID_RE.fullmatch(slug)
    assert len(slug) <= 40
