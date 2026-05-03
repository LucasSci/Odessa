import os
from pathlib import Path
from typing import Any, Optional

from pydantic import BaseModel

# Constantes usadas nos models
SERVER_DIR = Path(__file__).resolve().parent
RUNTIME_DIR = SERVER_DIR / "runtime"
GEMINI_IMAGE_MODEL = os.getenv("GEMINI_IMAGE_MODEL", "gemini-2.5-flash-image").strip()
GEMINI_IMAGE_ASPECT_RATIO = os.getenv("GEMINI_IMAGE_ASPECT_RATIO", "9:16").strip()
GEMINI_IMAGE_SIZE = os.getenv("GEMINI_IMAGE_SIZE", "").strip()
OPENAI_IMAGE_MODEL = os.getenv("OPENAI_IMAGE_MODEL", "gpt-image-1").strip()

class RegionRequest(BaseModel):
    zone_id: Optional[str] = None
    zone_name: Optional[str] = None
    x: Optional[int] = None
    y: Optional[int] = None
    width: Optional[int] = None
    height: Optional[int] = None
    image: Optional[str] = None


class AIRespondRequest(BaseModel):
    persona_prompt: str
    chat_context: str
    model: str = "gemini-2.5-flash"
    temperature: float = 0.9


class LiveEventPayload(BaseModel):
    id: str
    source: str = "manual"
    zoneName: str = "Controle Live"
    text: str
    kind: str = "chat"
    createdAt: str
    time: str
    metadata: Optional[dict[str, Any]] = None


class AIDecideRequest(BaseModel):
    persona_prompt: str
    events: list[LiveEventPayload]
    tools: Optional[list[dict[str, Any]]] = None
    rules: Optional[list[dict[str, Any]]] = None
    context: Optional[dict[str, Any]] = None
    mode: str = "autopilot_audited"
    model: str = "gemini-2.5-flash"
    temperature: float = 0.72


class N8NDispatchRequest(BaseModel):
    target: str = "audit"
    payload: dict[str, Any]


class MemoryRoundContextRequest(BaseModel):
    events: list[LiveEventPayload]


class ProjectCreatePlanRequest(BaseModel):
    title: str = "Nova etapa Odessa"
    brief: str
    priority: str = "normal"
    area: str = "produto"
    requestedBy: str = "Lucas"
    constraints: Optional[list[str]] = None
    targetChannel: str = "odessa-roadmap"
    model: str = "gemini-2.5-flash"
    temperature: float = 0.45


class NightShiftRequest(BaseModel):
    objective: str = "Preparar avancos seguros para o proximo ciclo do Odessa"
    durationMinutes: int = 90
    focusAreas: Optional[list[str]] = None
    maxAdvancements: int = 4
    requestedBy: str = "Lucas"
    constraints: Optional[list[str]] = None
    targetChannel: str = "odessa-roadmap"
    model: str = "gemini-2.5-flash"
    temperature: float = 0.42


class ContinuousOrganizerRequest(BaseModel):
    objective: str = (
        "Organizar continuamente as tarefas necessarias para levar o Odessa "
        "ate o produto final."
    )
    cadence: str = "scheduled_30m"
    focusAreas: Optional[list[str]] = None
    maxTasks: int = 8
    requestedBy: str = "n8n continuous organizer"
    constraints: Optional[list[str]] = None
    targetChannel: str = "odessa-roadmap"
    model: str = "gemini-2.5-flash"
    temperature: float = 0.35


class VisualReference(BaseModel):
    source: str = "manual"
    url: Optional[str] = None
    notes: str = ""
    observedAt: Optional[str] = None
    metadata: Optional[dict[str, Any]] = None


class VisualAssetRunRequest(BaseModel):
    objective: str = (
        "Criar referencias visuais seguras para a persona Odessa/Juju em lives sociais."
    )
    mode: str = "scheduled_loop"
    references: Optional[list[VisualReference]] = None
    seedPersona: str = (
        "Odessa/Juju, anfitria virtual brasileira para lives sociais, calorosa, "
        "energica, expressiva e segura."
    )
    requestedBy: str = "n8n visual asset generator"
    targetChannel: str = "odessa-roadmap"
    maxPrompts: int = 6
    maxImages: int = 2
    generateImages: bool = True
    imageProvider: str = "auto"
    model: str = "gemini-2.5-flash"
    imageModel: str = GEMINI_IMAGE_MODEL
    openaiImageModel: str = OPENAI_IMAGE_MODEL
    aspectRatio: str = GEMINI_IMAGE_ASPECT_RATIO
    imageSize: str = GEMINI_IMAGE_SIZE
    temperature: float = 0.58
