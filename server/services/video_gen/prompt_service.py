"""
prompt_service.py — Buffer de interações de chat + geração de prompts via RouteLLM.

Mantém um buffer de sessão das interações de chat (mensagens + gatilhos) por
persona. Quando o buffer atinge o limiar (VIDEO_GEN_PROMPT_THRESHOLD) ou é
solicitado, gera um prompt de geração de vídeo via RouteLLM e o persiste em
prompts.jsonl.
"""
from __future__ import annotations

import logging
import threading
from typing import Any, Dict, List, Optional

from server.config import (
    VIDEO_GEN_PROMPT_THRESHOLD,
    VIDEO_GEN_AUTO,
)
from server.services.video_gen import storage

logger = logging.getLogger("odessa.video_gen.prompt")

MAX_BUFFER = 40


class PromptService:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        # buffer por persona_id -> lista de interações
        self._buffers: Dict[str, List[Dict[str, Any]]] = {}

    # ── Buffer de interações ────────────────────────────────────────────────
    def add_interaction(self, event: Dict[str, Any], persona_id: Optional[str] = None) -> None:
        """Alimenta o buffer com uma interação de chat (mensagem/gatilho)."""
        pid = persona_id or storage.get_active_persona_id()
        kind = event.get("kind") or event.get("type") or "chat"
        if kind not in {"chat", "gift", "alert", "comment"}:
            return
        interaction = {
            "kind": kind,
            "user": event.get("user") or event.get("sender") or event.get("username") or "",
            "text": event.get("message") or event.get("text") or event.get("giftName") or "",
            "giftName": event.get("giftName"),
            "timestamp": event.get("timestamp"),
        }
        with self._lock:
            buf = self._buffers.setdefault(pid, [])
            buf.append(interaction)
            if len(buf) > MAX_BUFFER:
                del buf[: len(buf) - MAX_BUFFER]

    def get_buffer(self, persona_id: Optional[str] = None) -> List[Dict[str, Any]]:
        pid = persona_id or storage.get_active_persona_id()
        with self._lock:
            return list(self._buffers.get(pid, []))

    def clear_buffer(self, persona_id: Optional[str] = None) -> None:
        pid = persona_id or storage.get_active_persona_id()
        with self._lock:
            self._buffers[pid] = []

    def buffer_size(self, persona_id: Optional[str] = None) -> int:
        return len(self.get_buffer(persona_id))

    def should_auto_generate(self, persona_id: Optional[str] = None) -> bool:
        """True quando o buffer atingiu o limiar e a geração automática está ativa."""
        if not VIDEO_GEN_AUTO:
            return False
        return self.buffer_size(persona_id) >= VIDEO_GEN_PROMPT_THRESHOLD

    # ── Geração de prompt ───────────────────────────────────────────────────
    def _build_prompt_text(self, interactions: List[Dict[str, Any]]) -> str:
        lines = []
        for it in interactions:
            if it.get("kind") == "gift":
                lines.append(f"[presente] {it.get('user') or 'alguém'} enviou {it.get('giftName') or it.get('text')}")
            elif it.get("user"):
                lines.append(f"{it.get('user')}: {it.get('text')}")
            else:
                lines.append(it.get("text") or "")
        return "\n".join(lines) if lines else ""

    def _detect_video_type(self, interactions: List[Dict[str, Any]]) -> str:
        """Infere o tipo de vídeo a partir das interações do chat."""
        has_gift = any(it.get("kind") == "gift" for it in interactions)
        if has_gift:
            return "GATILHO"
        return "FLUXO"

    def generate_prompt(
        self,
        persona_id: Optional[str] = None,
        *,
        force: bool = False,
        custom_instruction: Optional[str] = None,
        video_type: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Gera um prompt de vídeo a partir do buffer de interações via RouteLLM.

        Usa o template da persona ativa para o tipo de vídeo detectado,
        preenchendo os placeholders com os assets (rostos, ambiente, roupas).
        O LLM gera apenas a descrição da ação, que é inserida no template.
        """
        pid = persona_id or storage.get_active_persona_id()
        interactions = self.get_buffer(pid)
        if not interactions and not force:
            return {"ok": False, "error": "Buffer de interações vazio"}

        chat_text = self._build_prompt_text(interactions)
        detected_type = video_type or self._detect_video_type(interactions)

        # Gera a descrição da ação via LLM
        system_prompt = (
            "Você é a diretora de cena de uma streamer ao vivo. A partir das "
            "interações recentes do chat, escreva UMA descrição curta de ação "
            "(máx. 40 palavras, em português) para o vídeo. Descreva apenas a "
            "emoção, o movimento e o clima — NÃO descreva a pessoa, o ambiente "
            "ou a roupa (esses vêm do template). Responda apenas com a descrição, "
            "sem aspas nem explicações."
        )
        user_prompt = f"Interações recentes do chat:\n{chat_text}"
        if custom_instruction:
            user_prompt += f"\n\nInstrução extra: {custom_instruction}"

        action_text = self._call_llm(system_prompt, user_prompt)
        if not action_text:
            action_text = self._fallback_prompt(interactions)

        # Renderiza o template da persona com os assets preenchidos
        try:
            from server.core.persona_templates import render_template
            prompt_text = render_template(pid, detected_type, action_text)
        except Exception as exc:
            logger.warning("Falha ao renderizar template, usando ação direta: %s", exc)
            prompt_text = action_text

        record = {
            "personaId": pid,
            "prompt": prompt_text.strip(),
            "videoType": detected_type,
            "source": "routellm" if action_text else "fallback",
            "interactions": interactions,
            "customInstruction": custom_instruction,
        }
        saved = storage.append_prompt(record, persona_id=pid)
        self.clear_buffer(pid)
        return {"ok": True, "prompt": saved}

    def _call_llm(self, system_prompt: str, user_prompt: str) -> str:
        try:
            from server.services.ai_service import ai_service

            text, _provider = ai_service.generate_ai_text_with_fallback(
                gemini_model="gemini-2.5-flash",
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                temperature=0.8,
            )
            return (text or "").strip()
        except Exception as exc:  # noqa: BLE001
            logger.warning("Falha ao gerar prompt via LLM: %s", exc)
            return ""

    def _fallback_prompt(self, interactions: List[Dict[str, Any]]) -> str:
        gifts = [it for it in interactions if it.get("kind") == "gift"]
        if gifts:
            names = ", ".join({it.get("giftName") or it.get("text") for it in gifts})
            return f"Reação animada e agradecida ao presente: {names}. Sorriso, energia alta, clima festivo."
        return "Reação natural e carismática às mensagens do chat, com energia positiva e olhar para a câmera."


prompt_service = PromptService()
