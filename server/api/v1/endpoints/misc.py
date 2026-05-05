import logging
import os
from fastapi import APIRouter
from server.config import GEMINI_API_KEY, GEMINI_IMAGE_MODEL, OPENAI_API_KEY, OPENAI_TEXT_MODEL, OPENAI_IMAGE_MODEL

router = APIRouter(tags=["Misc"])
logger = logging.getLogger("odessa.routes.misc")

@router.get("/health")
def health_check():
    return {
        "status": "ok",
        "ocr": "ready",
        "gemini_configured": bool(GEMINI_API_KEY),
        "openai_ai_configured": bool(OPENAI_API_KEY),
    }

@router.get("/regions")
def get_regions():
    # Logic to return stored regions
    return {"chat": [17, 145, 331, 405], "gifts": [600, 200, 200, 300]}

@router.get("/log")
def get_ocr_log():
    # Return last N logs from a file or DB
    return {"logs": []}
