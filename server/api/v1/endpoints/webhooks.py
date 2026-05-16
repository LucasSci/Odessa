from typing import Any, Dict, Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

from server.services.webhook_service import webhook_service

router = APIRouter(tags=["webhooks"])


class WebhookConfigRequest(BaseModel):
    id: Optional[str] = None
    name: str = "Webhook"
    url: str = ""
    method: str = "POST"
    headers: Dict[str, str] = Field(default_factory=dict)
    enabled: bool = True
    timeoutMs: int = 2500
    bodyTemplate: str = ""


class WebhookDispatchRequest(BaseModel):
    webhookId: Optional[str] = None
    event: Dict[str, Any] = Field(default_factory=dict)
    action: Dict[str, Any] = Field(default_factory=dict)
    payload: Dict[str, Any] = Field(default_factory=dict)


@router.get("")
async def list_webhooks():
    return {"ok": True, "webhooks": webhook_service.list_configs(), "error": None}


@router.post("")
async def upsert_webhook(request: WebhookConfigRequest):
    try:
        config = webhook_service.upsert_config(request.model_dump())
        return {"ok": True, "webhook": config, "webhooks": webhook_service.list_configs(), "error": None}
    except Exception as exc:
        return {"ok": False, "webhook": None, "webhooks": webhook_service.list_configs(), "error": str(exc)}


@router.post("/dispatch")
async def dispatch_webhook(request: WebhookDispatchRequest):
    webhook_id = str(request.webhookId or request.payload.get("webhookId") or "").strip()
    if not webhook_id:
        return {"ok": False, "status": "blocked", "error": "webhook_id_missing"}
    return await webhook_service.dispatch(
        webhook_id,
        event=request.event,
        action=request.action,
        payload=request.payload,
    )


@router.delete("/{webhook_id}")
async def delete_webhook(webhook_id: str):
    deleted = webhook_service.delete_config(webhook_id)
    return {
        "ok": deleted,
        "deleted": deleted,
        "webhooks": webhook_service.list_configs(),
        "error": None if deleted else "webhook_not_found",
    }


@router.post("/{webhook_id}/test")
async def test_webhook(webhook_id: str, request: WebhookDispatchRequest | None = None):
    payload = request or WebhookDispatchRequest(webhookId=webhook_id)
    result = await webhook_service.dispatch(
        webhook_id,
        event=payload.event or {"text": "Teste manual do Odessa", "kind": "test"},
        action=payload.action or {"type": "webhook.call", "payload": {"webhookId": webhook_id}},
        payload=payload.payload,
    )
    return result
