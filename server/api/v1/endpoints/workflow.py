from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from server.services.workflow_service import workflow_service


router = APIRouter(tags=["workflow"])


class WorkflowDraftRequest(BaseModel):
    workflow: dict | None = None


class WorkflowTestRequest(BaseModel):
    text: str = "Lucas enviou Rosa"
    kind: str | None = "gift"
    source: str = "draft"


@router.get("/published")
async def get_published_workflow():
    return workflow_service.get_versioned_workflow("published")


@router.get("/draft")
async def get_draft_workflow():
    return workflow_service.get_versioned_workflow("draft")


@router.post("/draft")
async def save_draft_workflow(request: WorkflowDraftRequest):
    try:
        return workflow_service.save_draft(request.workflow or {})
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/draft/validate")
async def validate_draft_workflow(request: WorkflowDraftRequest):
    workflow = request.workflow or workflow_service.get_versioned_workflow("draft")
    try:
        validation = workflow_service.validate_workflow(workflow)
        comparison = workflow_service.compare_draft_to_published()
        return {"status": "validated", "validation": validation, "comparison": comparison}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/draft/test")
async def test_draft_workflow(request: WorkflowTestRequest):
    from server.services.automation_service import automation_service
    from server.services.video_service import video_service

    workflow_config = workflow_service.get_versioned_workflow("draft")
    summary = automation_service.process_raw_text(
        request.text,
        event_hint={"kind": request.kind, "zoneName": "Workflow draft", "metadata": {"workflowSource": "draft"}},
        queue_actions=False,
        workflow_config=workflow_config,
    )
    plan = [video_service.preview_action(action, config=workflow_config) for action in summary.get("actions", [])]
    return {
        "status": "draft_test",
        "dryRun": True,
        "summary": summary,
        "plan": plan,
        "workflowSource": "draft",
    }


@router.post("/publish")
async def publish_workflow():
    try:
        result = workflow_service.publish_draft()
        from server.services.video_service import video_service
        from server.services.automation.engine import trigger_engine

        video_service.refresh_config()
        trigger_engine.refresh_config()
        return result
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/draft/reset-from-published")
async def reset_draft_from_published():
    try:
        return workflow_service.reset_draft_from_published()
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))
