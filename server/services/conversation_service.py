import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from server.config import RUNTIME_DIR

logger = logging.getLogger("odessa.conversations")

CONVERSATIONS_FILE = RUNTIME_DIR / "conversations.json"


def get_ai_service():
    from server.services.ai_service import ai_service

    return ai_service


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class ConversationService:
    def __init__(self, path: Path = CONVERSATIONS_FILE):
        self.path = path

    def _load(self) -> dict[str, Any]:
        if not self.path.exists():
            return {"conversations": []}
        try:
            return json.loads(self.path.read_text(encoding="utf-8"))
        except Exception as exc:
            logger.warning("Could not load conversations: %s", exc)
            return {"conversations": []}

    def _save(self, data: dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")

    def list_conversations(self) -> list[dict[str, Any]]:
        return sorted(
            self._load().get("conversations", []),
            key=lambda item: item.get("updatedAt", ""),
            reverse=True,
        )

    def get_conversation(self, conversation_id: str) -> dict[str, Any] | None:
        return next(
            (item for item in self._load().get("conversations", []) if item.get("id") == conversation_id),
            None,
        )

    def create_conversation(
        self,
        *,
        participant_id: str,
        participant_name: str,
        source: str = "generic",
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        data = self._load()
        conversation = {
            "id": f"conv-{uuid.uuid4().hex[:12]}",
            "source": source,
            "participantId": participant_id,
            "participantName": participant_name or participant_id,
            "status": "open",
            "metadata": metadata or {},
            "messages": [],
            "createdAt": _now(),
            "updatedAt": _now(),
        }
        data.setdefault("conversations", []).append(conversation)
        self._save(data)
        return conversation

    def add_message(
        self,
        conversation_id: str,
        *,
        role: str,
        text: str,
        metadata: dict[str, Any] | None = None,
        status: str = "received",
    ) -> dict[str, Any]:
        data = self._load()
        for conversation in data.setdefault("conversations", []):
            if conversation.get("id") != conversation_id:
                continue
            message = {
                "id": f"msg-{uuid.uuid4().hex[:12]}",
                "role": role,
                "text": text,
                "status": status,
                "metadata": metadata or {},
                "createdAt": _now(),
            }
            conversation.setdefault("messages", []).append(message)
            conversation["updatedAt"] = message["createdAt"]
            self._save(data)
            return message
        raise KeyError(conversation_id)

    def generate_reply(
        self,
        conversation_id: str,
        *,
        persona_prompt: str,
        provider_model: str,
        temperature: float,
    ) -> dict[str, Any]:
        conversation = self.get_conversation(conversation_id)
        if not conversation:
            raise KeyError(conversation_id)
        history = "\n".join(
            f"{message.get('role')}: {message.get('text')}"
            for message in conversation.get("messages", [])[-12:]
        )
        prompt = (
            "Conversa privada 1-1. Responda em tom natural, seguro e coerente com Odessa.\n"
            f"Participante: {conversation.get('participantName')}\n"
            f"Historico recente:\n{history}\n\n"
            "Gere uma resposta curta pronta para aprovacao humana."
        )
        text, provider = get_ai_service().generate_ai_text_with_fallback(
            gemini_model=provider_model,
            system_prompt=persona_prompt,
            user_prompt=prompt,
            temperature=temperature,
        )
        message = self.add_message(
            conversation_id,
            role="assistant",
            text=text,
            status="draft",
            metadata={"provider": provider, "generated": True},
        )
        return {"message": message, "provider": provider}

    def approve_message(self, conversation_id: str, message_id: str) -> dict[str, Any]:
        data = self._load()
        for conversation in data.setdefault("conversations", []):
            if conversation.get("id") != conversation_id:
                continue
            for message in conversation.get("messages", []):
                if message.get("id") == message_id:
                    message["status"] = "approved"
                    message["approvedAt"] = _now()
                    conversation["updatedAt"] = message["approvedAt"]
                    self._save(data)
                    return message
        raise KeyError(message_id)


conversation_service = ConversationService()
