import json
import logging
import time
from pathlib import Path
from typing import Any, Dict
import os

_cached_config = None
_cached_mtime = 0

logger = logging.getLogger("odessa.config")

CONFIG_PATH = Path(__file__).parent.parent / "data" / "persona_config.json"


def _empty_config() -> Dict[str, Any]:
    return {
        "videos": [],
        "action_map": {"gift": [], "message": [], "idle": []},
        "gift_map": {},
        "transitions": {},
        "triggers": [],
        "flowNodes": [],
        "flowConnections": [],
        "flowCanvasVideoIds": [],
        "idleVideoId": "",
        "stageSettings": {"fit": "contain", "zoom": 1.0, "offsetX": 0, "offsetY": 0},
        "mediaTracks": [],
    }

def _playback_settings(value: Any = None) -> Dict[str, Any]:
    data = value if isinstance(value, dict) else {}
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


def _audio_settings(value: Any = None) -> Dict[str, Any]:
    data = value if isinstance(value, dict) else {}
    mode = str(data.get("mode", data.get("audioMode", "muted")) or "muted").strip().lower()
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


def _connection_settings(value: Any = None) -> Dict[str, Any]:
    data = value if isinstance(value, dict) else {}
    fade_mode = str(data.get("fadeMode", "crossfade") or "crossfade").strip().lower()
    if fade_mode not in {"cut", "fade", "crossfade"}:
        fade_mode = "crossfade"
    try:
        transition_ms = int(data.get("transitionMs", 220) or 220)
    except (TypeError, ValueError):
        transition_ms = 220
    try:
        preview_tail = float(data.get("previewTailSec", 2) or 2)
    except (TypeError, ValueError):
        preview_tail = 2.0
    try:
        preview_head = float(data.get("previewHeadSec", 2) or 2)
    except (TypeError, ValueError):
        preview_head = 2.0
    return {
        "transitionMs": max(0, min(2000, transition_ms)),
        "fadeMode": fade_mode,
        "previewTailSec": max(0.5, min(8.0, preview_tail)),
        "previewHeadSec": max(0.5, min(8.0, preview_head)),
    }


def _position(value: Any = None) -> Dict[str, int]:
    data = value if isinstance(value, dict) else {}
    return {
        "x": int(round(float(data.get("x", 80) or 80))),
        "y": int(round(float(data.get("y", 80) or 80))),
    }


def _normalize_config(data: Dict[str, Any]) -> Dict[str, Any]:
    data.setdefault("videos", [])
    data.setdefault("action_map", {"gift": [], "message": [], "idle": []})
    if not isinstance(data.get("action_map"), dict):
        data["action_map"] = {"gift": [], "message": [], "idle": []}
    data["action_map"].setdefault("gift", [])
    data["action_map"].setdefault("message", [])
    data["action_map"].setdefault("idle", [])
    data.setdefault("gift_map", {})
    data.setdefault("transitions", {})
    data.setdefault("stageSettings", {"fit": "contain", "zoom": 1.0, "offsetX": 0, "offsetY": 0})
    data.setdefault("mediaTracks", [])

    if not isinstance(data.get("triggers"), list):
        data["triggers"] = []
    if not isinstance(data.get("flowNodes"), list):
        data["flowNodes"] = []
    if not isinstance(data.get("flowConnections"), list):
        data["flowConnections"] = []
    if not isinstance(data.get("flowCanvasVideoIds"), list):
        data["flowCanvasVideoIds"] = []

    if not data.get("idleVideoId"):
        idle_pool = data.get("action_map", {}).get("idle", [])
        loop_video = next(
            (video.get("id") for video in data.get("videos", []) if video.get("loop")),
            None,
        )
        data["idleVideoId"] = loop_video or (idle_pool[0] if idle_pool else "")

    if data["idleVideoId"]:
        data["action_map"]["idle"] = [data["idleVideoId"]]
        for video in data.get("videos", []):
            video["loop"] = video.get("id") == data["idleVideoId"]

    video_ids = {video.get("id") for video in data.get("videos", []) if video.get("id")}
    video_labels = {
        video.get("id"): video.get("label") or video.get("id")
        for video in data.get("videos", [])
        if video.get("id")
    }

    legacy_canvas_ids = []
    for video_id in [
        data.get("idleVideoId"),
        *data.get("flowCanvasVideoIds", []),
        *list((data.get("flowLayout") or {}).keys()),
    ]:
        if not isinstance(video_id, str) or not video_id:
            continue
        if video_ids and video_id not in video_ids:
            continue
        if video_id not in legacy_canvas_ids:
            legacy_canvas_ids.append(video_id)

    for connection in data.get("flowConnections", []):
        for key in ("fromVideoId", "toVideoId"):
            video_id = connection.get(key)
            if isinstance(video_id, str) and video_id in video_ids and video_id not in legacy_canvas_ids:
                legacy_canvas_ids.append(video_id)

    if not data["flowNodes"]:
        data["flowNodes"] = [
            {
                "nodeId": f"node-{video_id}",
                "videoId": video_id,
                "label": video_labels.get(video_id, video_id),
                "position": _position((data.get("flowLayout") or {}).get(video_id)),
                "playback": _playback_settings(),
                "audio": _audio_settings(),
            }
            for video_id in legacy_canvas_ids
        ]

    normalized_nodes = []
    seen_node_ids = set()
    for index, node in enumerate(data.get("flowNodes", [])):
        if not isinstance(node, dict):
            continue
        video_id = node.get("videoId")
        if not isinstance(video_id, str) or (video_ids and video_id not in video_ids):
            continue
        node_id = str(node.get("nodeId") or f"node-{video_id}-{index}")
        if node_id in seen_node_ids:
            node_id = f"{node_id}-{int(time.time() * 1000)}-{index}"
        seen_node_ids.add(node_id)
        normalized_nodes.append(
            {
                **node,
                "nodeId": node_id,
                "videoId": video_id,
                "label": node.get("label") or video_labels.get(video_id, video_id),
                "position": _position(node.get("position")),
                "playback": _playback_settings(node.get("playback")),
                "audio": _audio_settings(node.get("audio")),
            }
        )
    data["flowNodes"] = normalized_nodes

    first_node_by_video = {}
    for node in normalized_nodes:
        first_node_by_video.setdefault(node["videoId"], node["nodeId"])
    node_by_id = {node["nodeId"]: node for node in normalized_nodes}

    normalized_connections = []
    for connection in data.get("flowConnections", []):
        if not isinstance(connection, dict):
            continue
        from_node_id = connection.get("fromNodeId") or first_node_by_video.get(connection.get("fromVideoId"))
        to_node_id = connection.get("toNodeId") or first_node_by_video.get(connection.get("toVideoId"))
        if from_node_id not in node_by_id or to_node_id not in node_by_id:
            continue
        normalized_connections.append(
            {
                **connection,
                "fromNodeId": from_node_id,
                "toNodeId": to_node_id,
                "fromVideoId": node_by_id[from_node_id]["videoId"],
                "toVideoId": node_by_id[to_node_id]["videoId"],
                "returnToIdle": connection.get("returnToIdle", True),
                "connectionSettings": _connection_settings(connection.get("connectionSettings")),
            }
        )
    data["flowConnections"] = normalized_connections

    node_by_id = {node["nodeId"]: node for node in data["flowNodes"]}
    connection_by_trigger_id = {
        connection.get("triggerId"): connection
        for connection in data["flowConnections"]
        if connection.get("triggerId")
    }
    for trigger in data.get("triggers", []):
        if not isinstance(trigger, dict):
            continue
        connection = connection_by_trigger_id.get(trigger.get("id"))
        next_actions = []
        for action in trigger.get("actions", []):
            if not isinstance(action, dict):
                continue
            target_node_id = action.get("nodeId") or (connection or {}).get("toNodeId")
            target_node = node_by_id.get(target_node_id)
            next_action = dict(action)
            if target_node:
                next_action["nodeId"] = target_node["nodeId"]
                next_action["videoId"] = target_node["videoId"]
                next_action["playback"] = target_node["playback"]
                next_action["audio"] = target_node.get("audio") or _audio_settings()
            if connection:
                next_action["returnToIdle"] = connection.get("returnToIdle", True)
            next_actions.append(next_action)
        trigger["actions"] = next_actions

    data["flowCanvasVideoIds"] = []
    for node in data["flowNodes"]:
        if node["videoId"] not in data["flowCanvasVideoIds"]:
            data["flowCanvasVideoIds"].append(node["videoId"])

    return data


def load_persona_config() -> Dict[str, Any]:
    """Loads the persona video configuration from JSON."""
    global _cached_config, _cached_mtime
    if not CONFIG_PATH.exists():
        logger.warning("Config file not found at %s, returning empty config.", CONFIG_PATH)
        return _empty_config()

    try:
        mtime = os.path.getmtime(CONFIG_PATH)
        if _cached_config is not None and mtime == _cached_mtime:
            return _cached_config

        logger.info("Loading persona config from %s", CONFIG_PATH)
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            data = _normalize_config(json.load(f))
            _cached_config = data
            _cached_mtime = mtime
            logger.info("Successfully loaded persona config with %s videos.", len(data.get("videos", [])))
            return data
    except Exception as exc:
        logger.error("Error loading persona config: %s", exc)
        return _empty_config()


def save_persona_config(config: Dict[str, Any]) -> bool:
    """Saves the persona video configuration to JSON."""
    global _cached_config, _cached_mtime
    try:
        CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        normalized = _normalize_config(config)
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(normalized, f, indent=2, ensure_ascii=False)
        _cached_config = normalized
        _cached_mtime = os.path.getmtime(CONFIG_PATH)
        return True
    except Exception as exc:
        logger.error("Error saving persona config: %s", exc)
        return False
