import logging
import json
import re
import time
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any

from server.core.database import db
from server.config import ODESSA_DB_PATH

logger = logging.getLogger("odessa.memory")

class MemoryService:
    def normalize_user_id(self, username: str) -> str:
        normalized = re.sub(r"[^0-9a-zA-Z_.-]+", "-", username.strip().lower()).strip("-")
        return normalized or f"user-{int(time.time() * 1000)}"

    def extract_username_from_event(self, event: Dict[str, Any]) -> Optional[str]:
        metadata = event.get("metadata") if isinstance(event.get("metadata"), dict) else {}
        for key in ("user", "username", "sender", "author"):
            value = metadata.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip().lstrip("@")

        text = str(event.get("text") or "").strip()
        patterns = [
            r"^@?([A-Za-zÀ-ÿ0-9_.-]{2,32})\s*(?:[:\-]|disse|falou|comentou|enviou|mandou|deu|resgatou|pediu)\b",
            r"\bde\s+@?([A-Za-zÀ-ÿ0-9_.-]{2,32})\b",
        ]
        for pattern in patterns:
            match = re.search(pattern, text, flags=re.IGNORECASE)
            if match:
                return match.group(1).strip().lstrip("@")
        return None

    def numeric_metadata_value(self, metadata: Dict[str, Any], key: str, default: int = 0) -> int:
        value = metadata.get(key, default)
        try:
            return max(0, int(value))
        except (TypeError, ValueError):
            return default

    def summarize_memory_users(self, users: List[Dict[str, Any]]) -> str:
        if not users:
            return ""

        lines = []
        for user in users[:8]:
            recurring = "recorrente" if user.get("returning") else "novo na memoria"
            gifts = int(user.get("totalGifts") or 0)
            interactions = int(user.get("interactions") or 0)
            details = [f"{user.get('username')} e {recurring}"]
            if gifts:
                details.append(f"ja enviou {gifts} presente(s)")
            if interactions:
                details.append(f"tem {interactions} interacao(oes) registradas")
            lines.append("- " + "; ".join(details))
        return "Usuarios reconhecidos nesta rodada:\n" + "\n".join(lines)

    def get_memory_stats(self) -> Dict[str, Any]:
        try:
            with db.get_connection() as connection:
                users = connection.execute("SELECT COUNT(*) AS count FROM users").fetchone()
                interactions = connection.execute(
                    "SELECT COUNT(*) AS count FROM interaction_logs"
                ).fetchone()
                gifts = connection.execute(
                    "SELECT COALESCE(SUM(total_gifts), 0) AS total FROM users"
                ).fetchone()
            return {
                "usersRecognized": int(users["count"] if users else 0),
                "interactions": int(interactions["count"] if interactions else 0),
                "gifts": int(gifts["total"] if gifts else 0),
                "dbPath": str(ODESSA_DB_PATH),
            }
        except Exception as exc:
            logger.warning("Could not read memory stats: %s", exc)
            return {"usersRecognized": 0, "interactions": 0, "gifts": 0}

    def list_profiles(self, query: str = "", limit: int = 50, include_hidden: bool = False) -> Dict[str, Any]:
        clean_query = f"%{query.strip()}%"
        where = []
        params: list[Any] = []
        if query.strip():
            where.append("(username LIKE ? OR id LIKE ?)")
            params.extend([clean_query, clean_query])
        if not include_hidden:
            where.append("COALESCE(hidden, 0) = 0")
        clause = f"WHERE {' AND '.join(where)}" if where else ""
        sql = f"""
            SELECT id, username, first_seen, last_seen, total_messages, total_gifts, sentiment,
                   COALESCE(hidden, 0) AS hidden, COALESCE(notes, '') AS notes
            FROM users
            {clause}
            ORDER BY last_seen DESC
            LIMIT ?
        """
        params.append(max(1, min(int(limit or 50), 200)))
        with db.get_connection() as connection:
            rows = connection.execute(sql, params).fetchall()
        return {"profiles": [dict(row) for row in rows], "total": len(rows)}

    def get_profile(self, user_id: str, limit: int = 40) -> Dict[str, Any] | None:
        normalized = self.normalize_user_id(user_id)
        with db.get_connection() as connection:
            user = connection.execute(
                """
                SELECT id, username, first_seen, last_seen, total_messages, total_gifts, sentiment,
                       COALESCE(hidden, 0) AS hidden, COALESCE(notes, '') AS notes
                FROM users WHERE id = ? OR lower(username) = lower(?)
                """,
                (normalized, user_id),
            ).fetchone()
            if not user:
                return None
            interactions = connection.execute(
                """
                SELECT id, kind, source, text, metadata_json, sentiment, created_at
                FROM interaction_logs
                WHERE user_id = ?
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (user["id"], max(1, min(int(limit or 40), 200))),
            ).fetchall()
        return {"profile": dict(user), "interactions": [dict(row) for row in interactions]}

    def build_user_context(self, user_id: str, limit: int = 12) -> Dict[str, Any]:
        profile = self.get_profile(user_id, limit)
        if not profile:
            return {"found": False, "context": "", "profile": None, "interactions": []}
        user = profile["profile"]
        interactions = profile["interactions"]
        lines = [
            f"Usuario @{user['username']}: {user['total_messages']} mensagens, {user['total_gifts']} presentes.",
        ]
        if user.get("notes"):
            lines.append(f"Notas: {user['notes']}")
        if interactions:
            lines.append("Interacoes recentes:")
            for item in interactions[:limit]:
                lines.append(f"- [{item['kind']}] {item['text']}")
        return {
            "found": True,
            "context": "\n".join(lines),
            "profile": user,
            "interactions": interactions,
        }

    def hide_profile(self, user_id: str, hidden: bool = True) -> Dict[str, Any]:
        normalized = self.normalize_user_id(user_id)
        with db.get_connection() as connection:
            connection.execute(
                "UPDATE users SET hidden = ? WHERE id = ? OR lower(username) = lower(?)",
                (1 if hidden else 0, normalized, user_id),
            )
            connection.commit()
        return {"status": "hidden" if hidden else "visible", "userId": user_id}

    def clear_profile(self, user_id: str) -> Dict[str, Any]:
        normalized = self.normalize_user_id(user_id)
        with db.get_connection() as connection:
            user = connection.execute(
                "SELECT id FROM users WHERE id = ? OR lower(username) = lower(?)",
                (normalized, user_id),
            ).fetchone()
            if not user:
                return {"status": "not_found", "userId": user_id}
            connection.execute("DELETE FROM interaction_logs WHERE user_id = ?", (user["id"],))
            connection.execute("DELETE FROM users WHERE id = ?", (user["id"],))
            connection.commit()
        return {"status": "cleared", "userId": user_id}

    def upsert_round_memory(self, events: List[Dict[str, Any]]) -> Dict[str, Any]:
        recognized_users = []
        now = datetime.now(timezone.utc).isoformat()

        with db.get_connection() as connection:
            for event in events:
                username = self.extract_username_from_event(event)
                if not username:
                    continue

                user_id = self.normalize_user_id(username)
                metadata = event.get("metadata") if isinstance(event.get("metadata"), dict) else {}
                is_gift = event.get("kind") == "gift"
                gift_count = self.numeric_metadata_value(metadata, "quantity", 1) if is_gift else 0

                # User Upsert
                user = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
                if user:
                    connection.execute(
                        """
                        UPDATE users
                        SET last_seen = ?,
                            total_messages = total_messages + 1,
                            total_gifts = total_gifts + ?
                        WHERE id = ?
                        """,
                        (now, gift_count, user_id),
                    )
                    returning = True
                else:
                    connection.execute(
                        """
                        INSERT INTO users (id, username, first_seen, last_seen, total_messages, total_gifts)
                        VALUES (?, ?, ?, ?, 1, ?)
                        """,
                        (user_id, username, now, now, gift_count),
                    )
                    returning = False

                # Log interaction
                log_id = f"log-{int(time.time() * 1000)}-{user_id[:8]}"
                connection.execute(
                    """
                    INSERT INTO interaction_logs (id, user_id, username, kind, source, text, metadata_json, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        log_id,
                        user_id,
                        username,
                        event.get("kind", "unknown"),
                        event.get("source", "unknown"),
                        event.get("text", ""),
                        json.dumps(metadata),
                        event.get("createdAt", now),
                    ),
                )

                # Add to round summary
                if not any(u["id"] == user_id for u in recognized_users):
                    recognized_users.append(
                        {
                            "id": user_id,
                            "username": username,
                            "returning": returning,
                            "interactions": (user["total_messages"] + 1) if user else 1,
                            "totalGifts": (user["total_gifts"] + gift_count) if user else gift_count,
                        }
                    )

            connection.commit()

        return {
            "usersRecognized": len(recognized_users),
            "users": recognized_users,
            "context": self.summarize_memory_users(recognized_users),
        }

# Singleton instance
memory_service = MemoryService()
