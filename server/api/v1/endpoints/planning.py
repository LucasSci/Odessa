"""Mural de planejamento — armazenamento próprio (não depende da persona ativa).

Antes o mural enviava `{planningCanvas}` para POST /workflow/draft, que só lê
`workflow`: a resposta era "salvo", mas o conteúdo era descartado e o mural
voltava vazio. O planejamento de conteúdo vale para o software inteiro (serve
a qualquer persona), então fica num arquivo próprio em server/data.
"""
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from server.core.atomic_json import read_json, write_json
from server.core.persona_manager import DATA_DIR

router = APIRouter()

MAX_ITEMS = 2000


def canvas_path():
    return DATA_DIR / "planning_canvas.json"


def _empty() -> dict[str, Any]:
    return {"items": [], "connections": []}


class PlanningCanvasRequest(BaseModel):
    items: list[dict[str, Any]] = Field(default_factory=list)
    connections: list[dict[str, Any]] = Field(default_factory=list)
    viewport: dict[str, Any] | None = None


@router.get("/canvas")
def get_canvas() -> dict[str, Any]:
    data = read_json(canvas_path(), default_factory=_empty)
    if not isinstance(data, dict):
        return _empty()
    data.setdefault("items", [])
    data.setdefault("connections", [])
    return data


@router.put("/canvas")
def save_canvas(request: PlanningCanvasRequest) -> dict[str, Any]:
    if len(request.items) > MAX_ITEMS:
        raise HTTPException(status_code=400, detail=f"Mural com mais de {MAX_ITEMS} elementos.")
    payload = request.model_dump(exclude_none=True)
    write_json(canvas_path(), payload)
    return {"ok": True, "items": len(request.items), "connections": len(request.connections)}
