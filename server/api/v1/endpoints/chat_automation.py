from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from server.services.chat_automation_service import chat_automation_service


router = APIRouter(tags=["chat-automation"])


class ChatAutomationConfigRequest(BaseModel):
    allowlist: list[dict[str, Any]]


class ChatAutomationTargetRequest(BaseModel):
    url: str
    inputSelector: str | None = None


class ChatAutomationSendRequest(ChatAutomationTargetRequest):
    text: str
    dryRun: bool = True


@router.get("/config")
def get_chat_automation_config():
    return chat_automation_service.get_config()


@router.post("/config")
def update_chat_automation_config(request: ChatAutomationConfigRequest):
    return chat_automation_service.update_config(request.allowlist)


@router.post("/validate")
def validate_chat_automation_target(request: ChatAutomationTargetRequest):
    return chat_automation_service.validate_target(request.url, request.inputSelector)


@router.post("/send")
def send_chat_automation_message(request: ChatAutomationSendRequest):
    return chat_automation_service.send(
        request.url,
        request.text,
        input_selector=request.inputSelector,
        dry_run=request.dryRun,
    )
