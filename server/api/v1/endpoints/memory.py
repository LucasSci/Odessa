from fastapi import APIRouter
from server.models import MemoryRoundContextRequest
from server.services.memory_service import memory_service

router = APIRouter(tags=["Memory"])

@router.get("/stats")
def get_memory_stats():
    return memory_service.get_memory_stats()

@router.post("/round-context")
def create_memory_round_context(request: MemoryRoundContextRequest):
    return memory_service.upsert_round_memory(request.events)
