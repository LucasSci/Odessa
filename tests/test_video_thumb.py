"""Miniatura JPEG dos clips: gerada uma vez pelo navegador, guardada no servidor.

Antes a tela Ao Vivo abria 166 <video> só para mostrar miniaturas, e a API e
os arquivos das páginas ficavam na fila das conexões.
"""
import asyncio
import logging
import os

import pytest
from fastapi.testclient import TestClient

import server.core.auth as auth_core
import server.main as main
from server.api.v1.endpoints import video as video_endpoint

JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64


@pytest.fixture
def videos(tmp_path, monkeypatch):
    (tmp_path / "video_clip1.mp4").write_bytes(b"\x00\x00\x00\x18ftypmp42")
    monkeypatch.setattr(
        video_endpoint,
        "get_video_path",
        lambda vid: tmp_path / "video_clip1.mp4" if vid == "clip1" else None,
    )
    return tmp_path


def test_sem_miniatura_404_e_depois_de_enviar_serve_o_jpeg(client, videos):
    assert client.get("/api/video/thumb/clip1").status_code == 404
    assert client.post("/api/video/thumb/clip1", content=JPEG, headers={"Content-Type": "image/jpeg"}).json() == {"ok": True}
    got = client.get("/api/video/thumb/clip1")
    assert got.status_code == 200
    assert got.headers["content-type"] == "image/jpeg"
    assert got.content == JPEG
    assert (videos / ".thumbs" / "video_clip1.jpg").exists()


def test_video_trocado_invalida_a_miniatura(client, videos):
    client.post("/api/video/thumb/clip1", content=JPEG)
    thumb = videos / ".thumbs" / "video_clip1.jpg"
    old = thumb.stat().st_mtime - 60
    os.utime(thumb, (old, old))
    assert client.get("/api/video/thumb/clip1").status_code == 404


def test_recusa_o_que_nao_e_jpeg_e_clip_inexistente(client, videos):
    assert client.post("/api/video/thumb/clip1", content=b"<svg/>").status_code == 400
    assert client.post("/api/video/thumb/clip1", content=JPEG + b"\x00" * video_endpoint.THUMB_MAX_BYTES).status_code == 400
    assert client.post("/api/video/thumb/nada", content=JPEG).status_code == 404


def test_miniatura_e_publica_para_img_mas_gravar_exige_sessao(monkeypatch, videos):
    monkeypatch.setattr(auth_core, "AUTH_DISABLED", False)
    monkeypatch.setattr(auth_core, "ADMIN_PASSWORD", "senha-super-secreta")
    with TestClient(main.app) as client:
        assert client.get("/api/v1/video/thumb/clip1").status_code == 404  # não 401
        assert client.post("/api/v1/video/thumb/clip1", content=JPEG).status_code == 401


def _access_record(path, status):
    return logging.LogRecord("uvicorn.access", logging.INFO, "", 0, '%s - "%s %s HTTP/%s" %d', ("127.0.0.1:1", "GET", path, "1.1", status), None)


def test_log_de_acesso_esconde_consultas_de_rotina_mas_nao_erros():
    quiet = main._QuietPollingAccessLog()
    assert quiet.filter(_access_record("/api/v1/video/state", 200)) is False
    assert quiet.filter(_access_record("/api/agent/status", 200)) is False
    assert quiet.filter(_access_record("/api/v1/video/state", 500)) is True
    assert quiet.filter(_access_record("/api/v1/personas", 200)) is True


def test_proxy_encerra_e_recolhe_o_outro_sentido():
    """Uma ponta cai com erro: a outra é cancelada e nada fica sem recolher."""
    finished = {}

    async def falls():
        raise ConnectionResetError("WinError 64")

    async def waits_forever():
        try:
            await asyncio.sleep(3600)
        finally:
            finished["other"] = True

    async def run():
        loop = asyncio.get_running_loop()
        unretrieved = []
        loop.set_exception_handler(lambda _loop, ctx: unretrieved.append(ctx))
        await main._pump_until_first_ends(falls(), waits_forever())
        await asyncio.sleep(0)
        return unretrieved

    assert asyncio.run(run()) == []
    assert finished == {"other": True}


def test_conexao_resetada_nao_vira_erro_no_log():
    seen = []

    class Loop:
        def default_exception_handler(self, ctx):
            seen.append(ctx)

    main._quiet_connection_resets(Loop(), {"exception": ConnectionResetError(10054, "reset")})
    main._quiet_connection_resets(Loop(), {"exception": ValueError("de verdade")})
    assert [type(c["exception"]) for c in seen] == [ValueError]
