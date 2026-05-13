import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from server.config import CORS_ALLOWED_ORIGINS
from server.api.v1.api import api_router

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
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOWED_ORIGINS, # Expand for development, restrict in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include Modular API Routers
app.include_router(api_router, prefix="/api/v1")

# Health check at root
@app.get("/health")
async def health_check():
    return {"status": "ok", "version": "1.1.0", "service": "odessa-api"}

@app.on_event("startup")
async def startup_event():
    logger.info("Odessa Backend v1.1.0 starting up...")
    logger.info("Modular API mounted at /api/v1")
    logger.info("Odessa Backend is ready.")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
