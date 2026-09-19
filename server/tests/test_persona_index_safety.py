import json
import threading

import pytest

from server.core import atomic_json as aj
from server.core import persona_manager as pm


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(pm, "DATA_DIR", tmp_path)
    monkeypatch.setattr(pm, "PERSONAS_INDEX_PATH", tmp_path / "personas.json")
    monkeypatch.setattr(pm, "DEFAULT_CONFIG_PATH", tmp_path / "persona_config.json")
    aj.clear_recovery_events()
    return tmp_path


def _ids():
    return [p["id"] for p in pm.list_personas()]


def test_indice_corrompido_com_backup_nao_perde_as_outras_personas(data_dir):
    pm.create_persona({"name": "Barbara"})
    pm.create_persona({"name": "Viktoria"})
    assert _ids() == ["odessa", "barbara", "viktoria"]
    pm.set_active_persona("barbara")  # gera um .bak íntegro

    (data_dir / "personas.json").write_text('{"activePersonaId": "barbara", "perso', encoding="utf-8")
    assert _ids() == ["odessa", "barbara", "viktoria"], "voltar do .bak, não para só a Odessa"
    assert list(data_dir.glob("personas.json.corrupt-*")), "o índice ruim fica guardado"


def test_indice_corrompido_sem_backup_preserva_o_original(data_dir):
    (data_dir / "personas.json").write_text('{"personas": [{"id": "barbara"', encoding="utf-8")
    assert _ids() == ["odessa"]
    ruins = list(data_dir.glob("personas.json.corrupt-*"))
    assert len(ruins) == 1 and "barbara" in ruins[0].read_text(encoding="utf-8")


def test_criar_personas_em_paralelo_nao_perde_nenhuma(data_dir):
    errors = []

    def cria(n):
        try:
            pm.create_persona({"id": f"p{n}", "name": f"P{n}"})
        except Exception as exc:  # pragma: no cover - só para diagnosticar
            errors.append(exc)

    threads = [threading.Thread(target=cria, args=(n,)) for n in range(12)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert errors == []
    assert sorted(_ids()) == sorted(["odessa"] + [f"p{n}" for n in range(12)])
    assert len(list(data_dir.glob("persona_p*.json"))) == 12


def test_nova_persona_ganha_config_vazia_valida(data_dir):
    pm.create_persona({"name": "Ana"})
    config = json.loads((data_dir / "persona_ana.json").read_text(encoding="utf-8"))
    assert config["videos"] == []
    assert [p.name for p in data_dir.iterdir() if p.name.endswith(".tmp")] == []
