"""Formato Academia: plano coerente, nada explícito e fluxo montado na persona dona."""
import importlib.util
import json
from pathlib import Path

import pytest

from server.core import config_manager, persona_manager, video_files
from server.services import idle_studio
from server.services.workflow_service import workflow_service

ROOT = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location("build_idle_prompts", ROOT / "scripts" / "build_idle_prompts.py")
gerador = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gerador)

FORMATO = gerador.plan_formats()["viktoria-academia"]


@pytest.fixture(scope="module")
def plano():
    return gerador.build_persona("viktoria-academia", gerador.parse_clips(FORMATO["docs"], FORMATO["lote0"]), FORMATO)


def test_plano_da_academia_e_da_viktoria_e_tem_os_clipes_da_lista(plano):
    assert plano["personaId"] == "viktoria"
    assert plano["format"] == "academia"
    assert len(plano["videos"]) == 38
    assert {v["lote"] for v in plano["videos"]} == {0, 1, 2}
    assert sorted(v["number"] for v in plano["videos"] if v["lote"] == 0) == [1, 6, 11, 12, 24]


def test_toda_ancora_de_video_e_uma_etapa_de_imagem(plano):
    imagens = {i["file"] for i in plano["images"]}
    for video in plano["videos"]:
        assert video["firstFrame"] in imagens and video["lastFrame"] in imagens, video["file"]
        assert video["start"] in {"A0", "A1", "A2", "A3"} and video["end"] in {"A0", "A1", "A2", "A3"}


def test_entradas_de_cada_imagem_vem_de_etapas_anteriores(plano):
    vistos = {idle_studio.FACE_KEY}
    for imagem in plano["images"]:
        if imagem["inputs"] != "nenhuma":
            for chave in imagem["inputs"].split("+"):
                chave = chave.strip()
                chave = idle_studio.FACE_KEY if chave.startswith("foto de rosto") else chave
                assert chave in vistos, f"{imagem['file']} usa {chave} antes de ela existir"
        vistos.add(imagem["file"])


def test_referencia_de_corpo_e_so_upload(plano):
    ref = next(i for i in plano["images"] if i["file"] == "ref_corpo.png")
    assert ref["prompt"] == ""  # sem prompt: o Estúdio não gera, só recebe o arquivo


@pytest.mark.parametrize("proibido", ["nude", "naked", "nipple", "topless", "see-through", "sheer", "lingerie", "sexy"])
def test_nenhum_prompt_pede_nada_explicito(plano, proibido):
    textos = [i["prompt"] for i in plano["images"]] + [v["prompt"] for v in plano["videos"]]
    assert not any(proibido in texto.lower() for texto in textos)


def test_corpo_e_roupa_estao_em_todos_os_videos(plano):
    for video in plano["videos"]:
        assert "hourglass" in video["prompt"] and "deep cleavage" in video["prompt"], video["file"]


def test_formatos_da_idle_continuam_por_persona():
    planos = gerador.plan_formats()
    assert planos["viktoria"]["kind"] == "idle" and planos["viktoria"]["persona"] == "viktoria"
    assert planos["barbara"]["persona"] == "barbara"


# ── Estúdio: o plano de formato monta na persona dona ─────────────────────

PLANO_ESTUDIO = [{
    "id": "viktoria-academia", "name": "Viktoria — Academia", "personaId": "viktoria", "format": "academia",
    "ficha": {"IDENTITY": "x", "BODY": "y"}, "negative": "blur",
    "images": [{"step": "1", "file": "A0_camera.png", "ratio": "9:16", "inputs": "foto de rosto", "why": "", "prompt": "img"}],
    "videos": [{
        "file": "01_FLUXO_A0_respira", "number": 1, "category": "FLUXO", "start": "A0", "end": "A0", "event": "",
        "lote": 0, "categoryLabel": "Fluxo", "duration": "4 s", "pingpong": False,
        "firstFrame": "A0_camera.png", "lastFrame": "A0_camera.png", "prompt": "respira",
    }],
}]


@pytest.fixture
def estudio(tmp_path, monkeypatch):
    plan_path = tmp_path / "idle_plan.json"
    plan_path.write_text(json.dumps(PLANO_ESTUDIO), encoding="utf-8")
    monkeypatch.setattr(idle_studio, "PLAN_PATH", plan_path)
    monkeypatch.setattr(idle_studio, "_dir", lambda pid: tmp_path / "idle_studio" / pid)
    idle_studio._plan_cache.clear()
    return tmp_path


def _aprova_o_clipe(client):
    mp4 = b"\x00\x00\x00\x18ftypmp42" + b"0" * 32
    res = client.post(
        "/api/v1/idle-studio/viktoria-academia/items/01_FLUXO_A0_respira/assets",
        files={"file": ("v.mp4", mp4, "video/mp4")},
    )
    assert res.status_code == 200, res.text
    client.patch("/api/v1/idle-studio/viktoria-academia/items/01_FLUXO_A0_respira", json={"status": "aprovado"})


def test_plano_de_formato_monta_o_fluxo_na_persona_dona(client, estudio, monkeypatch):
    _aprova_o_clipe(client)
    config = {"videos": []}
    drafts = []
    monkeypatch.setattr(persona_manager, "get_active_persona_id", lambda: "viktoria")
    monkeypatch.setattr(video_files, "get_video_directory", lambda: estudio / "videos")
    monkeypatch.setattr(config_manager, "load_persona_config", lambda: json.loads(json.dumps(config)))
    monkeypatch.setattr(config_manager, "save_persona_config", lambda c: config.update(c) or True)
    monkeypatch.setattr(
        workflow_service, "get_versioned_workflow",
        lambda source="draft": {"flowNodes": [], "flowConnections": [], "triggers": []},
    )
    monkeypatch.setattr(workflow_service, "save_draft", lambda payload: drafts.append(payload) or {})

    res = client.post("/api/v1/idle-studio/viktoria-academia/flow", json={})
    assert res.status_code == 200, res.text
    # Os vídeos levam o id do plano: não colidem com os da IDLE da Viktoria.
    assert res.json()["idleVideoId"] == "viktoria-academia_01_FLUXO_A0_respira"
    assert (estudio / "videos" / "viktoria-academia_01_FLUXO_A0_respira.mp4").exists()


def test_plano_de_formato_pede_a_persona_dona_ativa(client, estudio, monkeypatch):
    monkeypatch.setattr(persona_manager, "get_active_persona_id", lambda: "barbara")
    res = client.post("/api/v1/idle-studio/viktoria-academia/flow", json={})
    assert res.status_code == 409
    assert "Viktoria" in res.json()["detail"]
