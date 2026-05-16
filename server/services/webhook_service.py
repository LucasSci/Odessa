import json
import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx

from server.config import N8N_ACTION_WEBHOOK_URL, RUNTIME_DIR

logger = logging.getLogger("odessa.webhooks")

WEBHOOKS_FILE = RUNTIME_DIR / "webhook_actions.json"
SECRET_HEADER_RE = re.compile(r"(authorization|token|secret|password|key)", re.IGNORECASE)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _safe_id(value: str) -> str:
    slug = re.sub(r"[^a-z0-9_-]+", "-", value.lower()).strip("-")
    return slug or f"webhook-{uuid.uuid4().hex[:8]}"


def _mask_headers(headers: Dict[str, str]) -> Dict[str, str]:
    masked: Dict[str, str] = {}
    for key, value in headers.items():
        masked[key] = "***" if SECRET_HEADER_RE.search(key) and value else value
    return masked


class WebhookService:
    def __init__(self):
        self._configs = self._load_configs()
        self._seed_legacy_n8n()

    def _load_configs(self) -> List[Dict[str, Any]]:
        if not WEBHOOKS_FILE.exists():
            return []
        try:
            raw = json.loads(WEBHOOKS_FILE.read_text(encoding="utf-8"))
            if not isinstance(raw, list):
                return []
            return [self._normalize_config(item) for item in raw if isinstance(item, dict)]
        except Exception as exc:
            logger.warning("[WEBHOOK_ERROR] Could not load webhook configs: %s", exc)
            return []

    def _save_configs(self) -> None:
        WEBHOOKS_FILE.parent.mkdir(parents=True, exist_ok=True)
        WEBHOOKS_FILE.write_text(
            json.dumps(self._configs, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

    def _seed_legacy_n8n(self) -> None:
        if not N8N_ACTION_WEBHOOK_URL:
            return
        if any(item.get("id") == "n8n-action-dispatch" for item in self._configs):
            return
        self._configs.append(
            self._normalize_config(
                {
                    "id": "n8n-action-dispatch",
                    "name": "n8n action dispatch",
                    "url": N8N_ACTION_WEBHOOK_URL,
                    "method": "POST",
                    "headers": {},
                    "enabled": True,
                    "timeoutMs": 2500,
                    "bodyTemplate": json.dumps(
                        {
                            "product": "Odessa",
                            "kind": "autopilot_action",
                            "event": "{event.text}",
                            "action": "{action.type}",
                        }
                    ),
                }
            )
        )
        self._save_configs()

    def _normalize_config(self, data: Dict[str, Any]) -> Dict[str, Any]:
        name = str(data.get("name") or data.get("id") or "Webhook").strip() or "Webhook"
        webhook_id = str(data.get("id") or _safe_id(name)).strip()
        headers = data.get("headers") if isinstance(data.get("headers"), dict) else {}
        method = str(data.get("method") or "POST").upper()
        if method not in {"POST", "PUT", "PATCH"}:
            method = "POST"
        try:
            timeout_ms = int(data.get("timeoutMs") or 2500)
        except (TypeError, ValueError):
            timeout_ms = 2500
        timeout_ms = max(500, min(15000, timeout_ms))
        created_at = str(data.get("createdAt") or _now())
        return {
            "id": webhook_id,
            "name": name,
            "url": str(data.get("url") or "").strip(),
            "method": method,
            "headers": {str(key): str(value) for key, value in headers.items()},
            "enabled": bool(data.get("enabled", True)),
            "timeoutMs": timeout_ms,
            "bodyTemplate": str(data.get("bodyTemplate") or ""),
            "createdAt": created_at,
            "updatedAt": str(data.get("updatedAt") or created_at),
        }

    def _public_config(self, config: Dict[str, Any]) -> Dict[str, Any]:
        return {**config, "headers": _mask_headers(config.get("headers", {}))}

    def list_configs(self) -> List[Dict[str, Any]]:
        return [self._public_config(item) for item in self._configs]

    def get_config(self, webhook_id: str) -> Optional[Dict[str, Any]]:
        return next((item for item in self._configs if item.get("id") == webhook_id), None)

    def upsert_config(self, data: Dict[str, Any]) -> Dict[str, Any]:
        normalized = self._normalize_config(data)
        existing = self.get_config(normalized["id"])
        if existing:
            normalized["createdAt"] = existing.get("createdAt", normalized["createdAt"])
            normalized["updatedAt"] = _now()
            normalized["headers"] = {
                key: existing.get("headers", {}).get(key, value) if value == "***" else value
                for key, value in normalized.get("headers", {}).items()
            }
            self._configs = [
                normalized if item.get("id") == normalized["id"] else item for item in self._configs
            ]
        else:
            normalized["updatedAt"] = _now()
            self._configs.append(normalized)
        self._save_configs()
        return self._public_config(normalized)

    def delete_config(self, webhook_id: str) -> bool:
        before = len(self._configs)
        self._configs = [item for item in self._configs if item.get("id") != webhook_id]
        changed = len(self._configs) != before
        if changed:
            self._save_configs()
        return changed

    def _resolve_context_value(self, path: str, context: Dict[str, Any]) -> str:
        current: Any = context
        for part in path.split("."):
            if isinstance(current, dict):
                current = current.get(part)
            else:
                current = None
            if current is None:
                return ""
        if isinstance(current, (dict, list)):
            return json.dumps(current, ensure_ascii=False)
        return str(current)

    def render_body(self, template: str, context: Dict[str, Any]) -> Any:
        body = template.strip()
        if not body:
            return context

        def replace(match: re.Match[str]) -> str:
            return self._resolve_context_value(match.group(1).strip(), context)

        rendered = re.sub(r"\{([a-zA-Z0-9_.-]+)\}", replace, body)
        try:
            return json.loads(rendered)
        except json.JSONDecodeError:
            return {"message": rendered}

    async def dispatch(
        self,
        webhook_id: str,
        event: Optional[Dict[str, Any]] = None,
        action: Optional[Dict[str, Any]] = None,
        payload: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        config = self.get_config(webhook_id)
        if not config:
            return {"ok": False, "status": "blocked", "error": "webhook_not_found"}
        if not config.get("enabled", True):
            return {"ok": False, "status": "blocked", "error": "webhook_disabled"}
        if not config.get("url"):
            return {"ok": False, "status": "blocked", "error": "webhook_url_missing"}

        context = {
            "event": event or {},
            "action": action or {},
            "payload": payload or {},
            "createdAt": _now(),
        }
        body = self.render_body(str(config.get("bodyTemplate") or ""), context)
        timeout = max(0.5, int(config.get("timeoutMs", 2500)) / 1000)
        method = str(config.get("method") or "POST").upper()
        headers = dict(config.get("headers") or {})
        logger.info("[ACTION] webhook.call -> %s", config.get("name") or webhook_id)

        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.request(method, config["url"], headers=headers, json=body)
            ok = 200 <= response.status_code < 300
            result: Dict[str, Any] = {
                "ok": ok,
                "status": "done" if ok else "error",
                "webhookId": webhook_id,
                "statusCode": response.status_code,
                "headers": _mask_headers(headers),
                "response": response.text[:1000],
                "error": None if ok else f"HTTP {response.status_code}",
            }
            if not ok:
                logger.error("[WEBHOOK_ERROR] %s returned HTTP %s", webhook_id, response.status_code)
            return result
        except Exception as exc:
            logger.error("[WEBHOOK_ERROR] %s dispatch failed: %s", webhook_id, exc)
            return {
                "ok": False,
                "status": "error",
                "webhookId": webhook_id,
                "statusCode": None,
                "headers": _mask_headers(headers),
                "response": None,
                "error": str(exc),
            }


webhook_service = WebhookService()
