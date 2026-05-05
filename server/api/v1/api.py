from fastapi import APIRouter
from server.api.v1.endpoints import video, ocr, ai, tts, memory, misc

api_router = APIRouter()

api_router.include_router(video.router, prefix="/video", tags=["video"])
api_router.include_router(ocr.router, prefix="/ocr", tags=["ocr"])
api_router.include_router(ai.router, prefix="/ai", tags=["ai"])
api_router.include_router(tts.router, prefix="/tts", tags=["tts"])
api_router.include_router(memory.router, prefix="/memory", tags=["memory"])
api_router.include_router(misc.router, prefix="/misc", tags=["misc"])
