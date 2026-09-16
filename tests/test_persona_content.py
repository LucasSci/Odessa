from fastapi.testclient import TestClient

from server.main import app
from server.services.video_gen.registry import available_providers, get_provider

client = TestClient(app)


def test_content_endpoint_404_for_unknown_persona():
    res = client.get("/api/v1/personas/nao-existe-mesmo/content")
    assert res.status_code == 404


def test_content_endpoint_aggregates_images_and_videos():
    res = client.get("/api/v1/personas/barbara/content")
    assert res.status_code == 200
    data = res.json()

    assert data["total"] == len(data["items"])
    assert set(data["countsByCategory"]) <= {
        "image:faces",
        "image:environments",
        "image:wardrobe",
        "video:generated",
    }
    for item in data["items"]:
        assert item["kind"] in {"image", "video"}
        assert "url" in item
        assert "id" in item


def test_content_endpoint_marks_generated_photo_correctly(monkeypatch):
    from server.core import persona_assets

    asset = persona_assets.save_asset(
        "barbara",
        "faces",
        b"\x89PNG\r\n\x1a\nfake",
        filename="selfgen-test.png",
        label="Autogerada de teste",
        generated=True,
        source="gemini",
        prompt="sorrindo",
    )
    try:
        res = client.get("/api/v1/personas/barbara/content")
        data = res.json()
        item = next(i for i in data["items"] if i["id"] == asset["id"])
        assert item["generated"] is True
        assert item["provider"] == "gemini"
        assert item["prompt"] == "sorrindo"
        assert data["generatedCount"] >= 1
    finally:
        persona_assets.delete_asset("barbara", "faces", asset["id"])


def test_higgsfield_registered_as_video_provider():
    assert "higgsfield" in available_providers()
    provider = get_provider("higgsfield")
    assert provider.name == "higgsfield"


def test_higgsfield_video_provider_missing_frame_fails_gracefully(tmp_path):
    from server.services.video_gen.providers.higgsfield import HiggsfieldVideoProvider

    provider = HiggsfieldVideoProvider()
    result = provider.generate(
        prompt="teste",
        base_image_path=tmp_path / "nao-existe.png",
        output_path=tmp_path / "saida.mp4",
    )
    assert result.ok is False
    assert "não encontrado" in (result.error or "")


def test_higgsfield_video_provider_success_with_mocked_client(tmp_path, monkeypatch):
    from server.services.video_gen.providers.higgsfield import HiggsfieldVideoProvider

    frame = tmp_path / "frame.png"
    frame.write_bytes(b"\x89PNG\r\n\x1a\nfake-frame")

    monkeypatch.setattr(
        "server.services.video_gen.providers.higgsfield.generate_video_from_image",
        lambda image_path, prompt, **kwargs: b"fake-video-bytes",
    )

    provider = HiggsfieldVideoProvider()
    output_path = tmp_path / "gen.mp4"
    result = provider.generate(prompt="dança animada", base_image_path=frame, output_path=output_path)

    assert result.ok is True
    assert result.provider == "higgsfield"
    assert output_path.read_bytes() == b"fake-video-bytes"


def test_higgsfield_service_run_job_propagates_failure_status(monkeypatch):
    from server.services import higgsfield_service

    monkeypatch.setattr(
        higgsfield_service,
        "submit_job",
        lambda endpoint, payload: {"request_id": "r1", "status_url": "http://fake/status/r1"},
    )
    monkeypatch.setattr(
        higgsfield_service,
        "poll_job",
        lambda status_url, **kwargs: {"status": "failed", "error": "nsfw content"},
    )

    try:
        higgsfield_service._run_job("/v1/text2image/soul", {"prompt": "x"})
        assert False, "esperava HiggsfieldError"
    except higgsfield_service.HiggsfieldError as exc:
        assert "failed" in str(exc)
