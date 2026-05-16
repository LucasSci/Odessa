import logging
import time
import asyncio
from typing import List, Optional, Dict, Any

logger = logging.getLogger("odessa.automation.queue")

class ActionQueue:
    """
    Manages the execution of actions.
    Handles queuing, cooldowns, and ensuring priority execution.
    """
    def __init__(self):
        self.queue: List[Dict[str, Any]] = []
        self.is_processing = False
        self.last_execution_time: Dict[str, float] = {} # trigger_id -> timestamp
        self.cooldown_ms = 3000 # Default global cooldown
        self.last_blocked_actions: List[Dict[str, Any]] = []

    def add_actions(self, actions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Adds a list of actions to the queue if they pass cooldown checks and sorts by priority."""
        added = False
        added_actions: List[Dict[str, Any]] = []
        blocked_actions: List[Dict[str, Any]] = []
        for action in actions:
            trigger_id = action.get("trigger_id", "default")

            # Check cooldown
            now = time.time() * 1000
            last_time = self.last_execution_time.get(trigger_id, 0)

            # Use specific cooldown if provided in action/trigger, else global
            trigger_cooldown = action.get("cooldown_ms", self.cooldown_ms)

            if now - last_time < trigger_cooldown:
                remaining_ms = max(0, int(trigger_cooldown - (now - last_time)))
                blocked = {
                    **action,
                    "blockedReason": "cooldown",
                    "cooldownMs": int(trigger_cooldown),
                    "remainingCooldownMs": remaining_ms,
                    "lastExecutionTime": last_time,
                }
                blocked_actions.append(blocked)
                logger.info(
                    "Action from trigger %s ignored due to cooldown (%sms remaining).",
                    trigger_id,
                    remaining_ms,
                )
                continue

            # Default priority is 0, higher numbers = higher priority
            action["priority"] = action.get("priority", 0)
            self.queue.append(action)
            added_actions.append(action)
            self.last_execution_time[trigger_id] = now
            added = True
            logger.info(f"Action queued: {action.get('type')} (Priority: {action['priority']})")

        if added:
            # Sort by priority descending (highest first)
            self.queue.sort(key=lambda x: x.get("priority", 0), reverse=True)
        self.last_blocked_actions = blocked_actions
        return added_actions

    async def get_next_action(self) -> Optional[Dict[str, Any]]:
        """
        Retrieves the next action to execute.
        This is called by the frontend or the orchestrator.
        """
        if self.queue:
            return self.queue.pop(0)
        return None

    def clear(self):
        """Clears the queue."""
        self.queue.clear()
        logger.info("Action queue cleared.")

# Singleton instance
action_queue = ActionQueue()
