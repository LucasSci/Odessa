"""Edições de vídeo (cortes, velocidade, áudio, transição) guardadas no servidor.

Antes viviam só no localStorage do navegador do Palco, então o overlay do OBS
(outro navegador) nunca as via. Aqui elas viram fonte da verdade e são
aplicadas nos clips que o VideoService devolve.
"""

import json
import logging
import os
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

logger = logging.getLogger("odessa.video_edits")

DEFAULT_PATH = Path(__file__).parent.parent / "data" / "video_edits.json"

MIN_SPEED = 0.25
MAX_SPEED = 4.0
MAX_TRANSITION_MS = 4000
MAX_TRACK_URL_CHARS = 2_000_000
MAX_VIDEO_ID_CHARS = 200
MAX_HISTORY = 20
VALID_AUDIO_MODES = {"muted", "original", "track"}


def _num(value: Any, default: float = 0.0) -> float:
    try:
        n = float(value)
    except (TypeError, ValueError):
        return default
    return n if n == n and n not in (float("inf"), float("-inf")) else default


def sanitize_edit(video_id: str, raw: Any) -> Dict[str, Any]:
    data = raw if isinstance(raw, dict) else {}

    segments = []
    for item in data.get("segments") or []:
        if not isinstance(item, dict):
            continue
        start = max(0.0, _num(item.get("startSec")))
        end = max(0.0, _num(item.get("endSec")))
        if end <= start:
            continue
        segment: Dict[str, Any] = {"startSec": start, "endSec": end}
        speed = _num(item.get("speed"), 1.0)
        speed = min(MAX_SPEED, max(MIN_SPEED, speed)) if speed > 0 else 1.0
        if speed != 1.0:
            segment["speed"] = speed
        segments.append(segment)

    audio_mode = str(data.get("audioMode") or "muted").lower()
    if audio_mode not in VALID_AUDIO_MODES:
        audio_mode = "muted"

    track_url = data.get("trackUrl")
    track_url = track_url if isinstance(track_url, str) and len(track_url) <= MAX_TRACK_URL_CHARS else ""

    return {
        "videoId": video_id,
        "segments": segments,
        "audioMode": audio_mode,
        "volume": min(1.0, max(0.0, _num(data.get("volume"), 1.0))),
        "trackUrl": track_url or None,
        "trackLoop": bool(data.get("trackLoop")),
        "transitionMs": int(min(MAX_TRANSITION_MS, max(0.0, _num(data.get("transitionMs"), 220.0)))),
    }


def valid_video_id(video_id: Any) -> bool:
    return isinstance(video_id, str) and 0 < len(video_id) <= MAX_VIDEO_ID_CHARS and "/" not in video_id and "\\" not in video_id


class VideoEditStore:
    def __init__(self, path: Path = DEFAULT_PATH):
        self._path = Path(path)
        self._history_path = self._path.with_name(self._path.stem + "_history.json")
        self._lock = threading.Lock()
        self._cache: Optional[tuple] = None

    def _read(self) -> Dict[str, Dict[str, Any]]:
        # O overlay consulta o estado a cada ~500ms; só relê o arquivo se mudou.
        try:
            stat = self._path.stat()
        except FileNotFoundError:
            self._cache = None
            return {}
        except OSError:
            return {}
        signature = (stat.st_mtime_ns, stat.st_size)
        if self._cache and self._cache[0] == signature:
            return dict(self._cache[1])
        try:
            raw = json.loads(self._path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            logger.warning("[video_edits] arquivo ilegível, ignorando: %s", exc)
            return {}
        if not isinstance(raw, dict):
            return {}
        parsed = {vid: sanitize_edit(vid, edit) for vid, edit in raw.items() if valid_video_id(vid)}
        self._cache = (signature, parsed)
        return dict(parsed)

    def _write(self, data: Dict[str, Dict[str, Any]]) -> None:
        self._write_json(self._path, data)

    @staticmethod
    def _write_json(path: Path, data: Any) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(data, handle, ensure_ascii=False)
            os.replace(tmp, path)
        except BaseException:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise

    def all(self) -> Dict[str, Dict[str, Any]]:
        with self._lock:
            return self._read()

    def get(self, video_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            return self._read().get(video_id)

    # ── histórico de versões ────────────────────────────────────────────────
    def _read_history(self) -> Dict[str, list]:
        try:
            raw = json.loads(self._history_path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return {}
        except (OSError, ValueError) as exc:
            logger.warning("[video_edits] histórico ilegível, ignorando: %s", exc)
            return {}
        return raw if isinstance(raw, dict) else {}

    def _record_history(self, video_id: str, edit: Dict[str, Any], action: str) -> None:
        history = self._read_history()
        entries = history.get(video_id) if isinstance(history.get(video_id), list) else []
        stored = dict(edit)
        # Trilha embutida (data URL) pode ter ~1,6MB: não multiplica isso por 20 versões.
        if isinstance(stored.get("trackUrl"), str) and stored["trackUrl"].startswith("data:"):
            stored["trackUrl"] = None
            stored["trackDropped"] = True
        entries.append({"savedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"), "action": action, "edit": stored})
        history[video_id] = entries[-MAX_HISTORY:]
        self._write_json(self._history_path, history)

    def history(self, video_id: str) -> list:
        """Versões salvas deste clip, da mais nova para a mais antiga."""
        with self._lock:
            entries = self._read_history().get(video_id)
        return list(reversed(entries)) if isinstance(entries, list) else []

    def put(self, video_id: str, raw: Any) -> Dict[str, Any]:
        edit = sanitize_edit(video_id, raw)
        with self._lock:
            data = self._read()
            if data.get(video_id) == edit:
                return edit  # nada mudou: não regrava nem polui o histórico
            data[video_id] = edit
            self._write(data)
            self._record_history(video_id, edit, "save")
        return edit

    def delete(self, video_id: str) -> bool:
        with self._lock:
            data = self._read()
            if video_id not in data:
                return False
            previous = data.pop(video_id)
            self._write(data)
            self._record_history(video_id, previous, "delete")
            return True

    def apply_to_clip(self, clip: Dict[str, Any]) -> Dict[str, Any]:
        """Devolve uma cópia do clip com a edição salva aplicada (espelha applyVideoEdit do frontend)."""
        video_id = clip.get("videoId")
        edit = self.get(video_id) if isinstance(video_id, str) else None
        if not edit:
            return clip

        out = dict(clip)
        playback = dict(out.get("playback") or {})
        if edit["segments"]:
            out["segments"] = edit["segments"]
            out["startSec"] = min(s["startSec"] for s in edit["segments"])
            out["endSec"] = max(s["endSec"] for s in edit["segments"])
            playback["startSec"] = out["startSec"]
            playback["endSec"] = out["endSec"]
        if edit["transitionMs"]:
            out["transitionMs"] = edit["transitionMs"]
            playback["transitionMs"] = edit["transitionMs"]
        if playback:
            out["playback"] = playback
        out["audio"] = {
            **(clip.get("audio") or {}),
            "mode": edit["audioMode"],
            "volume": edit["volume"],
            "trackUrl": edit["trackUrl"] or "",
            "trackLoop": edit["trackLoop"],
        }
        return out


_store: Optional[VideoEditStore] = None


def get_video_edit_store() -> VideoEditStore:
    global _store
    if _store is None:
        _store = VideoEditStore()
    return _store
