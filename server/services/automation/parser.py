import logging
import re
import unicodedata
from datetime import datetime
from typing import Any, Dict, List, Optional

logger = logging.getLogger("odessa.automation.parser")


class EventParser:
    """
    Transforms raw OCR/chat text into normalized LiveEvents.

    Events carry both UI names and trigger-engine names so callers can inspect
    the same object without translating between contracts.
    """

    def __init__(self):
        self.moderation_patterns = [
            r"compre seguidores",
            r"seguidor barato",
            r"www\.[a-z0-9-]+\.[a-z]{2,}",
            r"http[s]?://",
            r"ganhe dinheiro",
            r"promocao exclusiva",
            r"promo.*exclusiva",
        ]
        self.chat_pattern = r"^@(?P<user>[a-zA-Z0-9_.-]+):\s*(?P<message>.+)"
        self.redeem_pattern = r"^(?P<sender>[^:@]{2,40}?)\s+resgatou\s*:?\s*(?P<giftName>.+)$"
        self.gift_pattern = (
            r"^(?P<sender>[^:@]{2,40}?)\s+"
            r"(?P<verb>enviou|envlou|env1ou|sent|sent you|mandou|presenteou(?:\s+com)?|gave|gifted)\s+"
            r"(?P<giftName>.+?)(?:\s*(?:x|\*|×)\s*(?P<quantity>\d+)|\s+(?P<trailingQuantity>\d+)\s*(?:x|un|unds|unidades)?)?$"
        )
        self.compact_gift_pattern = (
            r"^(?P<sender>[^:@]{2,40}?)\s+"
            r"(?P<giftName>[a-zA-ZÀ-ÿ0-9 _.-]{2,60}?)\s*"
            r"(?:x|\*|×)\s*(?P<quantity>\d+)$"
        )
        self.alert_patterns = [
            (r"Novo seguidor:\s*(?P<user>.+?)\s+(?:comecou a seguir|entrou na live agora)", "new_follower"),
            (r"(?P<user>.+?)\s+e novo seguidor", "new_follower"),
        ]
        self.normalization_map = {
            "Rosa": ["rosa", "rose", "ro5a"],
            "Leao": ["leao", "lion", "leo"],
            "Coracao": ["coracao", "heart", "coraco"],
            "Foguete": ["foguete", "rocket"],
            "Diamante": ["diamante", "diamond"],
            "Coroa": ["coroa", "crown"],
        }
        self.ocr_replacements = {
            "envlou": "enviou",
            "env1ou": "enviou",
            "coragao": "coracao",
            "coraçao": "coracao",
            "ros4": "rosa",
            "ro5a": "rosa",
            "leäo": "leao",
        }

    def parse_text(
        self,
        raw_text: str,
        hint_kind: Optional[str] = None,
        zone_name: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> List[Dict[str, Any]]:
        events: List[Dict[str, Any]] = []
        lines = [line.strip() for line in raw_text.split("\n") if line.strip()]
        for line in lines:
            event = self._classify_line(
                line,
                hint_kind=hint_kind,
                zone_name=zone_name,
                metadata=metadata or {},
            )
            if event:
                events.append(event)
        return events

    def _classify_line(
        self,
        line: str,
        hint_kind: Optional[str] = None,
        zone_name: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Optional[Dict[str, Any]]:
        text = self._clean_prefix(line, zone_name)
        metadata = metadata or {}

        if self._is_moderation(text):
            return self._event(
                {"kind": "moderation", "type": "moderation", "reason": "spam_suspicious_pattern"},
                text,
            )

        chat_match = re.search(self.chat_pattern, text, re.IGNORECASE)
        if chat_match:
            return self._event(
                {
                    "kind": "chat",
                    "type": "comment",
                    "user": chat_match.group("user").strip(),
                    "message": chat_match.group("message").strip(),
                },
                text,
            )

        redeem_match = re.search(self.redeem_pattern, text, re.IGNORECASE)
        if redeem_match:
            sender = redeem_match.group("sender").strip()
            gift_name = redeem_match.group("giftName").strip()
            folded_gift_name = self._ascii_fold(gift_name)
            normalized_gift_name = self.normalize_gift_name(gift_name)
            mapped_action = None
            requested_scene = None
            requested_track = None

            if re.search(r"trocar\s+cena", folded_gift_name, re.IGNORECASE):
                mapped_action = "obs.switch_scene"
                requested_scene = re.split(
                    r"trocar\s+cena\s*:?",
                    folded_gift_name,
                    flags=re.IGNORECASE,
                )[-1].strip()
            elif re.search(r"escolher\s+musica", folded_gift_name, re.IGNORECASE):
                mapped_action = "media.play_music"
                requested_track = re.split(
                    r"escolher\s+musica\s*:?",
                    folded_gift_name,
                    flags=re.IGNORECASE,
                )[-1].strip()

            return self._event(
                {
                    "kind": "gift",
                    "type": "gift",
                    "sender": sender,
                    "user": sender,
                    "receiver": "Odessa",
                    "giftName": normalized_gift_name,
                    "gift_key": self.gift_key_for(normalized_gift_name),
                    "quantity": 1,
                    "redeemable": True,
                    "mappedAction": mapped_action,
                    "requestedScene": requested_scene,
                    "requestedTrack": requested_track,
                },
                text,
            )

        gift_match = re.search(self.gift_pattern, self._repair_ocr_text(text), re.IGNORECASE)
        if gift_match:
            sender = gift_match.group("sender").strip()
            raw_gift_name = gift_match.group("giftName")
            if self._looks_like_non_gift_phrase(raw_gift_name):
                return self._event({"kind": "chat", "type": "comment", "message": text}, text)
            gift_name = self.normalize_gift_name(raw_gift_name)
            quantity = gift_match.group("quantity") or gift_match.group("trailingQuantity") or 1
            return self._event(
                {
                    "kind": "gift",
                    "type": "gift",
                    "sender": sender,
                    "user": sender,
                    "receiver": "Odessa",
                    "giftName": gift_name,
                    "gift_key": self.gift_key_for(gift_name),
                    "quantity": int(quantity),
                    "redeemable": False,
                },
                text,
            )

        compact_gift_match = re.search(self.compact_gift_pattern, self._repair_ocr_text(text), re.IGNORECASE)
        if compact_gift_match and not self._looks_like_non_gift_phrase(compact_gift_match.group("giftName")):
            sender = compact_gift_match.group("sender").strip()
            gift_name = self.normalize_gift_name(compact_gift_match.group("giftName"))
            return self._event(
                {
                    "kind": "gift",
                    "type": "gift",
                    "sender": sender,
                    "user": sender,
                    "receiver": "Odessa",
                    "giftName": gift_name,
                    "gift_key": self.gift_key_for(gift_name),
                    "quantity": int(compact_gift_match.group("quantity") or 1),
                    "redeemable": False,
                },
                text,
            )

        for pattern, alert_type in self.alert_patterns:
            alert_match = re.search(pattern, text, re.IGNORECASE)
            if alert_match:
                return self._event(
                    {
                        "kind": "alert",
                        "type": "alert",
                        "user": alert_match.group("user").strip(),
                        "alertType": alert_type,
                    },
                    text,
                )

        hinted_event = self._event_from_hint(text, hint_kind, zone_name, metadata)
        if hinted_event:
            return hinted_event

        lowered = self._ascii_fold(text).lower()
        if "live esta quieta" in lowered or "momento sem mensagens" in lowered:
            return self._event(
                {"kind": "system", "type": "system", "mappedAction": "topic.suggest"},
                text,
            )

        return self._event({"kind": "chat", "type": "comment", "message": text}, text)

    def normalize_gift_name(self, raw_name: str) -> str:
        clean_name = self._ascii_fold(self._repair_ocr_text(raw_name)).lower().strip(" :-•·")
        clean_name = re.sub(r"\b(?:x|\*)?\s*\d+\s*(?:x|un|unds|unidades)?\b", "", clean_name).strip()
        for standard, variations in self.normalization_map.items():
            if any(variation in clean_name for variation in variations):
                return standard
        return clean_name.title() if clean_name else raw_name.strip().title()

    def gift_key_for(self, gift_name: str) -> str:
        slug = re.sub(r"[^a-z0-9]+", ".", self._ascii_fold(gift_name).lower()).strip(".")
        return f"gift.{slug or 'unknown'}"

    def _event(self, event: Dict[str, Any], text: str) -> Dict[str, Any]:
        event.setdefault("raw", text)
        event.setdefault("text", text)
        event.setdefault("timestamp", datetime.now().isoformat())
        event.setdefault("type", event.get("kind", "unknown"))
        return event

    def _event_from_hint(
        self,
        text: str,
        hint_kind: Optional[str],
        zone_name: Optional[str],
        metadata: Dict[str, Any],
    ) -> Optional[Dict[str, Any]]:
        hint = self._ascii_fold(str(hint_kind or "")).lower().strip()

        if hint in {"gift", "gifts", "presente", "presentes"}:
            gift_text = re.sub(r"(?:x|\*)\s*(?P<quantity>\d+)\b", "", text, flags=re.IGNORECASE)
            gift_text = re.sub(r"\b(?P<quantity>\d+)\s*(?:x|un|unds|unidades)?\b", "", gift_text, flags=re.IGNORECASE)
            gift_name = self.normalize_gift_name(gift_text.strip(" :-") or text)
            quantity_match = re.search(
                r"(?:x|\*)\s*(?P<trailing>\d+)\b|\b(?P<leading>\d+)\s*(?:x|un|unds|unidades)?\b",
                self._ascii_fold(text),
                re.IGNORECASE,
            )
            quantity = int((quantity_match.group("trailing") or quantity_match.group("leading")) if quantity_match else 1)
            sender = str(metadata.get("sender") or metadata.get("user") or zone_name or "OCR").strip()
            return self._event(
                {
                    "kind": "gift",
                    "type": "gift",
                    "sender": sender,
                    "user": sender,
                    "receiver": "Odessa",
                    "giftName": gift_name,
                    "gift_key": self.gift_key_for(gift_name),
                    "quantity": quantity,
                    "redeemable": bool(metadata.get("redeemable", False)),
                    "zoneName": zone_name,
                },
                text,
            )

        if hint in {"alert", "alerts", "alerta", "alertas"}:
            return self._event(
                {
                    "kind": "alert",
                    "type": "alert",
                    "user": str(metadata.get("user") or text).strip(),
                    "alertType": str(metadata.get("alertType") or "ocr_alert"),
                    "zoneName": zone_name,
                },
                text,
            )

        return None

    def _clean_prefix(self, line: str, zone_name: Optional[str] = None) -> str:
        text = line.strip()
        if zone_name:
            text = re.sub(rf"^{re.escape(zone_name)}:\s*", "", text, flags=re.IGNORECASE)
        return re.sub(
            r"^(OCR|Chat|Presentes|Gifts|Alertas|Alerts):\s*",
            "",
            text,
            flags=re.IGNORECASE,
        ).strip()

    def _repair_ocr_text(self, value: str) -> str:
        text = re.sub(r"\s+", " ", value or "").strip()
        for wrong, right in self.ocr_replacements.items():
            text = re.sub(re.escape(wrong), right, text, flags=re.IGNORECASE)
        return text

    def _is_moderation(self, text: str) -> bool:
        folded = self._ascii_fold(text).lower()
        return any(re.search(pattern, folded, re.IGNORECASE) for pattern in self.moderation_patterns)

    def _looks_like_non_gift_phrase(self, gift_name: str) -> bool:
        folded = self._ascii_fold(gift_name).lower().strip()
        return folded in {
            "muito bem",
            "bem",
            "mal",
            "boa",
            "boa demais",
            "um salve",
            "uma mensagem",
            "recado",
        }

    def _ascii_fold(self, value: str) -> str:
        normalized = unicodedata.normalize("NFKD", value)
        return normalized.encode("ascii", "ignore").decode("ascii")


event_parser = EventParser()
