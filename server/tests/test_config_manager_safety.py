import json

import pytest

from server.core import atomic_json as aj
from server.core import config_manager as cm


@pytest.fixture
def persona_path(tmp_path, monkeypatch):
    path = tmp_path / "persona_teste.json"
    monkeypatch.setattr(cm, "get_persona_config_path", lambda persona_id=None: path)
    monkeypatch.setattr(cm, "DEFAULT_CONFIG_PATH", tmp_path / "persona_config.json")
    monkeypatch.setattr(cm, "_cached_config", None)
    monkeypatch.setattr(cm, "_cached_mtime", 0)
    monkeypatch.setattr(cm, "_cached_path", None)
    aj.clear_recovery_events()
    yield path
    aj.clear_recovery_events()


def _config_com_videos(n=3):
    config = cm._empty_config()
    config["videos"] = [{"id": f"v{i}", "label": f"Vídeo {i}"} for i in range(n)]
    config["triggers"] = [{"id": "t1", "eventType": "comment", "enabled": True}]
    return config


def test_salvar_e_carregar_preserva_tudo(persona_path):
    assert cm.save_persona_config(_config_com_videos())
    loaded = cm.load_persona_config()
    assert [v["id"] for v in loaded["videos"]] == ["v0", "v1", "v2"]
    assert loaded["triggers"][0]["id"] == "t1"


def test_salvar_e_atomico_e_guarda_a_versao_anterior(persona_path):
    cm.save_persona_config(_config_com_videos(1))
    cm.save_persona_config(_config_com_videos(3))
    bak = json.loads(aj.backup_path(persona_path).read_text(encoding="utf-8"))
    assert len(bak["videos"]) == 1
    assert [p.name for p in persona_path.parent.iterdir() if p.name.endswith(".tmp")] == []


def test_config_corrompida_com_backup_e_restaurada_sem_perder_gatilhos(persona_path):
    cm.save_persona_config(_config_com_videos(3))
    cm.save_persona_config(_config_com_videos(4))
    persona_path.write_text('{"videos": [{"id": "v0"', encoding="utf-8")  # truncado
    cm._cached_config = None  # simula um reinício do backend

    loaded = cm.load_persona_config()
    assert len(loaded["videos"]) == 3  # voltou do .bak
    assert loaded["triggers"], "os gatilhos não podem sumir"
    assert list(persona_path.parent.glob("persona_teste.json.corrupt-*")), "o arquivo ruim fica guardado"


def test_config_corrompida_sem_backup_vira_vazia_mas_o_original_e_preservado(persona_path):
    persona_path.write_text('{"videos": [{"id": "importante"', encoding="utf-8")
    loaded = cm.load_persona_config()
    assert loaded["videos"] == []
    ruins = list(persona_path.parent.glob("persona_teste.json.corrupt-*"))
    assert len(ruins) == 1 and "importante" in ruins[0].read_text(encoding="utf-8")
    # Um salvamento posterior não destrói o original: ele já está em quarentena.
    cm.save_persona_config(loaded)
    assert "importante" in ruins[0].read_text(encoding="utf-8")


def test_cada_leitura_devolve_uma_copia_independente(persona_path):
    cm.save_persona_config(_config_com_videos(2))
    first = cm.load_persona_config()
    first["videos"].append({"id": "nao-salvo"})
    first["triggers"].clear()
    second = cm.load_persona_config()
    assert [v["id"] for v in second["videos"]] == ["v0", "v1"]
    assert second["triggers"], "alterar o retorno não pode contaminar o cache"


def test_bom_de_editor_windows_nao_vira_corrupcao(persona_path):
    persona_path.write_bytes(b"\xef\xbb\xbf" + json.dumps(_config_com_videos(2)).encode("utf-8"))
    loaded = cm.load_persona_config()
    assert len(loaded["videos"]) == 2
    assert not list(persona_path.parent.glob("*.corrupt-*"))
