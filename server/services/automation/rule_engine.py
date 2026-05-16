import logging
from typing import List, Dict, Any, Optional
from datetime import datetime

logger = logging.getLogger("odessa.automation.rules")

class GiftRuleEngine:
    """
    Evaluates rules against received gifts to trigger reactions (like videos).
    """
    def __init__(self):
        # Initial default rules.
        # In a real app, these would be loaded from persona_config.json
        self.rules = [
            {
                "id": "thank_any_gift",
                "enabled": True,
                "when": {
                    "eventType": "gift.received",
                    "minQuantity": 1
                },
                "cooldownMs": 15000,
                "action": {
                    "type": "video.play_thank_you",
                    "videoId": "thanks_default",
                    "priority": "normal"
                }
            },
            {
                "id": "thank_roses_batch",
                "enabled": True,
                "when": {
                    "eventType": "gift.received",
                    "giftName": "Rosa",
                    "minQuantity": 5
                },
                "cooldownMs": 20000,
                "action": {
                    "type": "video.play_thank_you",
                    "videoId": "thanks_roses",
                    "priority": "normal"
                }
            },
            {
                "id": "thank_big_gift",
                "enabled": True,
                "when": {
                    "eventType": "gift.received",
                    "giftName": ["Foguete", "Diamante"],
                    "minQuantity": 1
                },
                "cooldownMs": 10000,
                "action": {
                    "type": "video.play_thank_you",
                    "videoId": "thanks_big_gift",
                    "priority": "high"
                }
            },
            {
                "id": "thank_top_sender",
                "enabled": True,
                "when": {
                    "eventType": "gift.received",
                    "senderSessionTotalMin": 20
                },
                "cooldownMs": 60000,
                "action": {
                    "type": "video.play_thank_you",
                    "videoId": "thanks_top_supporter",
                    "priority": "high"
                }
            }
        ]
        self.last_triggered: Dict[str, float] = {}

    def evaluate(self, ledger_event: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        Evaluates the rules based on the summary provided by the GiftLedger.
        Returns a list of actions to execute.
        """
        actions = []
        now = datetime.now().timestamp() * 1000

        # Sort rules by priority (not implemented here, but good practice)
        # We'll just run them all and check cooldowns.

        for rule in self.rules:
            if not rule.get("enabled", True):
                continue

            rule_id = rule["id"]
            cooldown = rule.get("cooldownMs", 0)

            if rule_id in self.last_triggered:
                if now - self.last_triggered[rule_id] < cooldown:
                    logger.debug(f"[RULES] Rule {rule_id} skipped (cooldown).")
                    continue

            if self._matches(rule, ledger_event):
                logger.info(f"[RULES] Rule matched: {rule_id}")
                self.last_triggered[rule_id] = now

                # Enrich action with context
                action = rule["action"].copy()
                action["rule_id"] = rule_id
                action["sender"] = ledger_event["sender"]
                action["giftName"] = ledger_event["giftName"]
                action["quantity"] = ledger_event["quantity"]
                actions.append(action)

        return actions

    def _matches(self, rule: Dict[str, Any], event: Dict[str, Any]) -> bool:
        conditions = rule.get("when", {})

        # Basic event type check
        if conditions.get("eventType") != event.get("type"):
            return False

        # Gift Name check
        target_gifts = conditions.get("giftName")
        if target_gifts:
            if isinstance(target_gifts, list):
                if event.get("giftName") not in target_gifts:
                    return False
            elif event.get("giftName") != target_gifts:
                return False

        # Min Quantity check
        if "minQuantity" in conditions:
            if event.get("quantity", 0) < conditions["minQuantity"]:
                return False

        # Sender Total check
        if "senderSessionTotalMin" in conditions:
            if event.get("senderSessionTotal", 0) < conditions["senderSessionTotalMin"]:
                return False

        return True

# Singleton instance
gift_rule_engine = GiftRuleEngine()
