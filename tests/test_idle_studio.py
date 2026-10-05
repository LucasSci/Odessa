"""Estúdio da IDLE: anexos com nome automático, ciclo natural e montagem do fluxo."""
import json

import pytest

from server.core import config_manager, persona_manager, video_files
from server.services import idle_studio
from server.services.workflow_service import workflow_service

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 32
MP4 = b"\x00\x00\x00\x18ftypmp42" + b"0" * 32


def clip(number, file, category, start, end, event="", lote=1):
    return {
        "file": file, "number": number, "category": category, "start": start, "end": end, "event": event,
        "lote": lote, "categoryLabel": category.title(), "duration": "4 s", "pingpong": False,
        "firstFrame": f"{start}_camera.png", "lastFrame": f"{end}_camera.png", "prompt": f"prompt {file}",
    }


PLAN = [{
    "id": "viktoria", "name": "Viktoria", "ficha": {"IDENTITY": "x"}, "negative": "blur",
    "images": [
        {"step": "1", "file": "A0_camera.png", "ratio": "9:16", "inputs": "foto de rosto", "why": "", "prompt": "img A0"},
        {"step": "2", "file": "A1_camera.png", "ratio": "9:16", "inputs": "A0_camera.png", "why": "", "prompt": "img A1"},
    ],
    "videos": [
        clip(40, "40_FLUXO_A0_respira", "FLUXO", "A0", "A0", lote=0),
        clip(41, "41_FLUXO_A0_olha", "FLUXO", "A0", "A0"),
        clip(52, "52_TRANSICAO_A0_A1", "TRANSICAO", "A0", "A1"),
        clip(53, "53_TRANSICAO_A1_A0", "TRANSICAO", "A1", "A0"),
        clip(58, "58_FLUXO_A1_le", "FLUXO", "A1", "A1"),
        clip(54, "54_TRANSICAO_A0_A2", "TRANSICAO", "A0", "A2"),
        clip(74, "74_GATILHO_A0_beijo", "GATILHO", "A0", "A0", event="presente pequeno"),
        clip(79, "79_GATILHO_A0_piscadinha", "GATILHO", "A0", "A0", event="presente pequeno"),
        clip(73, "73_GATILHO_A0_aceno", "GATILHO", "A0", "A0", event="follow"),
        clip(95, "95_SEGMENTO_A0_abertura", "SEGMENTO", "A0", "A0", event="F1"),
    ],
}]


@pytest.fixture
def studio(tmp_path, monkeypatch):
    plan_path = tmp_path / "idle_plan.json"
    plan_path.write_text(json.dumps(PLAN), encoding="utf-8")
    monkeypatch.setattr(idle_studio, "PLAN_PATH", plan_path)
    monkeypatch.setattr(idle_studio, "_dir", lambda pid: tmp_path / "idle_studio" / pid)
    idle_studio._plan_cache.clear()
    return tmp_path


def upload(client, key, data=PNG, name="gerada.png", ctype="image/png"):
    res = client.post(f"/api/v1/idle-studio/viktoria/items/{key}/assets", files={"file": (name, data, ctype)})
    assert res.status_code == 200, res.text
    return res.json()


def test_anexo_ganha_o_nome_da_etapa_e_variacoes_v2(client, studio):
    first = upload(client, "A0_camera.png", name="Woman_2K_0001.png")
    assert first["status"] == "gerado"
    assert first["assets"][0]["name"] == "A0_camera.png"
    assert first["assets"][0]["originalName"] == "Woman_2K_0001.png"

    second = upload(client, "A0_camera.png", data=b"\xff\xd8\xff" + b"0" * 20, name="outra.jpg", ctype="image/jpeg")
    assert [a["name"] for a in second["assets"]] == ["A0_camera.png", "A0_camera_v2.jpg"]

    other_id = second["assets"][1]["id"]
    chosen = client.patch("/api/v1/idle-studio/viktoria/items/A0_camera.png", json={"chosen": other_id}).json()
    assert [a["name"] for a in chosen["assets"]] == ["A0_camera_v2.png", "A0_camera.jpg"]

    res = client.get(f"/api/v1/idle-studio/viktoria/assets/{other_id}?download=true")
    assert res.status_code == 200
    assert "attachment" in res.headers["content-disposition"]
    assert "A0_camera.jpg" in res.headers["content-disposition"]


def test_formato_errado_e_aprovar_sem_anexo_sao_recusados(client, studio):
    res = client.post(
        "/api/v1/idle-studio/viktoria/items/A0_camera.png/assets",
        files={"file": ("x.mp4", MP4, "video/mp4")},
    )
    assert res.status_code == 400
    res = client.patch("/api/v1/idle-studio/viktoria/items/A1_camera.png", json={"status": "aprovado"})
    assert res.status_code == 400
    assert client.get("/api/v1/idle-studio/viktoria/assets/../../etc").status_code == 404


def test_remover_o_escolhido_promove_o_proximo(client, studio):
    upload(client, "A0_camera.png")
    two = upload(client, "A0_camera.png")
    first_id, second_id = (a["id"] for a in two["assets"])
    after = client.delete(f"/api/v1/idle-studio/viktoria/items/A0_camera.png/assets/{first_id}").json()
    assert after["chosen"] == second_id
    assert after["assets"][0]["name"] == "A0_camera.png"
    empty = client.delete(f"/api/v1/idle-studio/viktoria/items/A0_camera.png/assets/{second_id}").json()
    assert empty["status"] == "pendente"


def test_ciclo_natural_so_sai_de_a0_se_houver_volta():
    clips = [c for c in PLAN[0]["videos"] if c["category"] in idle_studio.LOOP_CATEGORIES]
    order, out = idle_studio.natural_cycle(clips, "40_FLUXO_A0_respira")
    assert order == ["41_FLUXO_A0_olha", "52_TRANSICAO_A0_A1", "58_FLUXO_A1_le", "53_TRANSICAO_A1_A0"]
    # A2 não tem clipe de volta: fica fora do ciclo em vez de terminar fora da pose.
    assert out == ["54_TRANSICAO_A0_A2"]


def test_montar_fluxo_cria_idle_ciclo_e_gatilhos(client, studio, monkeypatch):
    for video in PLAN[0]["videos"]:
        upload(client, video["file"], data=MP4, name="v.mp4", ctype="video/mp4")
        client.patch(f"/api/v1/idle-studio/viktoria/items/{video['file']}", json={"status": "aprovado"})

    config = {"videos": [{"id": "antigo", "label": "Antigo"}]}
    drafts = []
    monkeypatch.setattr(persona_manager, "get_active_persona_id", lambda: "viktoria")
    monkeypatch.setattr(video_files, "get_video_directory", lambda: studio / "videos")
    monkeypatch.setattr(config_manager, "load_persona_config", lambda: json.loads(json.dumps(config)))
    monkeypatch.setattr(config_manager, "save_persona_config", lambda c: config.update(c) or True)
    monkeypatch.setattr(
        workflow_service, "get_versioned_workflow",
        lambda source="draft": {"flowNodes": [{"nodeId": "meu-no", "videoId": "antigo"}], "flowConnections": [], "triggers": []},
    )
    monkeypatch.setattr(workflow_service, "save_draft", lambda payload: drafts.append(payload) or {})

    res = client.post("/api/v1/idle-studio/viktoria/flow", json={})
    assert res.status_code == 200, res.text
    summary = res.json()
    assert summary["idleVideoId"] == "viktoria_40_FLUXO_A0_respira"
    assert summary["outOfCycle"] == ["54_TRANSICAO_A0_A2"]
    assert (studio / "videos" / "viktoria_74_GATILHO_A0_beijo.mp4").exists()
    assert {v["id"] for v in config["videos"]} >= {"antigo", "viktoria_40_FLUXO_A0_respira"}

    draft = drafts[-1]
    assert draft["idleVideoId"] == "viktoria_40_FLUXO_A0_respira"
    assert any(n["nodeId"] == "meu-no" for n in draft["flowNodes"]), "nós do usuário são mantidos"
    natural = [c for c in draft["flowConnections"] if not c["triggerId"]]
    assert [(c["fromVideoId"][9:], c["toVideoId"][9:]) for c in natural][-1] == ("53_TRANSICAO_A1_A0", "40_FLUXO_A0_respira")
    triggers = {t["actions"][0]["videoId"][9:]: t for t in draft["triggers"]}
    assert triggers["74_GATILHO_A0_beijo"]["eventType"] == "gift" and triggers["74_GATILHO_A0_beijo"]["enabled"]
    assert not triggers["79_GATILHO_A0_piscadinha"]["enabled"], "mesmo evento vira alternativa desligada"
    assert triggers["73_GATILHO_A0_aceno"]["eventType"] == "alert"
    assert triggers["95_SEGMENTO_A0_abertura"]["eventType"] == "manual"

    # Montar de novo substitui o que o Estúdio criou, sem duplicar.
    monkeypatch.setattr(workflow_service, "get_versioned_workflow", lambda source="draft": drafts[-1])
    client.post("/api/v1/idle-studio/viktoria/flow", json={})
    assert len(drafts[-1]["flowNodes"]) == len(draft["flowNodes"])


def test_montar_fluxo_exige_persona_ativa(client, studio, monkeypatch):
    monkeypatch.setattr(persona_manager, "get_active_persona_id", lambda: "barbara")
    res = client.post("/api/v1/idle-studio/viktoria/flow", json={})
    assert res.status_code == 409
    assert "Ative a persona" in res.json()["detail"]


def test_gerar_sem_provedor_explica_o_que_falta(client, studio, monkeypatch):
    monkeypatch.setattr(idle_studio, "providers_status", lambda: {"image": {"name": "gemini", "ready": False}, "video": {"name": "placeholder", "ready": False}})
    res = client.post("/api/v1/idle-studio/viktoria/items/A0_camera.png/generate")
    assert res.status_code == 409
    assert "provedor" in res.json()["detail"]
