from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from server.models import MemoryRoundContextRequest
from server.services.memory_service import memory_service

router = APIRouter(tags=["Memory"])


class MemoryVisibilityRequest(BaseModel):
    hidden: bool = True

@router.get("/stats")
def get_memory_stats():
    return memory_service.get_memory_stats()

@router.post("/round-context")
def create_memory_round_context(request: MemoryRoundContextRequest):
    return memory_service.upsert_round_memory(request.events)


@router.get("/profiles")
def list_memory_profiles(
    q: str = "",
    limit: int = Query(50, ge=1, le=200),
    includeHidden: bool = False,
):
    return memory_service.list_profiles(q, limit, includeHidden)


@router.get("/profiles/{user_id}")
def get_memory_profile(user_id: str):
    profile = memory_service.get_profile(user_id)
    if not profile:
        raise HTTPException(status_code=404, detail="User profile not found")
    return profile


@router.get("/profiles/{user_id}/context")
def get_memory_profile_context(user_id: str):
    context = memory_service.build_user_context(user_id)
    if not context["found"]:
        raise HTTPException(status_code=404, detail="User profile not found")
    return context


@router.post("/profiles/{user_id}/visibility")
def update_memory_profile_visibility(user_id: str, request: MemoryVisibilityRequest):
    return memory_service.hide_profile(user_id, request.hidden)


@router.delete("/profiles/{user_id}")
def clear_memory_profile(user_id: str):
    return memory_service.clear_profile(user_id)
