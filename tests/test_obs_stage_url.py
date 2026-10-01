"""O overlay do OBS não pode apontar para o servidor de desenvolvimento (3000) no app instalado."""
import json

from server.services import obs_service


def test_endereco_antigo_da_3000_vira_o_do_proprio_backend(tmp_path, monkeypatch):
    settings = tmp_path / "obs_settings.json"
    settings.write_text(json.dumps({"stageUrl": "http://localhost:3000/#overlay"}), encoding="utf-8")
    monkeypatch.setattr(obs_service, "OBS_SETTINGS_FILE", settings)
    service = obs_service.OBSService()
    assert service.stage_url == "http://127.0.0.1:8000/#overlay"


def test_url_escolhida_a_mao_e_mantida(tmp_path, monkeypatch):
    settings = tmp_path / "obs_settings.json"
    settings.write_text(json.dumps({"stageUrl": "http://192.168.0.10:8000/#overlay"}), encoding="utf-8")
    monkeypatch.setattr(obs_service, "OBS_SETTINGS_FILE", settings)
    assert obs_service.OBSService().stage_url == "http://192.168.0.10:8000/#overlay"
