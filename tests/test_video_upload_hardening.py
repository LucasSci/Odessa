import pytest

from server.api.v1.endpoints import video as video_endpoint

MP4 = b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 64
WEBM = b"\x1a\x45\xdf\xa3" + b"\x00" * 64


@pytest.fixture
def isolated(tmp_path, monkeypatch):
    """Pasta de vídeos e config em memória: o teste nunca toca em server/data."""
    monkeypatch.setattr(video_endpoint, "get_video_directory", lambda: tmp_path)
    store = {"config": {"videos": []}}
    monkeypatch.setattr(video_endpoint, "load_persona_config", lambda: store["config"])
    monkeypatch.setattr(video_endpoint, "save_persona_config", lambda cfg: store.update(config=cfg) or True)
    return tmp_path, store


def upload(client, name, content, content_type="video/mp4"):
    return client.post("/api/v1/video/upload", files={"file": (name, content, content_type)})


def test_upload_valido_grava_com_nome_padrao_e_registra(client, isolated):
    tmp_path, store = isolated
    response = upload(client, "Meu Clipe!.mp4", MP4)
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == "MeuClipe"
    assert "path" not in body  # não devolve o caminho absoluto do disco
    assert (tmp_path / "video_MeuClipe.mp4").read_bytes() == MP4
    assert [v["id"] for v in store["config"]["videos"]] == ["MeuClipe"]


def test_upload_webm_valido(client, isolated):
    tmp_path, _ = isolated
    assert upload(client, "a.webm", WEBM, "video/webm").status_code == 200
    assert (tmp_path / "video_a.webm").exists()


@pytest.mark.parametrize("name", ["virus.exe", "pagina.html", "video_x.exe", "sem_extensao", "clip.mov", "clip.mkv"])
def test_extensao_diferente_de_mp4_webm_e_recusada(client, isolated, name):
    tmp_path, _ = isolated
    response = upload(client, name, MP4)
    assert response.status_code == 400
    assert list(tmp_path.iterdir()) == []


@pytest.mark.parametrize("content", [b"<html><script>alert(1)</script></html>", b"MZ\x90\x00" + b"\x00" * 64, b"texto qualquer"])
def test_conteudo_que_nao_e_video_e_recusado_sem_deixar_lixo(client, isolated, content):
    tmp_path, store = isolated
    response = upload(client, "falso.mp4", content)
    assert response.status_code == 400
    assert list(tmp_path.iterdir()) == []
    assert store["config"]["videos"] == []


def test_arquivo_vazio_e_recusado(client, isolated):
    tmp_path, _ = isolated
    assert upload(client, "vazio.mp4", b"").status_code == 400
    assert list(tmp_path.iterdir()) == []


def test_limite_de_tamanho_e_aplicado_durante_a_leitura(client, isolated, monkeypatch):
    tmp_path, _ = isolated
    monkeypatch.setattr(video_endpoint, "VIDEO_UPLOAD_MAX_BYTES", 100)
    monkeypatch.setattr(video_endpoint, "UPLOAD_CHUNK_BYTES", 32)
    assert upload(client, "grande.mp4", MP4 + b"x" * 200).status_code == 413
    assert list(tmp_path.iterdir()) == []


def test_nome_com_travessia_de_diretorio_fica_dentro_da_pasta(client, isolated):
    tmp_path, _ = isolated
    response = upload(client, "..\\..\\fora.mp4", MP4)
    assert response.status_code == 200
    assert not (tmp_path.parent / "fora.mp4").exists()
    assert all(p.parent == tmp_path for p in tmp_path.iterdir())


def test_nome_video_prefixado_mantem_o_padrao_existente(client, isolated):
    tmp_path, _ = isolated
    response = upload(client, "video_cena1.mp4", MP4)
    assert response.status_code == 200 and response.json()["id"] == "cena1"
    assert (tmp_path / "video_cena1.mp4").exists()


def test_reenviar_o_mesmo_video_substitui_o_arquivo(client, isolated):
    tmp_path, store = isolated
    upload(client, "cena.mp4", MP4)
    novo = MP4 + b"conteudo-novo"
    assert upload(client, "cena.mp4", novo).status_code == 200
    assert (tmp_path / "video_cena.mp4").read_bytes() == novo
    assert len(store["config"]["videos"]) == 1  # não duplica o cadastro


def test_falha_interna_nao_vaza_caminho_do_disco(client, isolated, monkeypatch):
    def boom(*a, **k):
        raise OSError("C:\\Users\\privado\\arquivo.mp4 bloqueado")

    monkeypatch.setattr(video_endpoint.os, "replace", boom)
    response = upload(client, "x.mp4", MP4)
    assert response.status_code == 500
    assert "privado" not in response.text and "C:" not in response.text
