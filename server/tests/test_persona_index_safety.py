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
    pm.create_persona({"name": "Ana"})
    assert _ids() == ["viktoria", "barbara", "ana"]
    pm.set_active_persona("barbara")  # gera um .bak íntegro

    (data_dir / "personas.json").write_text('{"activePersonaId": "barbara", "perso', encoding="utf-8")
    assert _ids() == ["viktoria", "barbara", "ana"], "voltar do .bak, não para só a padrão"
    assert list(data_dir.glob("personas.json.corrupt-*")), "o índice ruim fica guardado"


def test_indice_corrompido_sem_backup_preserva_o_original(data_dir):
    (data_dir / "personas.json").write_text('{"personas": [{"id": "barbara"', encoding="utf-8")
    assert _ids() == ["viktoria"]
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
    assert sorted(_ids()) == sorted(["viktoria"] + [f"p{n}" for n in range(12)])
    assert len(list(data_dir.glob("persona_p*.json"))) == 12


def test_nova_persona_ganha_config_vazia_valida(data_dir):
    pm.create_persona({"name": "Ana"})
    config = json.loads((data_dir / "persona_ana.json").read_text(encoding="utf-8"))
    assert config["videos"] == []
    assert [p.name for p in data_dir.iterdir() if p.name.endswith(".tmp")] == []


def _write(path, data):
    path.write_text(json.dumps(data), encoding="utf-8")


def test_persona_odessa_e_unida_a_viktoria_e_removida(data_dir):
    """Odessa é o nome do software: a persona "odessa" tinha o conteúdo da Viktoria."""
    _write(data_dir / "personas.json", {
        "activePersonaId": "odessa",
        "personas": [
            {"id": "odessa", "name": "Odessa", "configPath": "persona_config.json", "avatarUrl": "/a.png"},
            {"id": "viktoria", "name": "Viktoria", "configPath": "persona_viktoria.json", "personality": "Você é a Viktoria…"},
            {"id": "barbara", "name": "Barbara", "configPath": "persona_barbara.json"},
        ],
    })
    _write(data_dir / "persona_config.json", {
        "videos": [{"id": "A"}, {"id": "B"}], "flowNodes": [1, 2, 3], "gift_map": {"rosa": "A"}, "transmissionConfig": None,
    })
    _write(data_dir / "persona_viktoria.json", {
        "videos": [{"id": "B"}, {"id": "V"}], "flowNodes": [9], "transmissionConfig": {"obs": True},
    })

    assert _ids() == ["viktoria", "barbara"]
    assert pm.get_active_persona_id() == "viktoria"
    viktoria = pm.get_persona("viktoria")
    assert viktoria["personality"] == "Você é a Viktoria…"  # identidade dela fica
    assert viktoria["avatarUrl"] == "/a.png"  # herdado, ela não tinha
    merged = json.loads((data_dir / "persona_viktoria.json").read_text(encoding="utf-8"))
    assert [v["id"] for v in merged["videos"]] == ["A", "B", "V"]  # nada se perde
    assert merged["flowNodes"] == [1, 2, 3]  # o fluxo completo (da "odessa") manda
    assert merged["gift_map"] == {"rosa": "A"}
    assert merged["transmissionConfig"] == {"obs": True}  # o que só a Viktoria tinha
    assert list(data_dir.glob("persona_viktoria.antes-unir-odessa-*.json")), "backup antes de unir"
    assert list(data_dir.glob("persona_config.antes-unir-odessa-*.json"))
    assert _ids() == ["viktoria", "barbara"]  # idempotente: não recria a "odessa"


def test_instalacao_so_com_odessa_vira_viktoria(data_dir):
    _write(data_dir / "personas.json", {
        "activePersonaId": "odessa",
        "personas": [{"id": "odessa", "name": "Odessa", "configPath": "persona_config.json", "personality": "Você é a Odessa."}],
    })
    assert _ids() == ["viktoria"]
    assert pm.get_persona("viktoria")["configPath"] == "persona_config.json"
    assert pm.get_persona_personality("viktoria") == "Você é a Viktoria."


def test_nao_exclui_a_unica_persona(data_dir):
    with pytest.raises(ValueError):
        pm.delete_persona("viktoria")
    pm.create_persona({"name": "Barbara"})
    pm.set_active_persona("viktoria")
    assert pm.delete_persona("viktoria") is True
    assert pm.get_active_persona_id() == "barbara"
