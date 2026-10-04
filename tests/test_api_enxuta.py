"""Respostas enxutas: o fluxo não viaja três vezes, e o overlay só baixa quando muda.

Medido numa live simulada (docs/PLANO-OTIMIZACAO.md): /video/config,
/personas/active e /workflow/published tinham ~450 KB cada, 2/3 disso o mesmo
fluxo repetido como rascunho e publicado.
"""
import asyncio
import json

import pytest

import server.core.config_manager as cm

FLOW = {"flowNodes": [{"id": "n1", "videoId": "a"}], "flowConnections": [], "triggers": [{"id": "t1"}]}


@pytest.fixture
def persona_file(tmp_path, monkeypatch):
    path = tmp_path / "persona_teste.json"
    config = {
        "videos": [{"id": "a"}],
        "idleVideoId": "a",
        **FLOW,
        "draftWorkflow": {**FLOW, "status": "draft", "version": 3},
        "publishedWorkflow": {**FLOW, "status": "published", "version": 2},
    }
    path.write_text(json.dumps(config), encoding="utf-8")
    monkeypatch.setattr(cm, "get_persona_config_path", lambda persona_id=None: path)
    monkeypatch.setattr(cm, "_cached_json", None)
    monkeypatch.setattr(cm, "_cached_mtime", 0)
    monkeypatch.setattr(cm, "_cached_path", None)
    monkeypatch.setattr("server.core.video_files.list_available_videos", lambda: [{"id": "a", "filename": "video_a.mp4"}])
    return path


def test_respostas_sem_as_copias_internas_do_fluxo(client, persona_file):
    for url, pick in (
        ("/api/v1/video/config", lambda body: body),
        ("/api/v1/personas/active", lambda body: body["config"]),
        ("/api/v1/workflow/published", lambda body: body),
    ):
        body = pick(client.get(url).json())
        assert "draftWorkflow" not in body and "publishedWorkflow" not in body, url
        assert [n["id"] for n in body["flowNodes"]] == ["n1"], url


def test_gravar_o_config_da_tela_nao_apaga_o_fluxo_publicado(client, persona_file):
    from_screen = client.get("/api/v1/video/config").json()
    from_screen["idleVideoId"] = "a"
    assert client.post("/api/v1/video/config", json=from_screen).status_code == 200
    on_disk = json.loads(persona_file.read_text(encoding="utf-8"))
    assert on_disk["publishedWorkflow"]["version"] == 2
    assert on_disk["draftWorkflow"]["version"] == 3


def test_overlay_so_baixa_o_fluxo_quando_ele_muda(client, persona_file):
    first = client.get("/api/v1/workflow/published")
    etag = first.headers["etag"]
    again = client.get("/api/v1/workflow/published", headers={"If-None-Match": etag})
    assert again.status_code == 304 and again.content == b""

    import os
    import time

    later = time.time() + 5
    os.utime(persona_file, (later, later))  # o operador publicou outra versão
    changed = client.get("/api/v1/workflow/published", headers={"If-None-Match": etag})
    assert changed.status_code == 200 and changed.headers["etag"] != etag


def test_copia_do_config_em_memoria_e_independente(persona_file):
    first = cm.load_persona_config()
    first["videos"].append({"id": "alterado"})
    assert [v["id"] for v in cm.load_persona_config()["videos"]] == ["a"]


def test_lista_de_videos_so_varre_a_pasta_quando_ela_muda(tmp_path, monkeypatch):
    from server.core import video_files

    (tmp_path / "video_x.mp4").write_bytes(b"x")
    monkeypatch.setattr(video_files, "get_video_directory", lambda: tmp_path)
    monkeypatch.setattr(video_files, "_list_cache", None)
    scans = []
    real_scan = video_files._scan_videos
    monkeypatch.setattr(video_files, "_scan_videos", lambda d: scans.append(d) or real_scan(d))

    assert [v["id"] for v in video_files.list_available_videos()] == ["x"]
    video_files.list_available_videos()
    assert len(scans) == 1

    (tmp_path / "video_y.mp4").write_bytes(b"y")
    import os
    import time

    later = time.time() + 5
    os.utime(tmp_path, (later, later))
    assert [v["id"] for v in video_files.list_available_videos()] == ["x", "y"]
    assert len(scans) == 2


def test_estado_do_palco_e_empurrado_quando_muda(monkeypatch):
    """O SSE manda o estado na abertura e de novo só quando o palco muda."""
    from server.api.v1.endpoints import video as video_endpoint
    from server.services.video_service import video_service

    monkeypatch.setattr(video_endpoint, "EVENTS_CHECK_S", 0.01)
    monkeypatch.setattr(video_service, "get_state", lambda: {"current_video_id": video_service.current_video_id})
    monkeypatch.setattr(video_service, "current_video_id", "a")

    class FakeRequest:
        checks = 0

        async def is_disconnected(self):
            FakeRequest.checks += 1
            if FakeRequest.checks == 5:
                video_service.current_video_id = "b"
            return FakeRequest.checks > 12

    async def collect():
        response = await video_endpoint.video_state_events(FakeRequest())
        return [chunk async for chunk in response.body_iterator]

    chunks = asyncio.run(collect())
    data = [json.loads(c[len("data: "):]) for c in chunks if c.startswith("data: ")]
    assert [d["current_video_id"] for d in data] == ["a", "b"]
