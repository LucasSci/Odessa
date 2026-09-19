from server.core import atomic_json as aj


def test_health_lista_recuperacoes_de_arquivos_corrompidos(client, tmp_path):
    aj.clear_recovery_events()
    assert client.get("/health").json()["dataRecovery"] == []

    path = tmp_path / "config.json"
    path.write_text("{lixo", encoding="utf-8")
    aj.read_json(path, default={})

    events = client.get("/health").json()["dataRecovery"]
    assert len(events) == 1
    assert events[0]["path"] == "config.json" and events[0]["action"] == "quarantined"
    aj.clear_recovery_events()
