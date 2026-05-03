import pytest
from server.main import upsert_round_memory, get_memory_stats

@pytest.mark.unit
def test_upsert_round_memory_and_stats():
    """Test memory upsert and stats together."""
    events = [
        {
            "id": "e1",
            "text": "Ola",
            "kind": "chat",
            "source": "ocr",
            "time": "12:00:00",
            "createdAt": "2026-05-03T12:00:00Z",
            "metadata": {"user": "User1"}
        },
        {
            "id": "e2",
            "text": "Rosa",
            "kind": "gift",
            "source": "ocr",
            "time": "12:01:00",
            "createdAt": "2026-05-03T12:01:00Z",
            "metadata": {"user": "User2", "quantity": 5}
        }
    ]
    
    result = upsert_round_memory(events)
    assert result["usersRecognized"] == 2
    assert len(result["users"]) == 2
    
    stats = get_memory_stats()
    assert stats["usersRecognized"] >= 2
    assert stats["interactions"] >= 2
