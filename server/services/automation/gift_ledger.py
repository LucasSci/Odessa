import logging
import json
from typing import Dict, Any, List
from datetime import datetime
from pathlib import Path

logger = logging.getLogger("odessa.automation.ledger")

class GiftLedger:
    """
    Maintains the state of all gifts received during the session.
    """
    def __init__(self):
        self.session_id = f"session_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        self.started_at = datetime.now().isoformat()

        self.total_gift_events = 0
        self.total_gift_quantity = 0
        self.total_by_gift_name: Dict[str, int] = {}
        self.total_by_sender: Dict[str, Dict[str, Any]] = {}
        self.total_by_receiver: Dict[str, Dict[str, Any]] = {}
        self.recent_gifts: List[Dict[str, Any]] = []

        logger.info(f"GiftLedger initialized for session {self.session_id}")

    def record_gift(self, event: Dict[str, Any]) -> Dict[str, Any]:
        """
        Updates the ledger with a new (possibly aggregated) gift event.
        Returns a summary of the update.
        """
        sender = event.get("sender", "Unknown")
        gift_name = event.get("giftName", "Unknown")
        receiver = event.get("receiver", "Odessa")
        quantity = event.get("quantity", 1)

        # 1. Global totals
        self.total_gift_events += event.get("originalEventCount", 1)
        self.total_gift_quantity += quantity
        self.total_by_gift_name[gift_name] = self.total_by_gift_name.get(gift_name, 0) + quantity

        # 2. Sender totals
        if sender not in self.total_by_sender:
            self.total_by_sender[sender] = {
                "totalGiftEvents": 0,
                "totalGiftQuantity": 0,
                "gifts": {},
                "firstGiftAt": datetime.now().isoformat(),
                "lastGiftAt": None
            }

        s_data = self.total_by_sender[sender]
        s_data["totalGiftEvents"] += event.get("originalEventCount", 1)
        s_data["totalGiftQuantity"] += quantity
        s_data["gifts"][gift_name] = s_data["gifts"].get(gift_name, 0) + quantity
        s_data["lastGiftAt"] = datetime.now().isoformat()

        # 3. Receiver totals
        if receiver not in self.total_by_receiver:
            self.total_by_receiver[receiver] = {
                "totalGiftEvents": 0,
                "totalGiftQuantity": 0,
                "gifts": {}
            }

        r_data = self.total_by_receiver[receiver]
        r_data["totalGiftEvents"] += event.get("originalEventCount", 1)
        r_data["totalGiftQuantity"] += quantity
        r_data["gifts"][gift_name] = r_data["gifts"].get(gift_name, 0) + quantity

        # 4. Recent gifts (keep last 50)
        self.recent_gifts.insert(0, event)
        self.recent_gifts = self.recent_gifts[:50]

        logger.info(f"[LEDGER] Recorded {quantity}x {gift_name} from {sender}. Session Total: {self.total_gift_quantity}")

        return {
            "type": "gift.received",
            "sender": sender,
            "receiver": receiver,
            "giftName": gift_name,
            "quantity": quantity,
            "senderSessionTotal": s_data["totalGiftQuantity"],
            "giftSessionTotal": self.total_by_gift_name[gift_name],
            "receiverSessionTotal": r_data["totalGiftQuantity"],
            "aggregated": event.get("aggregated", False)
        }

    def get_summary(self) -> Dict[str, Any]:
        return {
            "sessionId": self.session_id,
            "startedAt": self.started_at,
            "totalGiftEvents": self.total_gift_events,
            "totalGiftQuantity": self.total_gift_quantity,
            "totalByGiftName": self.total_by_gift_name,
            "totalBySender": self.total_by_sender,
            "totalByReceiver": self.total_by_receiver,
            "recentGifts": self.recent_gifts
        }

    def export_json(self, path: Path):
        try:
            with open(path, "w", encoding="utf-8") as f:
                json.dump(self.get_summary(), f, indent=2, ensure_ascii=False)
            logger.info(f"GiftLedger exported to {path}")
        except Exception as exc:
            logger.error(f"Failed to export GiftLedger: {exc}")

# Singleton instance
gift_ledger = GiftLedger()
