import logging
import uuid
from typing import Any, Dict, List, Optional

from server.services.automation.aggregator import event_aggregator
from server.services.automation.engine import trigger_engine
from server.services.automation.gift_ledger import gift_ledger
from server.services.automation.logger import execution_logger
from server.services.automation.metrics import automation_metrics
from server.services.automation.parser import event_parser
from server.services.automation.queue import action_queue

logger = logging.getLogger("odessa.automation.service")


class AutomationService:
    """
    Orchestrates OCR/chat text -> parser -> reactive trigger engine -> action queue.
    The saved persona_config triggers are the only source of video actions here.
    """

    def __init__(self):
        self.parser = event_parser
        self.engine = trigger_engine
        self.queue = action_queue
        self.exec_logger = execution_logger
        self.aggregator = event_aggregator
        self.ledger = gift_ledger
        self.metrics = automation_metrics

    @staticmethod
    def _stabilize_actions(actions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Keep event reactions predictable when many triggers match the same OCR line."""
        if not actions:
            return []
        video_actions: List[Dict[str, Any]] = []
        other_actions: List[Dict[str, Any]] = []
        for action in actions:
            action_type = str(action.get("type") or "")
            if action_type == "play_video" or action_type.startswith("video."):
                video_actions.append(action)
            else:
                other_actions.append(action)

        if len(video_actions) <= 1:
            return actions

        allow_multi = [action for action in video_actions if action.get("allowMultipleForEvent")]
        primary = sorted(
            video_actions,
            key=lambda action: (int(action.get("priority", 0) or 0), -int(action.get("cooldown_ms", 0) or 0)),
            reverse=True,
        )[0]
        selected_video_actions = [primary, *[action for action in allow_multi if action is not primary]]
        selected_ids = {id(action) for action in selected_video_actions}
        stabilized: List[Dict[str, Any]] = []
        for action in actions:
            if action in other_actions or id(action) in selected_ids:
                stabilized.append(action)
        return stabilized

    def process_raw_text(
        self,
        raw_text: str,
        event_hint: Optional[Dict[str, Any]] = None,
        queue_actions: bool = True,
        workflow_config: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Process one raw OCR/chat line and return a testable execution summary."""
        event_hint = event_hint or {}
        summary: Dict[str, Any] = {
            "status": "ignored",
            "text": raw_text,
            "eventHint": event_hint,
            "events": [],
            "matchedTriggers": [],
            "actions": [],
            "queuedActions": [],
            "blockedActions": [],
            "logs": [],
        }

        if not raw_text or not raw_text.strip():
            return summary

        def record(stage: str, message: str, data: Dict[str, Any] | None = None):
            entry = self.exec_logger.log(stage, message, data)
            summary["logs"].append(entry)
            return entry

        record("INPUT", "Texto recebido para teste do fluxo", {"text": raw_text})

        events = self.parser.parse_text(
            raw_text,
            hint_kind=event_hint.get("kind"),
            zone_name=event_hint.get("zoneName"),
            metadata=event_hint.get("metadata") if isinstance(event_hint.get("metadata"), dict) else {},
        )
        summary["events"] = events

        for event in events:
            event_id = str(uuid.uuid4())
            event["id"] = event_id
            self.metrics.start_event(event_id)

            record("PARSER", f"Evento detectado: {event.get('kind', 'unknown')}", event)

            if event.get("kind") == "moderation":
                self.metrics.increment("moderation_events")
                self.metrics.end_event(event_id)
                record("FILTER", "Evento bloqueado por moderacao", event)
                continue

            if event.get("kind") == "gift" and queue_actions:
                ledger_summary = self.ledger.record_gift(event)
                record("LEDGER", "Presente registrado no placar da sessao", ledger_summary)
            elif event.get("kind") == "gift":
                record("DRY_LEDGER", "Presente reconhecido sem alterar placar da sessao", event)

            draft_triggers = workflow_config.get("triggers", []) if isinstance(workflow_config, dict) else None
            actions = self._stabilize_actions(self.engine.match_event(event, triggers=draft_triggers))
            if not actions:
                record("TRIGGER", "Nenhum gatilho do fluxo reativo correspondeu ao evento", event)
                self.metrics.end_event(event_id)
                continue

            matched = [
                {
                    "id": action.get("trigger_id"),
                    "name": action.get("trigger_name"),
                    "actionType": action.get("type"),
                    "capability": action.get("capability"),
                    "videoId": action.get("videoId"),
                    "sceneName": (action.get("payload") or {}).get("sceneName")
                    if isinstance(action.get("payload"), dict)
                    else None,
                    "webhookId": (action.get("payload") or {}).get("webhookId")
                    if isinstance(action.get("payload"), dict)
                    else None,
                }
                for action in actions
            ]
            summary["matchedTriggers"].extend(matched)
            summary["actions"].extend(actions)
            record("TRIGGER", f"{len(actions)} gatilho(s) casaram com o evento", {"matches": matched})

            queued_actions = self.queue.add_actions(actions) if queue_actions else []
            blocked_actions = list(getattr(self.queue, "last_blocked_actions", [])) if queue_actions else []
            summary["queuedActions"].extend(queued_actions)
            summary["blockedActions"].extend(blocked_actions)
            if not queue_actions:
                record("DRY_RUN", "Acoes avaliadas sem enfileirar nem executar", {"actions": actions})
            elif queued_actions:
                self.metrics.increment("done_actions", len(queued_actions))
                record("QUEUE", f"{len(queued_actions)} acao(oes) enfileirada(s)", {"actions": queued_actions})
            else:
                self.metrics.increment("blocked_actions")
                record("QUEUE", "Acoes bloqueadas por cooldown", {"actions": blocked_actions or actions})

            self.metrics.end_event(event_id)

        summary["status"] = "processed"
        summary["queue"] = self.get_pending_actions()
        return summary

    async def _handle_event_with_aggregation(self, event: Dict[str, Any]):
        event_id = event["id"]
        processed_event = await self.aggregator.add_event(event)

        if processed_event:
            await self._dispatch_event(processed_event)
            self.metrics.end_event(event_id)

    async def process_aggregated_event(self, event: Dict[str, Any]):
        """Callback for the aggregator when a batch is ready."""
        self.metrics.increment("aggregated_gift_events")
        await self._dispatch_event(event)

    async def _dispatch_event(self, event: Dict[str, Any]):
        """Dispatch aggregated events through the same reactive trigger engine."""
        if event.get("kind") == "gift":
            ledger_summary = self.ledger.record_gift(event)
            self.exec_logger.log("LEDGER", "Presente registrado no placar da sessao", ledger_summary)

        actions = self.engine.match_event(event)
        if actions:
            queued_actions = self.queue.add_actions(actions)
            self.metrics.increment("done_actions", len(queued_actions))
            self.exec_logger.log("QUEUE", f"Enfileiradas {len(queued_actions)} acoes", {"actions": queued_actions})
            logger.info(
                "Processed event %s from %s. %s actions queued.",
                event.get("kind"),
                event.get("user", "unknown"),
                len(queued_actions),
            )

    def get_pending_actions(self) -> List[Dict[str, Any]]:
        """Return all currently queued actions for synchronization."""
        return list(self.queue.queue)

    async def consume_next_action(self) -> Optional[Dict[str, Any]]:
        """Retrieve and remove the next action from the queue."""
        return await self.queue.get_next_action()

    def get_session_metrics(self) -> Dict[str, Any]:
        metrics = self.metrics.get_summary()
        metrics["giftLedger"] = self.ledger.get_summary()
        return metrics


automation_service = AutomationService()
