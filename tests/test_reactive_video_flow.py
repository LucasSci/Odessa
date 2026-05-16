import copy

from fastapi.testclient import TestClient

from server.main import app
from server.api.v1.endpoints import automation as automation_routes
from server.core.auth import ADMIN_PASSWORD
from server.core.config_manager import _normalize_config, load_persona_config, save_persona_config
from server.services.automation.parser import event_parser
from server.services.video_service import video_service


client = TestClient(app)
client.post("/auth/login", json={"password": ADMIN_PASSWORD})


def reset_reactive_state():
    automation_routes.automation_service.queue.clear()
    automation_routes.automation_service.queue.last_execution_time.clear()
    automation_routes.automation_service.engine.refresh_config()


def configured_video_for_rose_trigger() -> str:
    config = load_persona_config()
    trigger = next(
        item
        for item in config["triggers"]
        if item.get("eventType") == "gift" and item.get("conditions", {}).get("giftKey") == "gift.rosa"
    )
    return trigger["actions"][0]["videoId"]


def test_parser_normalizes_rose_gift():
    events = event_parser.parse_text("Lucas enviou Rosa")

    assert events
    assert events[0]["kind"] == "gift"
    assert events[0]["type"] == "gift"
    assert events[0]["giftName"] == "Rosa"
    assert events[0]["gift_key"] == "gift.rosa"
    assert events[0]["sender"] == "Lucas"
    assert events[0]["user"] == "Lucas"


def test_parser_uses_gift_zone_hint_for_short_ocr_text():
    events = event_parser.parse_text(
        "Gift Zone: Rosa x5",
        hint_kind="gift",
        zone_name="Gift Zone",
        metadata={"sender": "Lucas"},
    )

    assert events
    assert events[0]["kind"] == "gift"
    assert events[0]["type"] == "gift"
    assert events[0]["giftName"] == "Rosa"
    assert events[0]["gift_key"] == "gift.rosa"
    assert events[0]["quantity"] == 5
    assert events[0]["sender"] == "Lucas"


def test_automation_queues_play_video_for_rose():
    reset_reactive_state()
    expected_video_id = configured_video_for_rose_trigger()

    result = automation_routes.automation_service.process_raw_text("Lucas enviou Rosa")

    assert result["status"] == "processed"
    assert result["matchedTriggers"]
    assert result["queuedActions"]
    assert result["queuedActions"][0]["type"] == "play_video"
    assert result["queuedActions"][0]["videoId"] == expected_video_id


def test_automation_queues_comment_keyword_trigger():
    reset_reactive_state()

    result = automation_routes.automation_service.process_raw_text("@Viewer: oi Odessa")

    assert result["events"][0]["kind"] == "chat"
    assert result["events"][0]["type"] == "comment"
    assert result["matchedTriggers"]
    assert result["queuedActions"]
    assert result["queuedActions"][0]["type"] == "play_video"


def test_chat_with_gift_like_words_does_not_trigger_gift_video():
    reset_reactive_state()

    result = automation_routes.automation_service.process_raw_text(
        "@AnaStarlight: Boa! Mandou muito bem nessa partida"
    )

    assert result["events"][0]["kind"] == "chat"
    assert result["events"][0]["type"] == "comment"
    assert result["events"][0].get("gift_key") is None
    assert result["queuedActions"] == []


def test_plain_chat_with_mandou_bem_does_not_become_gift():
    reset_reactive_state()

    result = automation_routes.automation_service.process_raw_text("Ana mandou muito bem")

    assert result["events"][0]["kind"] == "chat"
    assert result["events"][0]["type"] == "comment"
    assert result["events"][0].get("gift_key") is None
    assert result["queuedActions"] == []


def test_spam_does_not_queue_video():
    reset_reactive_state()

    result = automation_routes.automation_service.process_raw_text(
        "xXSpamXx: COMPRE SEGUIDORES BARATO www.fake.com"
    )

    assert result["events"][0]["kind"] == "moderation"
    assert result["queuedActions"] == []


def test_next_action_updates_video_state_and_idle_can_resume():
    reset_reactive_state()
    expected_video_id = configured_video_for_rose_trigger()

    trigger_response = client.post("/api/v1/automation/test-trigger", params={"text": "Lucas enviou Rosa"})
    assert trigger_response.status_code == 200
    assert trigger_response.json()["queuedActions"]

    queue_response = client.get("/api/v1/automation/queue")
    assert queue_response.status_code == 200
    assert queue_response.json()["queue"]

    response = client.get("/api/v1/automation/next-action")
    assert response.status_code == 200
    payload = response.json()

    assert payload["status"] == "executed"
    assert payload["action"]["type"] == "play_video"
    assert payload["action"]["videoId"] == expected_video_id
    assert payload["videoState"]["state"] == "ACTION"
    assert payload["videoState"]["currentClip"]["videoId"] == expected_video_id
    assert "upcoming" in payload["videoState"]
    assert video_service.get_state()["current_video_id"] == expected_video_id

    idle_response = client.post("/api/v1/video/idle")
    assert idle_response.status_code == 200
    assert idle_response.json()["state"] == "IDLE"


def test_automation_ingest_executes_once_and_drains_queue():
    reset_reactive_state()
    expected_video_id = configured_video_for_rose_trigger()

    response = client.post(
        "/api/v1/automation/ingest",
        json={"text": "Lucas enviou Rosa", "source": "ocr", "zoneName": "Chat", "execute": True},
    )
    assert response.status_code == 200
    payload = response.json()

    assert payload["status"] == "processed"
    assert payload["summary"]["queuedActions"]
    assert len(payload["executions"]) == 1
    assert payload["executions"][0]["action"]["videoId"] == expected_video_id
    assert payload["videoState"]["current_video_id"] == expected_video_id
    assert client.get("/api/v1/automation/queue").json()["queue"] == []

    duplicate = client.post(
        "/api/v1/automation/ingest",
        json={"text": "Lucas enviou Rosa", "source": "ocr", "zoneName": "Chat", "execute": True},
    ).json()
    assert duplicate["summary"]["queuedActions"] == []
    assert duplicate["summary"]["blockedActions"]
    assert duplicate["summary"]["blockedActions"][0]["blockedReason"] == "cooldown"
    assert duplicate["executions"] == []


def test_automation_ingest_uses_zone_kind_hint_for_short_gift_text():
    reset_reactive_state()
    expected_video_id = configured_video_for_rose_trigger()

    response = client.post(
        "/api/v1/automation/ingest",
        json={
            "text": "Presentes: Rosa x5",
            "source": "ocr",
            "zoneName": "Presentes",
            "kind": "gift",
            "metadata": {"sender": "Lucas"},
            "execute": True,
        },
    )

    assert response.status_code == 200
    payload = response.json()

    assert payload["status"] == "processed"
    assert payload["summary"]["events"][0]["kind"] == "gift"
    assert payload["summary"]["events"][0]["gift_key"] == "gift.rosa"
    assert payload["summary"]["events"][0]["quantity"] == 5
    assert payload["summary"]["matchedTriggers"]
    assert payload["executions"][0]["action"]["videoId"] == expected_video_id


def test_video_config_update_refreshes_backend_trigger_engine():
    reset_reactive_state()
    original_config = load_persona_config()
    next_config = copy.deepcopy(original_config)
    video_id = next_config["videos"][0]["id"]
    test_trigger = {
        "id": "pytest-fenix-trigger",
        "name": "Pytest Fenix Trigger",
        "enabled": True,
        "eventType": "gift",
        "conditions": {"giftKey": "gift.fenix.teste"},
        "actions": [{"type": "play_video", "videoId": video_id}],
        "cooldownMs": 0,
    }
    next_config["triggers"] = [
        *[trigger for trigger in next_config.get("triggers", []) if trigger.get("id") != test_trigger["id"]],
        test_trigger,
    ]

    try:
        response = client.post("/api/v1/video/config", json=next_config)
        assert response.status_code == 200
        assert response.json()["status"] == "success"

        result = automation_routes.automation_service.process_raw_text("Lucas enviou Fenix Teste")

        assert result["matchedTriggers"]
        assert result["queuedActions"]
        assert result["queuedActions"][0]["videoId"] == video_id
    finally:
        save_persona_config(original_config)
        video_service.refresh_config()
        reset_reactive_state()


def test_normalize_config_keeps_single_idle_loop():
    config = _normalize_config(
        {
            "videos": [
                {"id": "idle-video", "loop": False},
                {"id": "action-video", "loop": True},
            ],
            "idleVideoId": "idle-video",
            "action_map": {"idle": ["action-video"]},
        }
    )

    assert config["action_map"]["idle"] == ["idle-video"]
    assert config["videos"][0]["loop"] is True
    assert config["videos"][1]["loop"] is False


def test_normalize_config_preserves_canvas_video_ids():
    config = _normalize_config(
        {
            "videos": [
                {"id": "idle-video"},
                {"id": "action-video"},
            ],
            "flowCanvasVideoIds": ["action-video", "missing-video", "action-video"],
        }
    )

    assert config["flowCanvasVideoIds"] == ["action-video"]


def test_normalize_config_migrates_legacy_flow_to_nodes():
    config = _normalize_config(
        {
            "videos": [
                {"id": "idle-video"},
                {"id": "action-video"},
            ],
            "idleVideoId": "idle-video",
            "flowCanvasVideoIds": ["idle-video", "action-video"],
            "flowLayout": {"action-video": {"x": 321, "y": 654}},
            "flowConnections": [
                {
                    "id": "flow-trigger",
                    "fromVideoId": "idle-video",
                    "toVideoId": "action-video",
                    "triggerId": "trigger-1",
                    "returnToIdle": False,
                }
            ],
            "triggers": [
                {
                    "id": "trigger-1",
                    "enabled": True,
                    "eventType": "gift",
                    "conditions": {"giftKey": "gift.rosa"},
                    "actions": [{"type": "play_video", "videoId": "action-video"}],
                }
            ],
        }
    )

    action_node = next(item for item in config["flowNodes"] if item["videoId"] == "action-video")
    assert action_node["nodeId"] == "node-action-video"
    assert action_node["position"] == {"x": 321, "y": 654}
    assert config["flowConnections"][0]["toNodeId"] == "node-action-video"
    assert config["triggers"][0]["actions"][0]["nodeId"] == "node-action-video"
    assert config["triggers"][0]["actions"][0]["returnToIdle"] is False


def test_normalize_config_allows_two_nodes_for_same_video():
    config = _normalize_config(
        {
            "videos": [{"id": "idle-video"}, {"id": "action-video"}],
            "idleVideoId": "idle-video",
            "flowNodes": [
                {"nodeId": "node-a", "videoId": "action-video", "playback": {"startSec": 1, "endSec": 3}},
                {"nodeId": "node-b", "videoId": "action-video", "playback": {"startSec": 5, "endSec": 8}},
            ],
        }
    )

    action_nodes = [item for item in config["flowNodes"] if item["videoId"] == "action-video"]
    assert [item["nodeId"] for item in action_nodes] == ["node-a", "node-b"]
    assert action_nodes[0]["playback"]["startSec"] == 1
    assert action_nodes[1]["playback"]["startSec"] == 5


def test_video_advance_can_follow_natural_connection_without_idle():
    original_config = video_service._config
    try:
        config = _normalize_config(
            {
                "videos": [{"id": "idle-video"}, {"id": "action-video"}, {"id": "alt-video"}],
                "idleVideoId": "idle-video",
                "flowNodes": [
                    {"nodeId": "node-idle", "videoId": "idle-video"},
                    {"nodeId": "node-action", "videoId": "action-video"},
                    {"nodeId": "node-alt", "videoId": "alt-video", "playback": {"startSec": 2}},
                ],
                "flowConnections": [
                    {
                        "id": "flow-natural",
                        "fromNodeId": "node-action",
                        "toNodeId": "node-alt",
                        "triggerId": "trigger-natural",
                        "returnToIdle": False,
                    }
                ],
                "triggers": [
                    {
                        "id": "trigger-natural",
                        "enabled": True,
                        "eventType": "natural",
                        "conditions": {},
                        "actions": [{"type": "play_video", "nodeId": "node-alt", "videoId": "alt-video"}],
                    }
                ],
            }
        )
        video_service._config = config
        result = video_service.handle_video_action(
            {
                "type": "play_video",
                "nodeId": "node-action",
                "videoId": "action-video",
                "returnToIdle": False,
            }
        )
        assert result["videoState"]["upcoming"][0]["nodeId"] == "node-alt"

        advanced = video_service.advance()
        assert advanced["currentClip"]["nodeId"] == "node-alt"
        assert advanced["currentClip"]["startSec"] == 2
    finally:
        video_service._config = original_config
        video_service.return_to_idle()
