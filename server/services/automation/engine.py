import logging
import re
from typing import List, Dict, Any
from server.core.config_manager import load_persona_config

logger = logging.getLogger("odessa.automation.engine")

class TriggerEngine:
    """
    Core engine that matches normalized events to actions.
    Decides 'WHAT' should happen when an event occurs.
    """
    def __init__(self):
        self._config = load_persona_config()
        self.triggers = self._config.get("triggers", [])

    def refresh_config(self):
        """Reloads triggers from the central config."""
        self._config = load_persona_config()
        self.triggers = self._config.get("triggers", [])
        logger.info(f"TriggerEngine refreshed. Loaded {len(self.triggers)} triggers.")

    def match_event(self, event: Dict[str, Any], triggers: List[Dict[str, Any]] | None = None) -> List[Dict[str, Any]]:
        """
        Matches a LiveEvent against all registered triggers.
        Returns a list of actions to be executed.
        """
        matched_actions = []

        for trigger in triggers if triggers is not None else self.triggers:
            if not trigger.get("enabled", True):
                continue

            if self._is_match(event, trigger):
                logger.info(f"Trigger matched: {trigger.get('name', trigger['id'])}")
                actions = trigger.get("actions", [])
                for action in actions:
                    enriched = action.copy()
                    # Enrich action with trigger context
                    enriched["trigger_id"] = trigger["id"]
                    enriched["trigger_name"] = trigger.get("name", trigger["id"])
                    # Inherit priority from trigger if not specified in action
                    if "priority" not in enriched:
                        enriched["priority"] = trigger.get("priority", 0)
                    if "cooldown_ms" not in enriched:
                        enriched["cooldown_ms"] = trigger.get("cooldown_ms", 3000)
                    matched_actions.append(enriched)

        matched_actions.sort(
            key=lambda action: (
                int(action.get("priority", 0) or 0),
                -int(action.get("cooldown_ms", 0) or 0),
            ),
            reverse=True,
        )
        return matched_actions

    def _is_match(self, event: Dict[str, Any], trigger: Dict[str, Any]) -> bool:
        """Helper to check if an event satisfies trigger conditions."""
        event_type = event.get("type") or event.get("kind")
        trigger_type = trigger.get("eventType")

        if event_type != trigger_type:
            return False

        conditions = trigger.get("conditions", {})

        # Gift specific matching
        if event_type == "gift":
            gift_key = event.get("gift_key")
            target_key = conditions.get("giftKey")
            if target_key and gift_key != target_key:
                return False
            min_quantity = conditions.get("minQuantity")
            if min_quantity is not None and int(event.get("quantity", 0) or 0) < int(min_quantity):
                return False

        # Comment/Keyword matching
        if event_type == "comment":
            message = event.get("message", "").lower()
            keyword = conditions.get("keyword", "").lower()
            if keyword in {"oi", "olá", "ola"}:
                return self._has_greeting(message)
            if keyword and keyword not in message:
                return False

        # Add more conditions (minQuantity, user, etc.) as needed
        return True

    def _has_greeting(self, message: str) -> bool:
        """Match short greeting triggers without firing on arbitrary chat lines."""
        return bool(re.search(r"\b(oi|ola|olá|hello|hi)\b", message, flags=re.IGNORECASE))

# Singleton instance
trigger_engine = TriggerEngine()
