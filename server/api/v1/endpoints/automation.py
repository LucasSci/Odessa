import logging
from fastapi import APIRouter
from pydantic import BaseModel

logger = logging.getLogger("odessa.routes.automation")

router = APIRouter(tags=["automation"])


class AutomationIngestRequest(BaseModel):
    text: str
    source: str = "manual"
    zoneName: str | None = None
    kind: str | None = None
    metadata: dict | None = None
    execute: bool = True
    maxActions: int = 6
    actionModes: dict | None = None
    workflowSource: str | None = None


def get_automation_service():
    from server.services.automation_service import automation_service

    return automation_service


def get_action_executor():
    from server.services.automation.executor import action_executor

    return action_executor


def get_workflow_service():
    from server.services.workflow_service import workflow_service

    return workflow_service


def __getattr__(name: str):
    if name == "automation_service":
        return get_automation_service()
    if name == "action_executor":
        return get_action_executor()
    if name == "workflow_service":
        return get_workflow_service()
    raise AttributeError(name)


async def _execute_pending_actions(max_actions: int = 6):
    executions = []
    safe_max_actions = max(0, min(int(max_actions or 0), 20))
    for _ in range(safe_max_actions):
        action = await get_automation_service().consume_next_action()
        if not action:
            break
        result = await get_action_executor().execute(action)
        from server.services.automation.logger import execution_logger
        from server.services.video_service import video_service

        video_state = result.get("videoState") or video_service.get_state()
        execution_logger.log(
            "EXECUTOR",
            f"Acao executada: {action.get('type')}",
            {"action": action, "result": result, "videoState": video_state},
        )
        executions.append(
            {
                "status": "executed",
                "action": action,
                "result": result,
                "videoState": video_state,
            }
        )
    return executions

@router.get("/queue")
async def get_queue():
    """Get all pending actions in the queue."""
    return {"queue": get_automation_service().get_pending_actions()}

@router.get("/logs")
async def get_logs():
    """Get recent execution logs."""
    from server.services.automation.logger import execution_logger
    return {"logs": execution_logger.get_recent()}

@router.get("/next-action")
async def get_next_action():
    """Consume and execute the next action when it is handled locally."""
    executions = await _execute_pending_actions(1)
    if executions:
        return executions[0]
    return {"status": "empty"}

@router.post("/test-trigger")
async def test_trigger(text: str):
    """Manually inject text to test the automation flow."""
    return get_automation_service().process_raw_text(text)


@router.post("/ingest")
async def ingest_event(request: AutomationIngestRequest):
    """Single entrypoint for OCR/manual chat text -> triggers -> optional execution."""
    clean_text = request.text.strip()
    if not clean_text:
        return {
            "status": "ignored",
            "text": request.text,
            "source": request.source,
            "summary": None,
            "executions": [],
            "videoState": None,
            "error": None,
        }

    summary = get_automation_service().process_raw_text(
        clean_text,
        event_hint={
            "kind": request.kind,
            "zoneName": request.zoneName,
            "metadata": request.metadata or {},
        },
    )
    executions = await _execute_pending_actions(request.maxActions) if request.execute else []
    from server.services.video_service import video_service

    return {
        "status": "processed",
        "text": clean_text,
        "source": request.source,
        "zoneName": request.zoneName,
        "kind": request.kind,
        "metadata": request.metadata or {},
        "summary": summary,
        "executions": executions,
        "videoState": executions[-1]["videoState"] if executions else video_service.get_state(),
        "error": None,
    }


@router.post("/dry-run")
async def dry_run_event(request: AutomationIngestRequest):
    """Evaluate OCR/manual text without queuing or touching live outputs."""
    clean_text = request.text.strip()
    if not clean_text:
        return {"status": "ignored", "summary": None, "plan": [], "videoState": None}
    workflow_config = get_workflow_service().get_versioned_workflow("draft") if request.workflowSource == "draft" else None
    summary = get_automation_service().process_raw_text(
        clean_text,
        event_hint={
            "kind": request.kind,
            "zoneName": request.zoneName,
            "metadata": request.metadata or {},
        },
        queue_actions=False,
        workflow_config=workflow_config,
    )
    from server.services.video_service import video_service

    action_modes = request.actionModes or {}
    plan = []
    for action in summary.get("actions", []):
        action_mode = action_modes.get(action.get("id")) or action_modes.get(action.get("type")) or "simulated"
        preview = video_service.preview_action(action, config=workflow_config)
        plan.append(
            {
                **preview,
                "actionMode": action_mode,
                "wouldExecute": preview.get("wouldExecute") and action_mode == "real",
                "dryRun": True,
            }
        )
    active = next((item for item in plan if item.get("activeNodeId")), None)
    return {
        "status": "dry_run",
        "text": clean_text,
        "summary": summary,
        "plan": plan,
        "flowState": {
            "activeNodeId": (active or {}).get("activeNodeId"),
            "activeConnectionId": (active or {}).get("activeConnectionId"),
            "nextConnectionIds": (active or {}).get("nextConnectionIds", []),
            "blockedConnectionIds": [
                item.get("activeConnectionId") for item in plan if item.get("blockedReason") and item.get("activeConnectionId")
            ],
            "executionMode": "test",
            "lastTransitionAt": None,
        },
        "videoState": video_service.get_state(),
    }

@router.get("/metrics")
async def get_metrics():
    """Get current session metrics and gift ledger."""
    return get_automation_service().get_session_metrics()

@router.post("/refresh")
async def refresh_config():
    """Refresh the trigger engine configuration."""
    from server.services.automation.engine import trigger_engine
    trigger_engine.refresh_config()
    return {"status": "refreshed"}

@router.get("/health")
async def health():
    return {"status": "ok", "service": "Odessa Automation Engine"}
