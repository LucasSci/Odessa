import copy

from server.core.config_manager import load_persona_config, save_persona_config
from server.services.automation.trigger_synthesis import synthesize_trigger_condition
from server.services.workflow_service import workflow_service


def _snapshot_config():
    # load_persona_config() devolve o dict em cache DIRETO (nao uma copia) --
    # register_generated_video muta esse mesmo objeto, entao sem deepcopy o
    # "backup" seria mutado junto e o restore no finally viraria um no-op.
    return copy.deepcopy(load_persona_config())


def test_synthesize_gift_condition_from_buffer():
    interactions = [
        {"kind": "chat", "user": "Lucas", "text": "que linda", "giftName": None, "timestamp": None},
        {"kind": "gift", "user": "Lucas", "text": "Rosa", "giftName": "Rosa", "timestamp": None},
        {"kind": "gift", "user": "Ana", "text": "Rosa", "giftName": "Rosa", "timestamp": None},
    ]

    condition = synthesize_trigger_condition("GATILHO", interactions)

    assert condition == {
        "eventType": "gift",
        "conditions": {"giftKey": "gift.rosa"},
        "label": "Rosa",
    }


def test_synthesize_keyword_condition_when_no_gift_in_buffer():
    interactions = [
        {"kind": "chat", "user": "Lucas", "text": "adoro esse beijinho", "giftName": None, "timestamp": None},
        {"kind": "chat", "user": "Ana", "text": "manda beijinho tambem", "giftName": None, "timestamp": None},
        {"kind": "chat", "user": "Rui", "text": "quero um beijinho", "giftName": None, "timestamp": None},
    ]

    condition = synthesize_trigger_condition("FLUXO", interactions)

    assert condition is not None
    assert condition["eventType"] == "comment"
    assert condition["conditions"]["keyword"] == "beijinho"


def test_synthesize_returns_none_for_empty_buffer():
    assert synthesize_trigger_condition("FLUXO", []) is None
    assert synthesize_trigger_condition("FLUXO", None) is None


def test_synthesize_returns_none_when_only_stopwords():
    interactions = [{"kind": "chat", "user": "Lucas", "text": "oi tudo bem", "giftName": None, "timestamp": None}]
    assert synthesize_trigger_condition("FLUXO", interactions) is None


def test_register_generated_video_creates_real_trigger():
    original_config = _snapshot_config()
    try:
        interactions = [
            {"kind": "gift", "user": "Lucas", "text": "Diamante", "giftName": "Diamante", "timestamp": None},
        ]
        result = workflow_service.register_generated_video(
            video_id="gen-test-trigger-1",
            video_path="server/runtime/video-gen/does-not-need-to-exist.mp4",
            prompt="Reação animada",
            persona_id="odessa",
            video_type="GATILHO",
            interactions=interactions,
        )

        assert result["ok"] is True
        assert result["triggerId"], "esperava um triggerId nao vazio"

        config = load_persona_config()
        connection = next(
            c for c in config["flowConnections"] if c.get("toVideoId") == "gen-test-trigger-1"
        )
        assert connection["triggerId"] == result["triggerId"]

        trigger = next(t for t in config["triggers"] if t["id"] == result["triggerId"])
        assert trigger["eventType"] == "gift"
        assert trigger["conditions"]["giftKey"] == "gift.diamante"
        assert trigger["generated"] is True
        assert trigger["actions"][0]["videoId"] == "gen-test-trigger-1"
    finally:
        save_persona_config(original_config)


def test_register_generated_video_dedupes_against_existing_gift_trigger():
    original_config = _snapshot_config()
    try:
        # Nome de presente inventado, sem gatilho pre-existente nos fixtures
        # (diferente de "Rosa", que ja tem um gatilho humano configurado).
        interactions = [
            {"kind": "gift", "user": "Lucas", "text": "Foguetinho", "giftName": "Foguetinho", "timestamp": None}
        ]

        # Primeiro vídeo cria o gatilho pra "Foguetinho".
        first = workflow_service.register_generated_video(
            video_id="gen-test-dedupe-1",
            video_path="server/runtime/video-gen/does-not-need-to-exist.mp4",
            prompt="Reação",
            persona_id="odessa",
            video_type="GATILHO",
            interactions=interactions,
        )
        assert first["triggerId"]

        # Segundo vídeo, mesmo presente: nao deve empilhar outro gatilho pra
        # "Foguetinho" -- o dedupe deve pegar o que o primeiro register criou.
        second = workflow_service.register_generated_video(
            video_id="gen-test-dedupe-2",
            video_path="server/runtime/video-gen/does-not-need-to-exist.mp4",
            prompt="Reação 2",
            persona_id="odessa",
            video_type="GATILHO",
            interactions=interactions,
        )
        assert second["triggerId"] == ""
    finally:
        save_persona_config(original_config)


def test_register_generated_video_respects_max_generated_triggers_cap(monkeypatch):
    original_config = _snapshot_config()
    try:
        monkeypatch.setattr(
            "server.services.workflow_service.MAX_GENERATED_TRIGGERS", 0
        )
        interactions = [{"kind": "gift", "user": "Lucas", "text": "Coroa", "giftName": "Coroa", "timestamp": None}]

        result = workflow_service.register_generated_video(
            video_id="gen-test-cap-1",
            video_path="server/runtime/video-gen/does-not-need-to-exist.mp4",
            prompt="Reação",
            persona_id="odessa",
            video_type="GATILHO",
            interactions=interactions,
        )

        assert result["ok"] is True
        assert result["triggerId"] == ""
    finally:
        save_persona_config(original_config)
