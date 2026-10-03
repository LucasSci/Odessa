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
    # upsert_round_memory espera dicts (usa .get), não models Pydantic.
    return memory_service.upsert_round_memory([event.model_dump() for event in request.events])


@router.get("/profiles")
def list_memory_profiles(
    q: str = "",
    limit: int = Query(50, ge=1, le=200),
    includeHidden: bool = False,
):
    return memory_service.list_profiles(q, limit, includeHidden)


@router.delete("/profiles")
def clear_all_memory_profiles():
    return memory_service.clear_all()


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


# ── Memória que cresce (server/services/memory_learning.py) ───────────────

from typing import Optional  # noqa: E402

from server.services import memory_learning  # noqa: E402


class MemoryLearnRequest(BaseModel):
    persona_id: str = ""
    persona_name: str = ""
    provider: Optional[str] = None
    provider_key: Optional[str] = None
    local_model_url: Optional[str] = None
    local_model_name: Optional[str] = None
    max_users: int = 3
    min_new: int = memory_learning.MIN_NEW_MESSAGES_TO_LEARN


@router.get("/context")
def get_memory_context(username: str = "", persona: str = "", personaName: str = ""):
    """O que a IA sabe de quem está falando + o que a persona já contou de si (qualquer IA)."""
    return memory_learning.build_prompt_context(username, persona, personaName)


@router.post("/learn")
def learn_from_conversations(request: MemoryLearnRequest):
    """Transforma a conversa nova em fatos + resumo, com a IA ativa (a chave nunca é guardada)."""
    from server.services.ai_service import ai_service

    def generate(system: str, user: str) -> str:
        text, _provider = ai_service.generate_ai_text_with_fallback(
            gemini_model="gemini-2.5-flash",
            system_prompt=system,
            user_prompt=user,
            temperature=0.2,
            json_mode=True,
            # Aprender cede a vez ao chat da live (fila da IA local).
            priority="memory",
            local_model_url=request.local_model_url,
            local_model_name=request.local_model_name,
            provider=request.provider,
            provider_key=request.provider_key,
        )
        return text

    return memory_learning.learn_pending(
        request.persona_id,
        request.persona_name,
        generate,
        max_users=max(1, min(request.max_users, 10)),
        min_new=max(1, request.min_new),
    )


@router.delete("/facts/{fact_id}")
def delete_viewer_fact(fact_id: str):
    if not memory_learning.delete_viewer_fact(fact_id):
        raise HTTPException(status_code=404, detail="Fato não encontrado")
    return {"ok": True}


@router.get("/persona-facts")
def list_persona_facts(persona: str):
    return {"facts": memory_learning.list_persona_facts(persona)}


@router.delete("/persona-facts/{fact_id}")
def delete_persona_fact(fact_id: str):
    if not memory_learning.delete_persona_fact(fact_id):
        raise HTTPException(status_code=404, detail="Fato não encontrado")
    return {"ok": True}
