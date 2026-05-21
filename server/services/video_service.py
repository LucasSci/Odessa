import logging
import random
import time
from typing import Any, Dict, List, Optional

from server.core.config_manager import load_persona_config
from server.core.video_logic import SCENARIO_SEQUENCES

logger = logging.getLogger("odessa.video")


class VideoService:
    def __init__(self):
        self.sequence_queue: List[str] = []
        self.state = "IDLE"  # IDLE, ACTION
        self._config = load_persona_config()
        self.current_video_id = self._idle_video_id() or "04"
        self.current_clip = self._idle_clip() or self._clip_from_video_id(self.current_video_id)
        self.last_state_update = 0
        self.current_video_start_ts = time.time()

    def _idle_video_id(self) -> str:
        idle_id = self._config.get("idleVideoId") or (self._config.get("action_map", {}).get("idle", [""])[0])
        return str(idle_id or "").replace("video_", "").replace(".mp4", "").strip()

    def _video_label(self, video_id: str) -> str:
        video = next((item for item in self._config.get("videos", []) if item.get("id") == video_id), None)
        return (video or {}).get("label") or video_id

    def _video_entry(self, video_id: str) -> Dict[str, Any]:
        return next((item for item in self._config.get("videos", []) if item.get("id") == video_id), {}) or {}

    def _video_available(self, video_id: str) -> bool:
        entry = self._video_entry(video_id)
        return not entry.get("missingFile")

    def _playback(self, playback: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        data = playback if isinstance(playback, dict) else {}
        start_sec = max(0.0, float(data.get("startSec", 0) or 0))
        raw_end = data.get("endSec")
        end_sec = None
        if raw_end not in (None, ""):
            end_sec = max(0.0, float(raw_end) or 0)
            if end_sec <= start_sec:
                end_sec = None
        transition_ms = int(data.get("transitionMs", 220) or 220)
        transition_ms = max(0, min(2000, transition_ms))
        return {"startSec": start_sec, "endSec": end_sec, "transitionMs": transition_ms}

    def _audio(self, audio: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        data = audio if isinstance(audio, dict) else {}
        mode = str(data.get("mode", data.get("audioMode", "muted")) or "muted").lower()
        if mode not in {"muted", "original", "track"}:
            mode = "muted"
        try:
            volume = float(data.get("volume", 1.0))
        except (TypeError, ValueError):
            volume = 1.0
        return {
            "mode": mode,
            "volume": max(0.0, min(1.0, volume)),
            "trackId": str(data.get("trackId") or "").strip(),
            "trackUrl": str(data.get("trackUrl") or "").strip(),
        }

    def _clip_from_node(self, node: Dict[str, Any], return_to_idle: bool = True) -> Dict[str, Any]:
        playback = self._playback(node.get("playback"))
        return {
            "nodeId": node.get("nodeId"),
            "videoId": node.get("videoId"),
            "label": node.get("label") or self._video_label(node.get("videoId", "")),
            "startSec": playback["startSec"],
            "endSec": playback["endSec"],
            "transitionMs": playback["transitionMs"],
            "returnToIdle": return_to_idle,
            "playback": playback,
            "audio": self._audio(node.get("audio")),
            "missingFile": bool(self._video_entry(node.get("videoId", "")).get("missingFile")),
        }

    def _clip_from_video_id(self, video_id: str, return_to_idle: bool = True) -> Dict[str, Any]:
        clean_id = str(video_id or "").replace("video_", "").replace(".mp4", "").strip()
        return {
            "nodeId": None,
            "videoId": clean_id,
            "label": self._video_label(clean_id),
            "startSec": 0.0,
            "endSec": None,
            "transitionMs": 220,
            "returnToIdle": return_to_idle,
            "playback": {"startSec": 0.0, "endSec": None, "transitionMs": 220},
            "audio": {"mode": "muted", "volume": 1.0, "trackId": "", "trackUrl": ""},
            "missingFile": bool(self._video_entry(clean_id).get("missingFile")),
        }

    def _idle_clip(self) -> Optional[Dict[str, Any]]:
        idle_id = self._idle_video_id()
        if not idle_id:
            return None
        node = next(
            (item for item in self._config.get("flowNodes", []) if item.get("videoId") == idle_id),
            None,
        )
        if node:
            return self._clip_from_node(node, return_to_idle=False)
        return self._clip_from_video_id(idle_id, return_to_idle=False)

    def _clip_from_action(self, action: Dict[str, Any]) -> Dict[str, Any]:
        node_id = action.get("nodeId")
        node = next(
            (item for item in self._config.get("flowNodes", []) if item.get("nodeId") == node_id),
            None,
        )
        if node:
            clip = self._clip_from_node(node, return_to_idle=action.get("returnToIdle", True))
        else:
            clip = self._clip_from_video_id(action.get("videoId"), return_to_idle=action.get("returnToIdle", True))

        if isinstance(action.get("playback"), dict):
            playback = self._playback(action.get("playback"))
            clip.update(
                {
                    "startSec": playback["startSec"],
                    "endSec": playback["endSec"],
                    "transitionMs": playback["transitionMs"],
                    "playback": playback,
                }
            )
        if isinstance(action.get("audio"), dict):
            clip["audio"] = self._audio(action.get("audio"))
        return clip

    def _node_by_id(self, node_id: Optional[str]) -> Optional[Dict[str, Any]]:
        if not node_id:
            return None
        return next((item for item in self._config.get("flowNodes", []) if item.get("nodeId") == node_id), None)

    def _trigger_by_id(self, trigger_id: Optional[str]) -> Optional[Dict[str, Any]]:
        if not trigger_id:
            return None
        return next((item for item in self._config.get("triggers", []) if item.get("id") == trigger_id), None)

    def _upcoming_for_clip(self, clip: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
        if not clip:
            return []

        node_id = clip.get("nodeId")
        upcoming: List[Dict[str, Any]] = []
        for connection in self._config.get("flowConnections", []):
            if connection.get("fromNodeId") != node_id:
                continue
            trigger = self._trigger_by_id(connection.get("triggerId"))
            if trigger and trigger.get("eventType") != "natural":
                continue
            target = self._node_by_id(connection.get("toNodeId"))
            if not target:
                continue
            upcoming.append(self._clip_from_node(target, return_to_idle=connection.get("returnToIdle", True)))
            if len(upcoming) >= 3:
                break

        if not upcoming:
            if clip.get("returnToIdle", True):
                idle = self._idle_clip()
                if idle and idle.get("videoId") != clip.get("videoId"):
                    upcoming.append(idle)
        return upcoming

    def get_state(self) -> Dict[str, Any]:
        """Returns the current state for synchronization."""
        return {
            "current_video_id": self.current_video_id,
            "state": self.state,
            "queue_len": len(self.sequence_queue),
            "update_ts": self.last_state_update,
            "start_ts": self.current_video_start_ts,
            "server_time": time.time(),
            "currentClip": self.current_clip,
            "upcoming": self._upcoming_for_clip(self.current_clip),
            "activeNodeId": (self.current_clip or {}).get("nodeId"),
            "activeConnectionId": self._active_connection_id(),
            "nextConnectionIds": self._next_connection_ids(),
            "blockedConnectionIds": [],
            "executionMode": "live",
            "lastTransitionAt": self.current_video_start_ts,
        }

    def _active_connection_id(self) -> Optional[str]:
        node_id = (self.current_clip or {}).get("nodeId")
        if not node_id:
            return None
        for connection in self._config.get("flowConnections", []):
            if connection.get("toNodeId") == node_id:
                return connection.get("id")
        return None

    def _next_connection_ids(self) -> List[str]:
        node_id = (self.current_clip or {}).get("nodeId")
        if not node_id:
            return []
        ids = []
        for connection in self._config.get("flowConnections", []):
            if connection.get("fromNodeId") == node_id:
                ids.append(connection.get("id"))
        return [item for item in ids if item][:3]

    def refresh_config(self):
        """Reloads the configuration from disk."""
        self._config = load_persona_config()
        existing_ids = {str(video.get("id")) for video in self._config.get("videos", [])}
        if self.current_video_id not in existing_ids and self._idle_video_id():
            self.current_clip = self._idle_clip()
            self.current_video_id = self.current_clip["videoId"] if self.current_clip else self._idle_video_id()
            self.state = "IDLE"
            self.current_video_start_ts = time.time()
            self.last_state_update += 1
        logger.info("VideoService configuration refreshed.")

    def force_clip(self, clip: Dict[str, Any], state: str = "ACTION") -> Dict[str, Any]:
        """Immediately sets the active clip and exposes it through /video/state."""
        clean_id = str(clip.get("videoId") or "").replace("video_", "").replace(".mp4", "").strip()
        if not clean_id:
            raise ValueError("video_id is required")
        self.current_clip = {**clip, "videoId": clean_id}
        self.current_video_id = clean_id
        self.current_video_start_ts = time.time()
        self.state = state
        self.last_state_update += 1
        logger.info("Forced clip %s/%s with state %s", self.current_clip.get("nodeId"), clean_id, state)
        return self.get_state()

    def force_video(self, video_id: str, state: str = "ACTION") -> Dict[str, Any]:
        """Compatibility wrapper for older callers that only know videoId."""
        return self.force_clip(self._clip_from_video_id(video_id), state=state)

    def return_to_idle(self) -> Dict[str, Any]:
        """Returns the player to the configured Idle loop."""
        idle = self._idle_clip()
        if not idle:
            idle = self._clip_from_video_id(self.current_video_id, return_to_idle=False)
        return self.force_clip(idle, state="IDLE")

    def advance(self) -> Dict[str, Any]:
        """Advance to the resolved next clip, or fall back to Idle."""
        upcoming = self._upcoming_for_clip(self.current_clip)
        if upcoming:
            next_clip = upcoming[0]
            next_state = "IDLE" if next_clip.get("videoId") == self._idle_video_id() else "ACTION"
            return self.force_clip(next_clip, state=next_state)
        return self.return_to_idle()

    def handle_video_action(self, action: Dict[str, Any]) -> Dict[str, Any]:
        """Processes video actions from the automation queue."""
        action_type = action.get("type")

        if action_type in {"play_video", "video.play_thank_you", "video.play"}:
            clip = self._clip_from_action(action)
            if not self._video_available(clip.get("videoId", "")):
                return {"status": "blocked", "reason": "missing_video_file", "action": action, "currentClip": clip}
            state = self.force_clip(clip, state="ACTION")
            return {
                "status": "done",
                "videoState": state,
                "videoId": state["current_video_id"],
                "currentClip": state["currentClip"],
                "upcoming": state["upcoming"],
            }

        from server.config import SIMULATION_MODE
        if SIMULATION_MODE:
            logger.info("[VIDEO SIMULATION] Would play video for action %s", action_type)
            return {"status": "simulated", "action": action}

        return {"status": "ignored", "reason": "unknown_action_type"}

    def preview_action(self, action: Dict[str, Any], config: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        live_config = self._config
        if config is not None:
            self._config = config
        try:
            clip = self._clip_from_action(action) if action.get("type") in {"play_video", "video.play"} else None
            flow_connections = self._config.get("flowConnections", [])
            video_entry = self._video_entry((clip or {}).get("videoId", ""))
        finally:
            self._config = live_config
        blocked_reason = None
        if clip and video_entry.get("missingFile"):
            blocked_reason = "missing_video_file"
        connection = next(
            (
                item
                for item in flow_connections
                if item.get("toNodeId") == (clip or {}).get("nodeId")
                or item.get("triggerId") == action.get("trigger_id")
            ),
            None,
        )
        return {
            "action": action,
            "wouldExecute": blocked_reason is None,
            "blockedReason": blocked_reason,
            "currentClip": clip,
            "activeNodeId": (clip or {}).get("nodeId"),
            "activeConnectionId": (connection or {}).get("id"),
            "nextConnectionIds": [
                item.get("id")
                for item in flow_connections
                if item.get("fromNodeId") == (clip or {}).get("nodeId")
            ],
            "executionMode": "test",
        }

    def get_next_video(self, trigger: Optional[str] = None, gift_name: Optional[str] = None) -> str:
        """
        Legacy route used by older callers. New reactive playback uses currentClip/upcoming.
        """
        if self.sequence_queue:
            next_id = self.sequence_queue.pop(0)
            self.force_video(next_id, state="ACTION" if self.sequence_queue else "IDLE")
            return f"video_{next_id}.mp4"

        if trigger:
            if trigger in SCENARIO_SEQUENCES:
                if self.set_scenario(trigger):
                    return self.get_next_video()

            action_map = self._config.get("action_map", {})
            if trigger in action_map and action_map[trigger]:
                next_id = random.choice(action_map[trigger])
                self.force_video(next_id, state="ACTION")
                return f"video_{next_id}.mp4"

        self.advance()
        return f"video_{self.current_video_id}.mp4"

    def set_scenario(self, scenario: str):
        if scenario in SCENARIO_SEQUENCES:
            sequence = SCENARIO_SEQUENCES[scenario]
            self.sequence_queue = list(sequence)
            self.state = "ACTION"
            self.last_state_update += 1
            return True
        return False


video_service = VideoService()
