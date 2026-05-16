import pytest
import asyncio
from datetime import datetime
from server.services.automation.parser import event_parser
from server.services.automation.aggregator import event_aggregator
from server.services.automation.gift_ledger import gift_ledger
from server.services.automation.rule_engine import gift_rule_engine

@pytest.mark.asyncio
async def test_classification_chat_vs_gift():
    # 1. Chat should NOT be classified as gift
    text = "@BrunoTech: Boa! Mandou muito bem nessa partida"
    events = event_parser.parse_text(text)
    assert len(events) == 1
    assert events[0]["kind"] == "chat"
    assert events[0]["user"] == "BrunoTech"
    assert "message" in events[0]

@pytest.mark.asyncio
async def test_gift_classification():
    # 2. Gift with quantity
    text = "Ana enviou Rosa x5"
    events = event_parser.parse_text(text)
    assert len(events) == 1
    assert events[0]["kind"] == "gift"
    assert events[0]["sender"] == "Ana"
    assert events[0]["giftName"] == "Rosa"
    assert events[0]["quantity"] == 5

    # 3. Gift without quantity
    text = "Lucas enviou Rosa"
    events = event_parser.parse_text(text)
    assert len(events) == 1
    assert events[0]["quantity"] == 1

@pytest.mark.asyncio
async def test_gift_aggregation():
    # Mocking automation_service to capture aggregated events
    from server.services.automation_service import automation_service
    aggregated_events = []

    async def mock_process_aggregated(event):
        aggregated_events.append(event)

    automation_service.process_aggregated_event = mock_process_aggregated

    # Send 3 roses from Lucas in rapid succession
    event1 = {"kind": "gift", "sender": "Lucas", "giftName": "Rosa", "quantity": 1, "id": "1"}
    event2 = {"kind": "gift", "sender": "Lucas", "giftName": "Rosa", "quantity": 1, "id": "2"}
    event3 = {"kind": "gift", "sender": "Lucas", "giftName": "Rosa", "quantity": 1, "id": "3"}

    res1 = await event_aggregator.add_event(event1)
    res2 = await event_aggregator.add_event(event2)
    res3 = await event_aggregator.add_event(event3)

    assert res1 is None
    assert res2 is None
    assert res3 is None

    # Wait for flush (GIFT_BATCH_WINDOW_MS is 2500 by default)
    await asyncio.sleep(3.0)

    assert len(aggregated_events) == 1
    assert aggregated_events[0]["quantity"] == 3
    assert aggregated_events[0]["originalEventCount"] == 3

@pytest.mark.asyncio
async def test_ledger_and_rules():
    gift_ledger.total_gift_events = 0
    gift_ledger.total_gift_quantity = 0
    gift_ledger.total_by_gift_name.clear()
    gift_ledger.total_by_sender.clear()
    gift_ledger.total_by_receiver.clear()
    gift_ledger.recent_gifts.clear()
    event = {
        "kind": "gift",
        "sender": "Lucas",
        "giftName": "Rosa",
        "quantity": 5,
        "aggregated": True,
        "originalEventCount": 5
    }

    summary = gift_ledger.record_gift(event)
    assert summary["senderSessionTotal"] == 5

    actions = gift_rule_engine.evaluate(summary)
    # Based on our rules:
    # 1. thank_any_gift (min 1) -> yes
    # 2. thank_roses_batch (min 5) -> yes
    # Total 2 actions
    assert len(actions) == 2
    ids = [a["rule_id"] for a in actions]
    assert "thank_any_gift" in ids
    assert "thank_roses_batch" in ids

@pytest.mark.asyncio
async def test_moderation_filter():
    text = "xXSpamXx: COMPRE SEGUIDORES BARATO www.fake.com"
    events = event_parser.parse_text(text)
    assert len(events) == 1
    assert events[0]["kind"] == "moderation"

@pytest.mark.asyncio
async def test_redeem_scene():
    text = "CamilaBR resgatou Trocar Cena: Gameplay Focus"
    events = event_parser.parse_text(text)
    assert len(events) == 1
    assert events[0]["kind"] == "gift"
    assert events[0]["redeemable"] is True
    assert events[0]["mappedAction"] == "obs.switch_scene"
    assert events[0]["requestedScene"] == "Gameplay Focus"

if __name__ == "__main__":
    asyncio.run(test_classification_chat_vs_gift())
    print("Test Classification OK")
    asyncio.run(test_gift_classification())
    print("Test Gift Classification OK")
    asyncio.run(test_gift_aggregation())
    print("Test Aggregation OK")
    asyncio.run(test_ledger_and_rules())
    print("Test Ledger & Rules OK")
    asyncio.run(test_moderation_filter())
    print("Test Moderation OK")
    asyncio.run(test_redeem_scene())
    print("Test Redeem OK")
