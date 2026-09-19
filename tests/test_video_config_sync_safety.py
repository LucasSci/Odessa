import copy

import pytest

from server.api.v1.endpoints import video as video_endpoint


@pytest.fixture
def fake_config(monkeypatch):
    saved = []
    state = {
        "config": {
            "videos": [{"id": "a"}, {"id": "b"}, {"id": "c"}],
            "triggers": [{"id": "t"}],
        }
    }

    # load devolve cópia (como o real); save registra o que seria gravado.
    monkeypatch.setattr(video_endpoint, "load_persona_config", lambda: copy.deepcopy(state["config"]))
    monkeypatch.setattr("server.core.config_manager.save_persona_config", lambda cfg: saved.append(cfg) or True)
    return state, saved


def _disk(monkeypatch, ids):
    monkeypatch.setattr(
        "server.core.video_files.list_available_videos",
        lambda: [{"id": i, "filename": f"video_{i}.mp4"} for i in ids],
    )


def test_pasta_de_videos_indisponivel_nao_apaga_a_biblioteca(client, fake_config, monkeypatch):
    _, saved = fake_config
    _disk(monkeypatch, [])  # OneDrive offline / disco desligado: listagem vazia
    response = client.get("/api/v1/video/config")
    assert response.status_code == 200
    assert [v["id"] for v in response.json()["videos"]] == ["a", "b", "c"]
    assert saved == [], "não pode gravar uma config esvaziada por causa de uma pasta indisponível"


def test_video_removido_do_disco_continua_saindo_da_config_quando_a_pasta_esta_ok(client, fake_config, monkeypatch):
    _, saved = fake_config
    _disk(monkeypatch, ["a", "b"])  # "c" foi apagado de verdade
    response = client.get("/api/v1/video/config")
    assert [v["id"] for v in response.json()["videos"]] == ["a", "b"]
    assert len(saved) == 1 and [v["id"] for v in saved[0]["videos"]] == ["a", "b"]


def test_video_novo_no_disco_e_cadastrado(client, fake_config, monkeypatch):
    _, saved = fake_config
    _disk(monkeypatch, ["a", "b", "c", "d"])
    ids = [v["id"] for v in client.get("/api/v1/video/config").json()["videos"]]
    assert ids == ["a", "b", "c", "d"]
    assert len(saved) == 1


def test_sem_diferencas_nao_grava(client, fake_config, monkeypatch):
    _, saved = fake_config
    _disk(monkeypatch, ["a", "b", "c"])
    client.get("/api/v1/video/config")
    assert saved == []
