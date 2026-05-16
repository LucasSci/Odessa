import logging
from typing import Dict, Any
from server.services.obs_service import obs_service
from server.services.video_service import video_service
from server.services.webhook_service import webhook_service
from server.services.automation.metrics import automation_metrics

logger = logging.getLogger("odessa.automation.executor")


def get_tts_service():
    from server.services.tts_service import tts_service

    return tts_service

class ActionExecutor:
    """
    Executes actions from the queue using the appropriate services.
    """
    async def execute(self, action: Dict[str, Any]) -> Dict[str, Any]:
        action_type = action.get("type")
        capability = action.get("capability")
        logger.info(f"[EXECUTOR] Executing action: {action_type}")

        result = {"status": "error", "reason": "unknown_action_type"}

        if action_type == "speak":
            result = await self._handle_speak(action)
        elif action_type in {"obs.switch_scene", "switch_scene"} or capability == "obs.switch_scene":
            result = await self._handle_obs(action)
        elif action_type in {"webhook", "webhook.call", "call_webhook"} or capability == "webhook.call":
            result = await self._handle_webhook(action)
        elif action_type == "play_video" or str(action_type).startswith("video."):
            result = self._handle_video(action)
        elif action_type == "media.play_music":
            result = self._handle_media(action)

        # Update metrics based on result
        if result.get("status") == "done":
            automation_metrics.increment("done_actions")
        elif result.get("status") == "simulated":
            automation_metrics.increment("simulated_actions")
        elif result.get("status") == "blocked":
            automation_metrics.increment("blocked_actions")

        return result

    async def _handle_speak(self, action: Dict[str, Any]) -> Dict[str, Any]:
        text = action.get("text") or action.get("payload", {}).get("text")
        if not text:
            return {"status": "blocked", "reason": "missing_text"}

        try:
            path = await get_tts_service().synthesize(text)
            if path == "simulated_path":
                return {"status": "simulated", "text": text}
            if not path:
                return {"status": "blocked", "reason": "tts_disabled"}

            # Here we would normally trigger audio playback.
            # For now, we assume synthesize did its job (or simulation).
            return {"status": "done", "text": text}
        except Exception as exc:
            logger.error(f"TTS Execution failed: {exc}")
            return {"status": "error", "reason": str(exc)}

    async def _handle_obs(self, action: Dict[str, Any]) -> Dict[str, Any]:
        payload = action.get("payload", {}) if isinstance(action.get("payload"), dict) else {}
        scene = (
            action.get("sceneName")
            or action.get("scene")
            or action.get("requestedScene")
            or payload.get("sceneName")
            or payload.get("scene")
            or payload.get("requestedScene")
        )
        if not scene:
            return {"status": "blocked", "reason": "missing_scene"}

        return await obs_service.switch_scene(scene)

    async def _handle_webhook(self, action: Dict[str, Any]) -> Dict[str, Any]:
        payload = action.get("payload", {}) if isinstance(action.get("payload"), dict) else {}
        webhook_id = action.get("webhookId") or payload.get("webhookId")
        if not webhook_id:
            return {"status": "blocked", "reason": "missing_webhook_id"}

        result = await webhook_service.dispatch(
            str(webhook_id),
            event=action.get("event") if isinstance(action.get("event"), dict) else {},
            action=action,
            payload=payload,
        )
        if result.get("ok"):
            return {"status": "done", **result}
        if result.get("status") == "blocked":
            return {"status": "blocked", "reason": result.get("error", "webhook_blocked"), **result}
        return {"status": "error", "reason": result.get("error", "webhook_error"), **result}

    def _handle_video(self, action: Dict[str, Any]) -> Dict[str, Any]:
        return video_service.handle_video_action(action)

    def _handle_media(self, action: Dict[str, Any]) -> Dict[str, Any]:
        from server.config import SIMULATION_MODE
        track = action.get("requestedTrack") or action.get("payload", {}).get("requestedTrack")
        if SIMULATION_MODE:
            logger.info(f"[MEDIA SIMULATION] Would play track: {track}")
            return {"status": "simulated", "requestedTrack": track}
        return {"status": "blocked", "reason": "media_player_not_connected"}

# Singleton instance
action_executor = ActionExecutor()
