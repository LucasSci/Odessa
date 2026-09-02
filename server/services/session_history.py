"""Histórico de sessão da live — registro central de tudo que acontece durante a live.

Persiste eventos em arquivos JSONL rotacionados por sessão em
``server/runtime/session-history/`` e permite exportar em JSON ou CSV.

Tipos de evento registrados:
- session.started / session.ended
- chat.received / gift.received
- trigger.fired
- video.generated
- ai.reply / ai.reply.sent
- message.sent

O serviço é totalmente defensivo: falhas de histórico nunca interrompem o
fluxo da live (chat, vídeo, automação).
"""

import csv
import io
import json
import logging
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from server.config import RUNTIME_DIR

logger = logging.getLogger("odessa.session_history")

# Tipos de evento aceitos pelo serviço (usado para validar registros externos).
EVENT_TYPES = {
    "session.started",
    "session.ended",
    "chat.received",
    "gift.received",
    "trigger.fired",
    "video.generated",
    "ai.reply",
    "ai.reply.sent",
    "message.sent",
}

# Colunas comuns do CSV (extraídas de data quando presentes) + data_json.
CSV_COLUMNS = [
    "id",
    "sessionId",
    "type",
    "timestamp",
    "user",
    "text",
    "giftName",
    "quantity",
    "videoId",
    "prompt",
    "reply",
    "status",
    "error",
    "data_json",
]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class SessionHistoryService:
    """Registra e exporta o histórico de eventos de uma sessão de live."""

    def __init__(self, base_dir: Path | None = None):
        self.dir = base_dir or (RUNTIME_DIR / "session-history")
        self.dir.mkdir(parents=True, exist_ok=True)
        self.sessions_file = self.dir / "sessions.json"
        self._lock = threading.RLock()
        self.session_id: Optional[str] = None
        self.started_at: Optional[str] = None
        self.recent_events: List[Dict[str, Any]] = []
        self.max_buffer_size = 200

    # ── Ciclo de vida da sessão ────────────────────────────────────────────

    def _ensure_session(self) -> str:
        """Cria a sessão ativa se ainda não existir e retorna o id."""
        if self.session_id:
            return self.session_id
        with self._lock:
            if self.session_id:
                return self.session_id
            self.session_id = f"session_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
            self.started_at = _now()
            self._write_event(
                {
                    "id": f"evt-{uuid.uuid4().hex[:12]}",
                    "sessionId": self.session_id,
                    "type": "session.started",
                    "timestamp": self.started_at,
                    "data": {"startedAt": self.started_at},
                }
            )
            self._update_sessions_index()
            logger.info("Session history started: %s", self.session_id)
            return self.session_id

    def start_session(self) -> Dict[str, Any]:
        """Inicia (ou reinicia) uma sessão explicitamente."""
        with self._lock:
            self.session_id = None
            self.started_at = None
        sid = self._ensure_session()
        return {"sessionId": sid, "startedAt": self.started_at}

    def end_session(self) -> Dict[str, Any]:
        """Encerra a sessão ativa, gravando session.ended."""
        sid = self._ensure_session()
        ended_at = _now()
        self.record(
            "session.ended",
            {"endedAt": ended_at, "totalEvents": self._count_events(sid)},
        )
        with self._lock:
            self.session_id = None
            self.started_at = None
        return {"sessionId": sid, "endedAt": ended_at}

    # ── Registro ───────────────────────────────────────────────────────────

    def record(
        self,
        event_type: str,
        data: Optional[Dict[str, Any]] = None,
        *,
        session_id: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Registra um evento. Nunca lança exceção (defensivo)."""
        try:
            if event_type not in EVENT_TYPES:
                logger.warning("Ignoring unknown session event type: %s", event_type)
                return None
            sid = session_id or self._ensure_session()
            event = {
                "id": f"evt-{uuid.uuid4().hex[:12]}",
                "sessionId": sid,
                "type": event_type,
                "timestamp": _now(),
                "data": data or {},
            }
            self._write_event(event)
            return event
        except Exception as exc:  # noqa: BLE001
            logger.warning("Failed to record session event %s: %s", event_type, exc)
            return None

    def _write_event(self, event: Dict[str, Any]) -> None:
        with self._lock:
            line = json.dumps(event, ensure_ascii=False)
            path = self._session_file(event["sessionId"])
            with open(path, "a", encoding="utf-8") as f:
                f.write(line + "\n")
            self.recent_events.insert(0, event)
            if len(self.recent_events) > self.max_buffer_size:
                self.recent_events.pop()
            self._update_sessions_index()

    def _session_file(self, session_id: str) -> Path:
        return self.dir / f"{session_id}.jsonl"

    def _update_sessions_index(self) -> None:
        try:
            sessions = self._load_sessions()
            sid = self.session_id
            if sid:
                sessions[sid] = {
                    "sessionId": sid,
                    "startedAt": self.started_at or _now(),
                    "endedAt": None,
                    "eventCount": self._count_events(sid),
                }
            self.sessions_file.write_text(
                json.dumps(sessions, indent=2, ensure_ascii=False), encoding="utf-8"
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("Failed to update sessions index: %s", exc)

    def _load_sessions(self) -> Dict[str, Any]:
        try:
            if not self.sessions_file.exists():
                return {}
            data = json.loads(self.sessions_file.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}

    def _count_events(self, session_id: str) -> int:
        path = self._session_file(session_id)
        if not path.exists():
            return 0
        try:
            return sum(1 for _ in path.open(encoding="utf-8"))
        except Exception:
            return 0

    # ── Leitura ────────────────────────────────────────────────────────────

    def _read_events(self, session_id: str) -> List[Dict[str, Any]]:
        path = self._session_file(session_id)
        if not path.exists():
            return []
        events: List[Dict[str, Any]] = []
        try:
            for line in path.open(encoding="utf-8"):
                line = line.strip()
                if not line:
                    continue
                try:
                    events.append(json.loads(line))
                except Exception:
                    continue
        except Exception as exc:
            logger.warning("Failed to read session events %s: %s", session_id, exc)
        return events

    def list_events(
        self,
        session_id: Optional[str] = None,
        event_type: Optional[str] = None,
        limit: int = 500,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        if session_id:
            events = self._read_events(session_id)
        else:
            events = list(self.recent_events)
        if event_type:
            events = [e for e in events if e.get("type") == event_type]
        events.sort(key=lambda e: e.get("timestamp", ""), reverse=True)
        return events[offset : offset + limit]

    def list_sessions(self) -> List[Dict[str, Any]]:
        sessions = self._load_sessions()
        return sorted(
            sessions.values(),
            key=lambda s: s.get("startedAt", ""),
            reverse=True,
        )

    def get_summary(self, session_id: Optional[str] = None) -> Dict[str, Any]:
        events = self.list_events(session_id=session_id, limit=100000)
        counts: Dict[str, int] = {}
        for e in events:
            t = e.get("type", "unknown")
            counts[t] = counts.get(t, 0) + 1
        return {
            "sessionId": session_id or self.session_id,
            "totalEvents": len(events),
            "byType": counts,
        }

    # ── Exportação ─────────────────────────────────────────────────────────

    def export_json(self, session_id: Optional[str] = None) -> Dict[str, Any]:
        sid = session_id or self.session_id
        events = self._read_events(sid) if sid else list(self.recent_events)
        sessions = self._load_sessions()
        session_meta = sessions.get(sid, {}) if sid else {}
        return {
            "session": {
                "sessionId": sid,
                "startedAt": session_meta.get("startedAt"),
                "endedAt": session_meta.get("endedAt"),
                "eventCount": len(events),
            },
            "events": events,
        }

    def export_csv(self, session_id: Optional[str] = None) -> str:
        data = self.export_json(session_id)
        events = data["events"]
        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=CSV_COLUMNS, extrasaction="ignore")
        writer.writeheader()
        for e in events:
            d = e.get("data") or {}
            row = {
                "id": e.get("id", ""),
                "sessionId": e.get("sessionId", ""),
                "type": e.get("type", ""),
                "timestamp": e.get("timestamp", ""),
                "user": d.get("user", d.get("username", d.get("sender", ""))),
                "text": d.get("text", d.get("sourceText", "")),
                "giftName": d.get("giftName", ""),
                "quantity": d.get("quantity", ""),
                "videoId": d.get("videoId", ""),
                "prompt": d.get("prompt", ""),
                "reply": d.get("reply", ""),
                "status": d.get("status", ""),
                "error": d.get("error", ""),
                "data_json": json.dumps(d, ensure_ascii=False),
            }
            writer.writerow(row)
        return buf.getvalue()


# Singleton instance
session_history = SessionHistoryService()
