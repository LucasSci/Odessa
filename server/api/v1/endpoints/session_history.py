from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import BaseModel

from server.services.session_history import EVENT_TYPES

router = APIRouter(tags=["session-history"])


def get_session_history_service():
    from server.services.session_history import session_history

    return session_history


class RecordEventRequest(BaseModel):
    type: str
    data: dict[str, Any] = {}


@router.get("")
def list_session_history(
    sessionId: Optional[str] = Query(default=None),
    type: Optional[str] = Query(default=None),
    limit: int = Query(default=500, ge=1, le=5000),
    offset: int = Query(default=0, ge=0),
):
    """Lista os eventos do histórico (sessão ativa por padrão)."""
    service = get_session_history_service()
    events = service.list_events(
        session_id=sessionId,
        event_type=type,
        limit=limit,
        offset=offset,
    )
    return {
        "session": service.get_summary(session_id=sessionId),
        "events": events,
    }


@router.get("/sessions")
def list_sessions():
    """Lista as sessões registradas."""
    service = get_session_history_service()
    return {"sessions": service.list_sessions()}


@router.get("/export")
def export_session_history(
    format: str = Query(default="json", pattern="^(json|csv)$"),
    sessionId: Optional[str] = Query(default=None),
):
    """Exporta o histórico em JSON ou CSV (download)."""
    service = get_session_history_service()
    sid = sessionId or service.session_id
    if format == "csv":
        content = service.export_csv(session_id=sid)
        filename = f"{sid or 'session'}.csv"
        return Response(
            content=content,
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    data = service.export_json(session_id=sid)
    filename = f"{sid or 'session'}.json"
    return Response(
        content=__import__("json").dumps(data, ensure_ascii=False, indent=2),
        media_type="application/json; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/events")
def record_event(request: RecordEventRequest):
    """Registra um evento manualmente (usado pelo frontend para respostas de IA)."""
    if request.type not in EVENT_TYPES:
        raise HTTPException(status_code=400, detail=f"Tipo de evento inválido: {request.type}")
    service = get_session_history_service()
    event = service.record(request.type, request.data)
    if not event:
        raise HTTPException(status_code=500, detail="Falha ao registrar evento")
    return {"ok": True, "event": event}


@router.post("/start")
def start_session():
    """Inicia (ou reinicia) a sessão de histórico explicitamente."""
    service = get_session_history_service()
    return {"ok": True, **service.start_session()}


@router.post("/end")
def end_session():
    """Encerra a sessão de histórico ativa."""
    service = get_session_history_service()
    return {"ok": True, **service.end_session()}
