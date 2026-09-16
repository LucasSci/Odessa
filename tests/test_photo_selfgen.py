import copy

from fastapi.testclient import TestClient

from server.api.v1.endpoints import persona_photogen
from server.core import persona_assets, persona_manager
from server.main import app

client = TestClient(app)

FAKE_PNG = b"\x89PNG\r\n\x1a\nfake-image-bytes-for-tests"


def _find_persona(index, persona_id):
    return next((p for p in index.get("personas", []) if p.get("id") == persona_id), None)


def _snapshot_index():
    return copy.deepcopy(persona_manager._load_index())


def _cleanup_generated_assets(persona_id: str, before_ids: set[str]):
    """Remove do disco/índice qualquer asset 'faces' criado durante o teste
    que não existia no snapshot anterior."""
    for asset in persona_assets.list_assets(persona_id, "faces"):
        if asset.get("id") not in before_ids:
            persona_assets.delete_asset(persona_id, "faces", asset["id"])


def test_generate_photo_endpoint_responds_queued_and_respects_cooldown(monkeypatch):
    # Não deixa a thread de verdade rodar (sem chamada de rede em teste) --
    # só o contrato do endpoint (resposta imediata + cooldown) é testado aqui.
    monkeypatch.setattr(persona_photogen, "_generate_photo_background", lambda *a, **k: None)
    persona_photogen._last_generation_at.clear()

    first = client.post("/api/v1/personas/odessa/selfconfig/generate-photo", json={"prompt": "sorrindo"})
    assert first.status_code == 200
    body = first.json()
    assert body["ok"] is True
    assert body["status"] == "queued"
    assert body["jobId"]

    # Pedido imediato seguinte: cooldown ainda não passou.
    second = client.post("/api/v1/personas/odessa/selfconfig/generate-photo", json={"prompt": "sorrindo de novo"})
    assert second.status_code == 200
    assert second.json() == {"ok": False, "status": "cooldown"}

    persona_photogen._last_generation_at.clear()


def test_generate_photo_endpoint_respects_max_generated_photos_cap(monkeypatch):
    monkeypatch.setattr(persona_photogen, "_generate_photo_background", lambda *a, **k: None)
    monkeypatch.setattr(persona_photogen, "MAX_GENERATED_PHOTOS", 0)
    persona_photogen._last_generation_at.clear()

    res = client.post("/api/v1/personas/odessa/selfconfig/generate-photo", json={"prompt": "sorrindo"})
    assert res.status_code == 200
    assert res.json() == {"ok": False, "status": "max_reached"}

    persona_photogen._last_generation_at.clear()


def test_generate_photo_endpoint_404_for_unknown_persona(monkeypatch):
    monkeypatch.setattr(persona_photogen, "_generate_photo_background", lambda *a, **k: None)
    res = client.post("/api/v1/personas/nao-existe-mesmo/selfconfig/generate-photo", json={"prompt": "x"})
    assert res.status_code == 404


def test_generate_photo_background_saves_asset_and_updates_avatar(monkeypatch):
    persona_id = "odessa"
    original_index = _snapshot_index()
    before_ids = {a["id"] for a in persona_assets.list_assets(persona_id, "faces")}

    monkeypatch.setattr(
        persona_photogen,
        "_generate_image_bytes",
        lambda pid, prompt: (FAKE_PNG, "gemini"),
    )

    try:
        persona_photogen._generate_photo_background(persona_id, "um sorriso novo", "job-test-1")

        index = persona_manager._load_index()
        persona = _find_persona(index, persona_id)
        assert persona is not None

        faces = (persona.get("assets") or {}).get("faces", [])
        new_faces = [f for f in faces if f["id"] not in before_ids]
        assert len(new_faces) == 1
        assert new_faces[0]["generated"] is True
        assert new_faces[0]["source"] == "gemini"
        assert new_faces[0]["prompt"] == "um sorriso novo"

        assert persona["avatarUrl"] == f"/api/v1/personas/{persona_id}/assets/faces/{new_faces[0]['id']}"

        history = persona.get("selfConfigHistory", [])
        assert history
        assert "autogerada" in history[-1]["applied"][0].lower()
    finally:
        _cleanup_generated_assets(persona_id, before_ids)
        persona_manager._save_index(original_index)


def test_generate_photo_background_records_failure_without_raising(monkeypatch):
    persona_id = "odessa"
    original_index = _snapshot_index()

    def _boom(pid, prompt):
        raise RuntimeError("provedor indisponível")

    monkeypatch.setattr(persona_photogen, "_generate_image_bytes", _boom)

    try:
        # Não deve levantar exceção -- é best-effort, igual reflectOnConversation.
        persona_photogen._generate_photo_background(persona_id, "prompt qualquer", "job-test-2")

        index = persona_manager._load_index()
        persona = _find_persona(index, persona_id)
        history = persona.get("selfConfigHistory", [])
        assert history
        assert "falhou" in history[-1]["applied"][0].lower()
    finally:
        persona_manager._save_index(original_index)
