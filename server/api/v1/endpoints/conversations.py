from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(tags=["conversations"])


def get_conversation_service():
    from server.services.conversation_service import conversation_service

    return conversation_service


class ConversationCreateRequest(BaseModel):
    participantId: str
    participantName: Optional[str] = None
    source: str = "generic"
    metadata: Optional[dict[str, Any]] = None


class MessageCreateRequest(BaseModel):
    role: str = "user"
    text: str
    metadata: Optional[dict[str, Any]] = None


class ReplyGenerateRequest(BaseModel):
    personaPrompt: str
    model: str = "gemini-2.5-flash"
    temperature: float = 0.72


class ApproveMessageRequest(BaseModel):
    messageId: str


@router.get("")
@router.get("/")
async def list_conversations():
    conversations = get_conversation_service().list_conversations()
    return {"conversations": conversations, "total": len(conversations)}


@router.post("")
@router.post("/")
async def create_conversation(request: ConversationCreateRequest):
    return get_conversation_service().create_conversation(
        participant_id=request.participantId,
        participant_name=request.participantName or request.participantId,
        source=request.source,
        metadata=request.metadata,
    )


@router.get("/{conversation_id}")
async def get_conversation(conversation_id: str):
    conversation = get_conversation_service().get_conversation(conversation_id)
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation


@router.post("/{conversation_id}/messages")
async def add_message(conversation_id: str, request: MessageCreateRequest):
    try:
        return get_conversation_service().add_message(
            conversation_id,
            role=request.role,
            text=request.text,
            metadata=request.metadata,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Conversation not found") from exc


@router.post("/{conversation_id}/reply")
async def generate_reply(conversation_id: str, request: ReplyGenerateRequest):
    try:
        return get_conversation_service().generate_reply(
            conversation_id,
            persona_prompt=request.personaPrompt,
            provider_model=request.model,
            temperature=request.temperature,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Conversation not found") from exc


@router.post("/{conversation_id}/approve")
async def approve_reply(conversation_id: str, request: ApproveMessageRequest):
    try:
        return get_conversation_service().approve_message(conversation_id, request.messageId)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Message not found") from exc
