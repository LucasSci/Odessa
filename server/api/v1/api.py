from fastapi import APIRouter
from server.api.v1.endpoints import video, ai, tts, memory, misc, automation, obs, webhooks, proxy, conversations, chat_automation, workflow, personas, persona_selfconfig, persona_photogen, persona_content, video_gen, session_history

api_router = APIRouter()

api_router.include_router(video.router, prefix="/video", tags=["video"])
api_router.include_router(video_gen.router, prefix="/video-gen", tags=["video-gen"])
api_router.include_router(workflow.router, prefix="/workflow", tags=["workflow"])
api_router.include_router(automation.router, prefix="/automation", tags=["automation"])
api_router.include_router(ai.router, prefix="/ai", tags=["ai"])
api_router.include_router(tts.router, prefix="/tts", tags=["tts"])
api_router.include_router(memory.router, prefix="/memory", tags=["memory"])
api_router.include_router(misc.router, prefix="/misc", tags=["misc"])
api_router.include_router(obs.router, prefix="/obs", tags=["obs"])
api_router.include_router(webhooks.router, prefix="/webhooks", tags=["webhooks"])
api_router.include_router(proxy.router, prefix="/proxy", tags=["proxy"])
api_router.include_router(conversations.router, prefix="/conversations", tags=["conversations"])
api_router.include_router(chat_automation.router, prefix="/chat-automation", tags=["chat-automation"])
api_router.include_router(personas.router, prefix="/personas", tags=["personas"])
api_router.include_router(persona_selfconfig.router, prefix="/personas", tags=["personas"])
api_router.include_router(persona_photogen.router, prefix="/personas", tags=["personas"])
api_router.include_router(persona_content.router, prefix="/personas", tags=["personas"])
api_router.include_router(session_history.router, prefix="/session-history", tags=["session-history"])
