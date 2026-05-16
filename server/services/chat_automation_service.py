import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from server.config import RUNTIME_DIR


CONFIG_FILE = RUNTIME_DIR / "chat_automation.json"


class ChatAutomationService:
    def _empty(self) -> dict[str, Any]:
        return {"allowlist": [], "logs": []}

    def _load(self) -> dict[str, Any]:
        try:
            if not CONFIG_FILE.exists():
                return self._empty()
            data = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
            if not isinstance(data, dict):
                return self._empty()
            data.setdefault("allowlist", [])
            data.setdefault("logs", [])
            return data
        except Exception:
            return self._empty()

    def _save(self, data: dict[str, Any]) -> dict[str, Any]:
        CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
        CONFIG_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        return data

    def get_config(self) -> dict[str, Any]:
        data = self._load()
        return {"allowlist": data.get("allowlist", []), "logs": data.get("logs", [])[-100:]}

    def update_config(self, allowlist: list[dict[str, Any]]) -> dict[str, Any]:
        cleaned = []
        for entry in allowlist:
            if not isinstance(entry, dict):
                continue
            domain = str(entry.get("domain") or "").strip().lower()
            input_selector = str(entry.get("inputSelector") or "").strip()
            if not domain or not input_selector:
                continue
            cleaned.append(
                {
                    "id": str(entry.get("id") or f"allow-{uuid.uuid4()}"),
                    "label": str(entry.get("label") or domain),
                    "domain": domain,
                    "urlPattern": str(entry.get("urlPattern") or "").strip(),
                    "inputSelector": input_selector,
                    "sendSelector": str(entry.get("sendSelector") or "").strip(),
                    "submitWithEnter": bool(entry.get("submitWithEnter", True)),
                    "typingDelayMs": max(0, min(int(entry.get("typingDelayMs", 25) or 25), 2000)),
                    "maxPerMinute": max(1, min(int(entry.get("maxPerMinute", 6) or 6), 60)),
                    "enabled": entry.get("enabled", True) is not False,
                }
            )
        data = self._load()
        data["allowlist"] = cleaned
        return self._save(data)

    def validate_target(self, url: str, input_selector: str | None = None) -> dict[str, Any]:
        match = self._match_target(url, input_selector)
        return {"allowed": bool(match), "target": match, "reason": None if match else "not_allowlisted"}

    def send(self, url: str, text: str, input_selector: str | None = None, dry_run: bool = True) -> dict[str, Any]:
        target = self._match_target(url, input_selector)
        if not target:
            result = {"status": "blocked", "allowed": False, "reason": "not_allowlisted"}
            self._log(url, text, result, input_selector)
            return result
        if not text.strip():
            result = {"status": "blocked", "allowed": False, "reason": "empty_text", "target": target}
            self._log(url, text, result, input_selector)
            return result
        result = {
            "status": "dry_run" if dry_run else "ready",
            "allowed": True,
            "target": target,
            "text": text,
            "wouldType": True,
            "wouldSend": not dry_run,
        }
        self._log(url, text, result, input_selector)
        return result

    def _match_target(self, url: str, input_selector: str | None = None) -> dict[str, Any] | None:
        parsed = urlparse(url)
        host = (parsed.hostname or "").lower()
        data = self._load()
        for entry in data.get("allowlist", []):
            if not entry.get("enabled", True):
                continue
            domain = str(entry.get("domain") or "").lower()
            if host != domain and not host.endswith(f".{domain}"):
                continue
            pattern = str(entry.get("urlPattern") or "").strip()
            if pattern and not re.search(pattern, url):
                continue
            if input_selector and input_selector != entry.get("inputSelector"):
                continue
            return entry
        return None

    def _log(self, url: str, text: str, result: dict[str, Any], input_selector: str | None):
        data = self._load()
        data.setdefault("logs", []).append(
            {
                "id": f"chatlog-{uuid.uuid4()}",
                "createdAt": datetime.now(timezone.utc).isoformat(),
                "url": url,
                "inputSelector": input_selector,
                "text": text[:500],
                "result": result,
            }
        )
        data["logs"] = data["logs"][-300:]
        self._save(data)


chat_automation_service = ChatAutomationService()
