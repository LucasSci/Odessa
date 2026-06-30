from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from server.services.chat_automation_service import chat_automation_service


router = APIRouter(tags=["chat-automation"])


class ChatAutomationConfigRequest(BaseModel):
    allowlist: list[dict[str, Any]]


class ChatAutomationTargetRequest(BaseModel):
    mode: str = "selector"
    url: str = ""
    inputSelector: str | None = None
    inputPoint: dict[str, Any] | None = None
    sendPoint: dict[str, Any] | None = None
    viewport: dict[str, Any] | None = None


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
    return chat_automation_service.validate_target(
        request.url,
        request.inputSelector,
        mode=request.mode,
        input_point=request.inputPoint,
    )


@router.post("/send")
def send_chat_automation_message(request: ChatAutomationSendRequest):
    return chat_automation_service.send(
        request.url,
        request.text,
        input_selector=request.inputSelector,
        dry_run=request.dryRun,
        mode=request.mode,
        input_point=request.inputPoint,
        send_point=request.sendPoint,
        viewport=request.viewport,
    )
