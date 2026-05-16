from server.services.webhook_service import WebhookService, _mask_headers


def test_mask_headers_hides_sensitive_values():
    masked = _mask_headers({"Authorization": "Bearer token", "X-Trace": "abc"})

    assert masked["Authorization"] == "***"
    assert masked["X-Trace"] == "abc"


def test_render_body_fills_event_and_action_context():
    service = WebhookService()
    rendered = service.render_body(
        '{"text":"{event.text}","action":"{action.type}","scene":"{action.payload.sceneName}"}',
        {
            "event": {"text": "Lucas enviou Rosa"},
            "action": {"type": "switch_scene", "payload": {"sceneName": "Live Principal"}},
        },
    )

    assert rendered == {
        "text": "Lucas enviou Rosa",
        "action": "switch_scene",
        "scene": "Live Principal",
    }
