import logging
import asyncio
from typing import List, Dict, Any, Optional
from datetime import datetime
from server.config import GIFT_BATCH_WINDOW_MS

logger = logging.getLogger("odessa.automation.aggregator")

class EventAggregator:
    """
    Aggregates events (primarily gifts) within a time window to prevent backlog.
    """
    def __init__(self):
        self.window_ms = GIFT_BATCH_WINDOW_MS
        self.pending_gifts: Dict[str, Dict[str, Any]] = {}
        self._lock = asyncio.Lock()

    async def add_event(self, event: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        Processes an event. If it's a gift, it might be held for aggregation.
        Returns the event immediately if it shouldn't be aggregated, or None if it is being held.
        """
        if event.get("kind") != "gift" or event.get("redeemable") or event.get("kind") == "moderation":
            return event

        sender = event.get("sender")
        gift_name = event.get("giftName")
        receiver = event.get("receiver", "Odessa")

        # Key for aggregation: sender + gift + receiver
        agg_key = f"{sender}|{gift_name}|{receiver}"

        async with self._lock:
            if agg_key in self.pending_gifts:
                pending = self.pending_gifts[agg_key]
                pending["quantity"] += event.get("quantity", 1)
                pending["originalEventCount"] += 1
                pending["sourceEventIds"].append(event.get("id", "unknown"))
                pending["lastUpdate"] = datetime.now().timestamp()
                logger.debug(f"Aggregated gift {gift_name} from {sender}. Total: {pending['quantity']}")
                return None # Held for aggregation
            else:
                # First time seeing this gift in this window
                event["aggregated"] = True
                event["originalEventCount"] = 1
                event["sourceEventIds"] = [event.get("id", "unknown")]
                event["lastUpdate"] = datetime.now().timestamp()
                self.pending_gifts[agg_key] = event

                # Start a task to flush this gift after the window
                asyncio.create_task(self._wait_and_flush(agg_key))
                return None

    async def _wait_and_flush(self, agg_key: str):
        await asyncio.sleep(self.window_ms / 1000.0)
        async with self._lock:
            if agg_key in self.pending_gifts:
                # We could implement a sliding window here, but for now simple flush
                # Check if it was updated very recently
                now = datetime.now().timestamp()
                pending = self.pending_gifts[agg_key]

                # If updated very recently, wait a bit more?
                # (Simple batching: just flush after window)
                event = self.pending_gifts.pop(agg_key)

                # Emit the aggregated event back to the service
                from server.services.automation_service import automation_service
                await automation_service.process_aggregated_event(event)

# Singleton instance
event_aggregator = EventAggregator()
