"""
storage.py — Persistência por persona do pipeline de geração de vídeo.

Estrutura em disco (por persona ativa):
    server/runtime/video-gen/{persona_id}/
        prompts.jsonl        # prompts gerados a partir do chat
        frames/latest.{png|jpg}  # último frame base capturado
        frames/history/      # histórico de frames
        videos/              # vídeos gerados
        queue.json           # fila de vídeos pendentes
        history.json         # histórico de gerações
"""
from __future__ import annotations

import base64
import json
import logging
import re
import shutil
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from server.config import ODESSA_VIDEO_GEN_DIR, VIDEO_GEN_FRAME_FORMAT
from server.core.persona_manager import get_active_persona_id

logger = logging.getLogger("odessa.video_gen.storage")

MAX_PROMPTS = 200
MAX_HISTORY = 200
MAX_FRAME_HISTORY = 50


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.strip().lower()).strip("-") or "persona"


def persona_dir(persona_id: Optional[str] = None) -> Path:
    pid = persona_id or get_active_persona_id()
    return ODESSA_VIDEO_GEN_DIR / _slug(pid)


def _ensure_dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


def frames_dir(persona_id: Optional[str] = None) -> Path:
    return _ensure_dir(persona_dir(persona_id) / "frames")


def videos_dir(persona_id: Optional[str] = None) -> Path:
    return _ensure_dir(persona_dir(persona_id) / "videos")


def frame_format() -> str:
    fmt = (VIDEO_GEN_FRAME_FORMAT or "png").strip().lower()
    return "jpg" if fmt in {"jpg", "jpeg"} else "png"


# ── Frames ─────────────────────────────────────────────────────────────────
def save_frame(data: bytes, persona_id: Optional[str] = None) -> Path:
    """Salva o frame base capturado como latest e no histórico."""
    fmt = frame_format()
    frames = frames_dir(persona_id)
    latest = frames / f"latest.{fmt}"
    latest.write_bytes(data)

    history = _ensure_dir(frames / "history")
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    hist_path = history / f"frame-{stamp}-{uuid.uuid4().hex[:6]}.{fmt}"
    hist_path.write_bytes(data)

    # Mantém o histórico limitado.
    existing = sorted(history.glob(f"frame-*.{fmt}"))
    for old in existing[:-MAX_FRAME_HISTORY]:
        try:
            old.unlink()
        except OSError:
            pass
    return latest


def save_frame_from_data_url(data_url: str, persona_id: Optional[str] = None) -> Path:
    """Decodifica um data URL (ex.: canvas.toDataURL) e salva o frame."""
    if "," in data_url:
        data_url = data_url.split(",", 1)[1]
    data = base64.b64decode(data_url)
    return save_frame(data, persona_id=persona_id)


def get_latest_frame(persona_id: Optional[str] = None) -> Optional[Path]:
    frames = frames_dir(persona_id)
    for fmt in ("png", "jpg"):
        candidate = frames / f"latest.{fmt}"
        if candidate.exists():
            return candidate
    return None


def list_frame_history(persona_id: Optional[str] = None) -> List[str]:
    history = frames_dir(persona_id) / "history"
    if not history.exists():
        return []
    return sorted(str(p.name) for p in history.glob("frame-*"))


# ── Prompts ────────────────────────────────────────────────────────────────
def append_prompt(record: Dict[str, Any], persona_id: Optional[str] = None) -> Dict[str, Any]:
    """Adiciona um prompt ao buffer persistido (JSONL)."""
    d = persona_dir(persona_id)
    _ensure_dir(d)
    record = {**record, "id": record.get("id") or str(uuid.uuid4()), "createdAt": record.get("createdAt") or _now()}
    path = d / "prompts.jsonl"
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")
    _trim_jsonl(path, MAX_PROMPTS)
    return record


def get_prompts(persona_id: Optional[str] = None) -> List[Dict[str, Any]]:
    path = persona_dir(persona_id) / "prompts.jsonl"
    if not path.exists():
        return []
    records: List[Dict[str, Any]] = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return records


def _trim_jsonl(path: Path, limit: int) -> None:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
        if len(lines) > limit:
            path.write_text("\n".join(lines[-limit:]) + "\n", encoding="utf-8")
    except OSError:
        pass


# ── Fila de vídeos ─────────────────────────────────────────────────────────
def save_queue(queue: List[Dict[str, Any]], persona_id: Optional[str] = None) -> None:
    d = persona_dir(persona_id)
    _ensure_dir(d)
    with open(d / "queue.json", "w", encoding="utf-8") as f:
        json.dump(queue, f, indent=2, ensure_ascii=False)


def get_queue(persona_id: Optional[str] = None) -> List[Dict[str, Any]]:
    path = persona_dir(persona_id) / "queue.json"
    if not path.exists():
        return []
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, OSError):
        return []


# ── Histórico de gerações ──────────────────────────────────────────────────
def append_history(record: Dict[str, Any], persona_id: Optional[str] = None) -> Dict[str, Any]:
    d = persona_dir(persona_id)
    _ensure_dir(d)
    path = d / "history.json"
    history: List[Dict[str, Any]] = []
    if path.exists():
        try:
            with open(path, "r", encoding="utf-8") as f:
                history = json.load(f)
        except (json.JSONDecodeError, OSError):
            history = []
    if not isinstance(history, list):
        history = []
    record = {**record, "id": record.get("id") or str(uuid.uuid4()), "createdAt": record.get("createdAt") or _now()}
    history.append(record)
    history = history[-MAX_HISTORY:]
    with open(path, "w", encoding="utf-8") as f:
        json.dump(history, f, indent=2, ensure_ascii=False)
    return record


def get_history(persona_id: Optional[str] = None) -> List[Dict[str, Any]]:
    path = persona_dir(persona_id) / "history.json"
    if not path.exists():
        return []
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, OSError):
        return []


# ── Vídeos gerados ─────────────────────────────────────────────────────────
def save_generated_video(source: Path, video_id: str, persona_id: Optional[str] = None) -> Path:
    """Copia um vídeo gerado para o diretório de vídeos da persona."""
    videos = videos_dir(persona_id)
    suffix = source.suffix.lower() or ".mp4"
    if suffix not in {".mp4", ".webm"}:
        suffix = ".mp4"
    target = videos / f"{video_id}{suffix}"
    shutil.copyfile(str(source), str(target))
    return target


def list_generated_videos(persona_id: Optional[str] = None) -> List[Dict[str, Any]]:
    videos = videos_dir(persona_id)
    out: List[Dict[str, Any]] = []
    for p in sorted(videos.glob("*")):
        if p.suffix.lower() not in {".mp4", ".webm"}:
            continue
        out.append(
            {
                "id": p.stem,
                "filename": p.name,
                "path": str(p),
                "sizeBytes": p.stat().st_size,
                "playUrl": f"/api/video-gen/video/{p.stem}",
            }
        )
    return out
