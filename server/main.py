import logging
import os
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from server.api.v1.api import api_router
from server.api.v1.endpoints import auth, obs, ocr, webhooks, proxy as proxy_router
from server.config import GEMINI_API_KEY, OPENAI_API_KEY

# Logging configuration
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("odessa")

app = FastAPI(
    title="Odessa API",
    description="Professional backend for the Odessa AI Streamer Persona",
    version="1.1.0"
)

# CORS Configuration
allowed_origins = [
    origin.strip()
    for origin in os.getenv("ODESSA_ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def require_admin_session(request: Request, call_next):
    return await call_next(request)

# Include Modular API Routers
app.include_router(auth.router, prefix="/auth")
app.include_router(api_router, prefix="/api/v1")
app.include_router(api_router, prefix="/api")
app.include_router(obs.router, prefix="/obs")
app.include_router(ocr.router, prefix="/ocr")
app.include_router(webhooks.router, prefix="/webhooks")
# Proxy mounted at /proxy — strips X-Frame-Options/CSP for iframe embedding
app.include_router(proxy_router.router, prefix="/proxy")

# Health check at root
@app.get("/health")
async def health_check():
    root_dir = Path(__file__).resolve().parents[1]
    user_data_dir = os.getenv("ODESSA_USER_DATA_DIR")
    return {
        "status": "ok",
        "version": "1.1.0",
        "service": "odessa-api",
        "ocr": "ready",
        "desktop": {
            "enabled": os.getenv("ODESSA_DESKTOP") == "1",
            "user_data_dir": user_data_dir,
            "assets_found": (root_dir / "assets").exists(),
            "videos_found": (root_dir / "assets" / "videos").exists(),
        },
        "gemini_configured": bool(GEMINI_API_KEY),
        "openai_ai_configured": bool(OPENAI_API_KEY),
        "openai_tts_configured": bool(OPENAI_API_KEY),
    }


@app.on_event("startup")
async def startup_event():
    logger.info("Odessa Backend v1.1.0 starting up...")
    logger.info("Modular API mounted at /api/v1")
    logger.info("Odessa Backend is ready.")


dist_dir = Path(__file__).resolve().parents[1] / "dist"
if dist_dir.exists():
    app.mount("/assets", StaticFiles(directory=dist_dir / "assets"), name="web-assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_web_app(full_path: str):
        target = dist_dir / full_path
        try:
            if full_path and target.resolve().is_relative_to(dist_dir.resolve()) and target.is_file():
                return FileResponse(target)
        except Exception:
            pass
        return FileResponse(dist_dir / "index.html")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
