import logging
import re
import random
import time
from typing import List, Optional, Dict, Any
from server.core.config_manager import load_persona_config
from server.core.video_logic import SCENARIO_SEQUENCES, TRANSITION_MAP, VIDEO_GROUPS

logger = logging.getLogger("odessa.video")

class VideoService:
    def __init__(self):
        self.current_video_id = "04"
        self.sequence_queue: List[str] = []
        self.state = "IDLE"  # IDLE, ACTION
        self._config = load_persona_config()
        self.last_state_update = 0
        self.current_video_start_ts = time.time()

    def get_state(self) -> Dict[str, Any]:
        """Returns the current state for synchronization."""
        return {
            "current_video_id": self.current_video_id,
            "state": self.state,
            "queue_len": len(self.sequence_queue),
            "update_ts": self.last_state_update,
            "start_ts": self.current_video_start_ts,
            "server_time": time.time()
        }

    def refresh_config(self):
        """Reloads the configuration from disk."""
        self._config = load_persona_config()
        logger.info("VideoService configuration refreshed.")

    def get_next_video(self, trigger: Optional[str] = None, gift_name: Optional[str] = None) -> str:
        """
        Determines the next video to play based on a trigger or natural progression.
        Accepts an optional `gift_name` used to resolve `gift_map` entries in the persona config.
        """
        # 1. If we have a sequence queued, use it
        if self.sequence_queue:
            next_id = self.sequence_queue.pop(0)
            self.current_video_id = next_id
            self.current_video_start_ts = time.time()
            
            # If queue is now empty and we were in ACTION state, return to IDLE
            if not self.sequence_queue and self.state == "ACTION":
                self.state = "IDLE"
            
            self.last_state_update += 1
            return f"video_{next_id}.mp4"

        # 2. Handle Action Trigger (Interruptions)
        if trigger:
            # Check if trigger is a scenario
            if trigger in SCENARIO_SEQUENCES:
                if self.set_scenario(trigger):
                    return self.get_next_video() # Recursive call to get first item from queue

            # If this is a gift trigger and we have a gift_name + gift_map, try to resolve locally
            if trigger == "gift" and gift_name:
                gift_map = self._config.get("gift_map", {})
                if gift_map:
                    gn = gift_name.strip().lower()
                    # 1) exact match
                    for k, vids in gift_map.items():
                        if not k:
                            continue
                        try_key = k.strip().lower()
                        if try_key == gn and vids:
                            next_id = random.choice(vids)
                            self.current_video_id = next_id
                            self.current_video_start_ts = time.time()
                            self.state = "ACTION"
                            self.last_state_update += 1
                            logger.info(f"Gift '{gift_name}' mapped to video {next_id} (exact).")
                            return f"video_{next_id}.mp4"

                    # 2) regex/pattern matches — keys can be /pattern/flags or re:... / regex:...
                    for k, vids in gift_map.items():
                        if not k:
                            continue
                        # JS-style /pattern/flags
                        if k.startswith('/') and k.rfind('/') > 0:
                            last = k.rfind('/')
                            pattern = k[1:last]
                            flags_str = k[last+1:]
                            flags = 0
                            if 'i' in flags_str.lower():
                                flags |= re.IGNORECASE
                            if 'm' in flags_str.lower():
                                flags |= re.MULTILINE
                            if 's' in flags_str.lower():
                                flags |= re.DOTALL
                            try:
                                cre = re.compile(pattern, flags)
                            except re.error:
                                continue
                            if cre.search(gift_name):
                                next_id = random.choice(vids)
                                self.current_video_id = next_id
                                self.current_video_start_ts = time.time()
                                self.state = "ACTION"
                                self.last_state_update += 1
                                logger.info(f"Gift '{gift_name}' mapped to video {next_id} (regex '{k}').")
                                return f"video_{next_id}.mp4"
                        # re: or regex: prefix
                        if k.lower().startswith('re:') or k.lower().startswith('regex:'):
                            try:
                                pattern = k.split(':', 1)[1]
                                cre = re.compile(pattern)
                            except Exception:
                                continue
                            if cre.search(gift_name):
                                next_id = random.choice(vids)
                                self.current_video_id = next_id
                                self.current_video_start_ts = time.time()
                                self.state = "ACTION"
                                self.last_state_update += 1
                                logger.info(f"Gift '{gift_name}' mapped to video {next_id} (regex '{k}').")
                                return f"video_{next_id}.mp4"

                    # 3) substring/heuristic match
                    for k, vids in gift_map.items():
                        if not k:
                            continue
                        kl = k.strip().lower()
                        if kl and (kl in gn or gn in kl) and vids:
                            next_id = random.choice(vids)
                            self.current_video_id = next_id
                            self.current_video_start_ts = time.time()
                            self.state = "ACTION"
                            self.last_state_update += 1
                            logger.info(f"Gift '{gift_name}' mapped to video {next_id} (heuristic '{k}').")
                            return f"video_{next_id}.mp4"
                    # 3) wildcard / default
                    if "*" in gift_map and gift_map.get("*"):
                        next_id = random.choice(gift_map.get("*"))
                        self.current_video_id = next_id
                        self.current_video_start_ts = time.time()
                        self.state = "ACTION"
                        self.last_state_update += 1
                        logger.info(f"Gift '{gift_name}' mapped to video {next_id} (wildcard '*').")
                        return f"video_{next_id}.mp4"
                    if "default" in gift_map and gift_map.get("default"):
                        next_id = random.choice(gift_map.get("default"))
                        self.current_video_id = next_id
                        self.current_video_start_ts = time.time()
                        self.state = "ACTION"
                        self.last_state_update += 1
                        logger.info(f"Gift '{gift_name}' mapped to video {next_id} (default).")
                        return f"video_{next_id}.mp4"

            # Fallback to simple action_map lookup (gift/message/idle)
            action_map = self._config.get("action_map", {})
            if trigger in action_map:
                possible_ids = action_map[trigger]
                if possible_ids:
                    next_id = random.choice(possible_ids)
                    self.current_video_id = next_id
                    self.current_video_start_ts = time.time()
                    self.state = "ACTION"
                    self.last_state_update += 1
                    return f"video_{next_id}.mp4"

        # 3. Check for specific next video in config
        current_video_config = next((v for v in self._config.get("videos", []) if v["id"] == self.current_video_id), None)
        if current_video_config:
            # If loop is explicitly set to True, we could return the same video
            # However, the frontend handles the loop usually. 
            # If we return the same ID, the frontend cross-fade will happen.
            if current_video_config.get("loop"):
                return f"video_{self.current_video_id}.mp4"
            
            # If there's a forced next video
            next_id = current_video_config.get("next_video_id")
            if next_id and next_id != "none":
                self.current_video_id = next_id
                return f"video_{next_id}.mp4"

        # 4. Natural progression (IDLE mode)
        self.state = "IDLE"
        
        # Try to find safe transitions from current config
        transitions = self._config.get("transitions", {})
        current_trans = transitions.get(self.current_video_id, {})
        safe_next = current_trans.get("safe_next", [])

        if not safe_next:
            # Fallback to random idle from action_map["idle"]
            idle_pool = self._config.get("action_map", {}).get("idle", ["04", "05", "14", "16"])
            if not idle_pool: # Emergency fallback
                idle_pool = ["04"]
            next_id = random.choice(idle_pool)
        else:
            next_id = random.choice(safe_next)

        self.current_video_id = next_id
        return f"video_{next_id}.mp4"

    def set_scenario(self, scenario: str):
        """Forces a specific scenario sequence."""
        if scenario in SCENARIO_SEQUENCES:
            sequence = SCENARIO_SEQUENCES[scenario]
            self.sequence_queue = list(sequence)
            self.state = "ACTION"
            self.last_state_update += 1
            logger.info(f"Scenario '{scenario}' activated. Sequence: {self.sequence_queue}")
            return True
        else:
            logger.warning(f"Scenario '{scenario}' not found in SCENARIO_SEQUENCES.")
            return False

video_service = VideoService()
