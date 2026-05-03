import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from server.routes import ocr, ai, tts, memory, misc

# Logging configuration
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("odessa")

app = FastAPI(
    title="Odessa API",
    description="Modular backend for the Odessa AI Streamer Persona",
    version="1.0.0"
)

# CORS Configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include Routers
app.include_router(ocr.router)
app.include_router(ai.router)
app.include_router(tts.router)
app.include_router(memory.router)
app.include_router(misc.router)

@app.on_event("startup")
async def startup_event():
    logger.info("Odessa Backend starting up...")
    # Initialize services if needed (most are singletons initialized on import)
    logger.info("Odessa Backend is ready.")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
