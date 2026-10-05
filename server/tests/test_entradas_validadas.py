"""Entradas que viram caminho no disco ou endereço de rede são validadas."""
import json
import time

import pytest

from server.core import thumbnails
from server.services import idle_studio, local_engine
from server.services.ai_service import OLLAMA_BASE_URL, _lean_for_engine, _safe_local_url, _strip_recent_lines


def test_nome_de_modelo_nao_sai_da_pasta_de_modelos(tmp_path):
    for name in ["../../segredo", "a/../../b", "..", "modelo:../x", "c:\\windows"]:
        assert local_engine.resolve_model(name, tmp_path) is None


def test_hash_do_arquivo_do_modelo_precisa_ser_sha256(tmp_path):
    manifest = tmp_path / "manifests" / "registry.ollama.ai" / "library" / "qwen" / "latest"
    manifest.parent.mkdir(parents=True)
    layer = {"mediaType": "application/vnd.ollama.image.model", "digest": "../../fora"}
    manifest.write_text(json.dumps({"layers": [layer]}), encoding="utf-8")
    assert local_engine.resolve_model("qwen", tmp_path) is None

    digest = "sha256:" + "a" * 64
    layer["digest"] = digest
    manifest.write_text(json.dumps({"layers": [layer]}), encoding="utf-8")
    blob = tmp_path / "blobs" / digest.replace(":", "-")
    blob.parent.mkdir()
    blob.write_bytes(b"gguf")
    assert local_engine.resolve_model("qwen", tmp_path) == blob


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("http://localhost:11434", "http://127.0.0.1:11434"),
        ("http://127.0.0.1:11434/", "http://127.0.0.1:11434"),
        ("http://192.168.0.20:11434", "http://192.168.0.20:11434"),
        ("https://10.0.0.5", "https://10.0.0.5:443"),
    ],
)
def test_url_da_ia_local_aceita_esta_maquina_e_a_rede_interna(raw, expected):
    assert _safe_local_url(raw) == expected


@pytest.mark.parametrize("raw", ["http://exemplo.com:11434", "http://8.8.8.8", "file:///c:/x", "gopher://127.0.0.1", "lixo"])
def test_url_da_ia_local_fora_da_rede_interna_volta_ao_padrao(raw):
    assert _safe_local_url(raw) == OLLAMA_BASE_URL.rstrip("/")


def test_bloco_das_ultimas_falas_sai_do_prompt_do_motor():
    text = "Persona\n\n[YOUR LAST LINES ON THIS LIVE] don't repeat\n- hi there\n- cute cat\nNow: Monday"
    assert _strip_recent_lines(text) == "Persona\n\nNow: Monday"
    lean = _lean_for_engine([{"role": "system", "content": text}, {"role": "user", "content": "oi"}])
    assert "cute cat" not in lean[0]["content"]


def test_texto_enorme_de_quebras_de_linha_nao_trava():
    text = "\n" * 200_000 + "[SUAS ÚLTIMAS FALAS NA LIVE]" * 2000
    start = time.perf_counter()
    _strip_recent_lines(text)
    assert time.perf_counter() - start < 1.0


def test_miniatura_so_de_arquivo_dentro_da_pasta(tmp_path):
    from PIL import Image

    root = tmp_path / "permitida"
    root.mkdir()
    inside = root / "foto.png"
    outside = tmp_path / "fora.png"
    for path in (inside, outside):
        Image.new("RGB", (800, 400), (200, 10, 10)).save(path)
    small = thumbnails.thumbnail(inside, 320, root)
    assert Image.open(small).width == 320
    with pytest.raises(ValueError):
        thumbnails.thumbnail(outside, 320, root)
    with pytest.raises(ValueError):
        thumbnails.thumbnail(root / ".." / "fora.png", 320, root)


@pytest.mark.parametrize("persona_id", ["..", "../x", "a/b", "", "x" * 65])
def test_id_de_persona_do_estudio_nao_vira_pasta_qualquer(persona_id):
    with pytest.raises(idle_studio.StudioError):
        idle_studio.asset_root(persona_id)


def test_anexo_do_estudio_fica_dentro_da_pasta():
    path = idle_studio.asset_path("viktoria", {"file": "../../segredo.txt"})
    assert path.name == "segredo.txt"
    assert path.parent == idle_studio.asset_root("viktoria").resolve()
