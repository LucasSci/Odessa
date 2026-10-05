"""Personalidade "voz humana": troca só o texto que o app trouxe; o personalizado fica."""
import json

import pytest

from server.core import atomic_json as aj
from server.core import persona_manager as pm
from server.core.persona_voice import CURRENT, PREVIOUS


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(pm, "DATA_DIR", tmp_path)
    monkeypatch.setattr(pm, "PERSONAS_INDEX_PATH", tmp_path / "personas.json")
    monkeypatch.setattr(pm, "DEFAULT_CONFIG_PATH", tmp_path / "persona_config.json")
    aj.clear_recovery_events()
    return tmp_path


def write_index(data_dir, personas):
    (data_dir / "personas.json").write_text(json.dumps({"activePersonaId": "viktoria", "personas": personas}), encoding="utf-8")


def test_texto_antigo_do_app_vira_a_voz_humana_com_backup(data_dir):
    write_index(data_dir, [
        {"id": "viktoria", "name": "Viktoria", "personality": PREVIOUS["viktoria"][0]},
        {"id": "barbara", "name": "Barbara", "personality": PREVIOUS["barbara"][1]},
    ])
    personas = {p["id"]: p for p in pm.list_personas()}
    assert personas["viktoria"]["personality"] == CURRENT["viktoria"]
    assert personas["barbara"]["personality"] == CURRENT["barbara"]
    assert list(data_dir.glob("personas.antes-voz-humana-*.json"))


def test_texto_personalizado_nao_e_tocado(data_dir):
    write_index(data_dir, [{"id": "viktoria", "name": "Viktoria", "personality": "Você é a Viktoria, do meu jeito."}])
    assert pm.list_personas()[0]["personality"] == "Você é a Viktoria, do meu jeito."
    assert not list(data_dir.glob("personas.antes-voz-humana-*.json"))


def test_voz_humana_tem_fatos_fixos_e_exemplo_de_ia_e_de_contato():
    for text in CURRENT.values():
        assert "FATOS FIXOS" in text
        assert "nunca copie" in text
        assert "IA?" in text
        assert "whats" in text  # a recusa de contato sai do exemplo (contactDeflection)


def test_voz_em_ingles_e_acrescentada_sem_tocar_no_portugues(data_dir):
    from server.core.persona_voice import ENGLISH

    write_index(data_dir, [
        {"id": "viktoria", "name": "Viktoria", "personality": "Meu texto em português, personalizado."},
        {"id": "barbara", "name": "Barbara", "personality": CURRENT["barbara"], "personalityEn": "My own English text."},
    ])
    personas = {p["id"]: p for p in pm.list_personas()}
    assert personas["viktoria"]["personalityEn"] == ENGLISH["viktoria"]
    assert personas["viktoria"]["personality"] == "Meu texto em português, personalizado."
    assert personas["barbara"]["personalityEn"] == "My own English text."  # já existia: fica


def test_voz_em_ingles_sem_cenario_que_vira_piada_e_com_fatos_fixos():
    from server.core.persona_voice import ENGLISH

    viktoria = ENGLISH["viktoria"]
    assert "FIXED FACTS" in viktoria and "The Hour of the Star" in viktoria and "she's 3" in viktoria
    assert "city lights" not in viktoria and "candle" not in viktoria
    for text in ENGLISH.values():
        assert "never copy these" in text and "NEVER:" in text
