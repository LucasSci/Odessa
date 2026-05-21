import os
from pathlib import Path

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SERVER_DIR = Path(__file__).resolve().parent
RUNTIME_DIR = SERVER_DIR / "runtime"
RUNTIME_DIR.mkdir(exist_ok=True)

load_dotenv(PROJECT_ROOT / ".env")
load_dotenv(SERVER_DIR / ".env", override=False)

LOG_FILE = Path(os.getenv("CAPTURE_LOG_FILE", RUNTIME_DIR / "captura_chat.txt"))
REGION_FILE = Path(os.getenv("CAPTURE_REGION_FILE", RUNTIME_DIR / "regions.json"))
MAX_OCR_IMAGE_BYTES = int(os.getenv("OCR_MAX_IMAGE_BYTES", str(8 * 1024 * 1024)))
MAX_OCR_IMAGE_PIXELS = int(os.getenv("OCR_MAX_IMAGE_PIXELS", "6000000"))

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "").strip()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
OPENAI_TEXT_MODEL = (
    os.getenv("OPENAI_TEXT_MODEL")
    or os.getenv("OPENAI_MODEL")
    or "gpt-4o-mini"
).strip()
OPENAI_TTS_MODEL = os.getenv("OPENAI_TTS_MODEL", "gpt-4o-mini-tts").strip()
OPENAI_IMAGE_MODEL = os.getenv("OPENAI_IMAGE_MODEL", "gpt-image-1").strip()
OPENAI_IMAGE_SIZE = os.getenv("OPENAI_IMAGE_SIZE", "").strip()
OPENAI_IMAGE_QUALITY = os.getenv("OPENAI_IMAGE_QUALITY", "auto").strip()
TTS_DEFAULT_PROVIDER = os.getenv("TTS_DEFAULT_PROVIDER", "edge").strip().lower()
KOKORO_ENABLED = os.getenv("KOKORO_ENABLED", "true").strip().lower() not in {"0", "false", "no"}
KOKORO_DEFAULT_LANG = os.getenv("KOKORO_DEFAULT_LANG", "p").strip() or "p"
KOKORO_DEFAULT_VOICE = os.getenv("KOKORO_DEFAULT_VOICE", "pf_dora").strip() or "pf_dora"
try:
    KOKORO_DEFAULT_SPEED = float(os.getenv("KOKORO_DEFAULT_SPEED", "1.0"))
except ValueError:
    KOKORO_DEFAULT_SPEED = 1.0
ESPEAK_NG_PATH = os.getenv("ESPEAK_NG_PATH", "").strip()
N8N_BASE_URL = os.getenv("N8N_BASE_URL", "").strip().rstrip("/")
N8N_WEBHOOK_SECRET = os.getenv("N8N_WEBHOOK_SECRET", "").strip()
N8N_AUDIT_WEBHOOK_URL = os.getenv("N8N_AUDIT_WEBHOOK_URL", "").strip()
N8N_ACTION_WEBHOOK_URL = os.getenv("N8N_ACTION_WEBHOOK_URL", "").strip()
N8N_EVENT_INGEST_WEBHOOK_URL = os.getenv("N8N_EVENT_INGEST_WEBHOOK_URL", "").strip()
N8N_PROJECT_CREATION_WEBHOOK_URL = os.getenv("N8N_PROJECT_CREATION_WEBHOOK_URL", "").strip()
N8N_NIGHT_SHIFT_WEBHOOK_URL = os.getenv("N8N_NIGHT_SHIFT_WEBHOOK_URL", "").strip()
N8N_VISUAL_ASSET_WEBHOOK_URL = os.getenv("N8N_VISUAL_ASSET_WEBHOOK_URL", "").strip()
ODESSA_PROJECT_OUTPUT_DIR = Path(
    os.getenv("ODESSA_PROJECT_OUTPUT_DIR", RUNTIME_DIR / "project-plans")
)
ODESSA_VISUAL_OUTPUT_DIR = Path(
    os.getenv("ODESSA_VISUAL_OUTPUT_DIR", RUNTIME_DIR / "visual-assets")
)
N8N_EVENT_QUEUE_FILE = RUNTIME_DIR / "n8n_events.json"
N8N_AUDIT_FILE = RUNTIME_DIR / "n8n_audit.json"
ODESSA_DB_PATH = Path(os.getenv("ODESSA_DB_PATH", RUNTIME_DIR / "odessa.db"))
if not ODESSA_DB_PATH.is_absolute():
    ODESSA_DB_PATH = PROJECT_ROOT / ODESSA_DB_PATH
PROJECT_TASKS_FILE = RUNTIME_DIR / "project_tasks.json"
PROJECT_ORGANIZER_RUNS_FILE = RUNTIME_DIR / "project_organizer_runs.json"
VISUAL_ASSET_RUNS_FILE = RUNTIME_DIR / "visual_asset_runs.json"
MAX_N8N_QUEUE_EVENTS = int(os.getenv("N8N_MAX_QUEUE_EVENTS", "200"))
N8N_HTTP_TIMEOUT = float(os.getenv("N8N_HTTP_TIMEOUT", "2.5"))
MAX_PROJECT_TASKS = int(os.getenv("ODESSA_MAX_PROJECT_TASKS", "200"))
MAX_PROJECT_ORGANIZER_RUNS = int(os.getenv("ODESSA_MAX_ORGANIZER_RUNS", "100"))
MAX_VISUAL_ASSET_RUNS = int(os.getenv("ODESSA_MAX_VISUAL_ASSET_RUNS", "100"))
MAX_VISUAL_IMAGES_PER_RUN = int(os.getenv("ODESSA_MAX_VISUAL_IMAGES_PER_RUN", "3"))
GEMINI_IMAGE_MODEL = os.getenv("GEMINI_IMAGE_MODEL", "gemini-2.5-flash-image").strip()
GEMINI_IMAGE_ASPECT_RATIO = os.getenv("GEMINI_IMAGE_ASPECT_RATIO", "9:16").strip()
GEMINI_IMAGE_SIZE = os.getenv("GEMINI_IMAGE_SIZE", "").strip()

# Automation & Service Config
AI_PROVIDER = os.getenv("AI_PROVIDER", "gemini").strip().lower()
ENABLE_LOCAL_FALLBACK = os.getenv("ENABLE_LOCAL_FALLBACK", "true").lower() == "true"

ENABLE_TTS = os.getenv("ENABLE_TTS", "false").lower() == "true"
TTS_SIMULATION_MODE = os.getenv("TTS_SIMULATION_MODE", "true").lower() == "true"

OBS_ENABLED = os.getenv("OBS_ENABLED", "false").lower() == "true"
OBS_WEBSOCKET_URL = os.getenv("OBS_WEBSOCKET_URL", "ws://localhost:4455").strip()
OBS_WEBSOCKET_PASSWORD = os.getenv("OBS_WEBSOCKET_PASSWORD", "").strip()
OBS_OCR_SOURCE_NAME = os.getenv("OBS_OCR_SOURCE_NAME", "Odessa Chat OCR").strip() or "Odessa Chat OCR"
OBS_SCENE_WHITELIST = os.getenv("OBS_SCENE_WHITELIST", "Gameplay Focus,Cena Just Chatting,Tela de reacts").split(",")
OBS_STAGE_SOURCE_NAME = os.getenv("OBS_STAGE_SOURCE_NAME", "Odessa Stage Overlay").strip() or "Odessa Stage Overlay"
OBS_STAGE_URL = os.getenv("OBS_STAGE_URL", "http://localhost:3000/#overlay").strip() or "http://localhost:3000/#overlay"
OBS_STARTUP_SCENE_NAME = os.getenv("OBS_STARTUP_SCENE_NAME", "Odessa START").strip() or "Odessa START"
OBS_LIVE_SCENE_NAME = os.getenv("OBS_LIVE_SCENE_NAME", "Odessa LIVE").strip() or "Odessa LIVE"
OBS_TRANSMISSION_MODE = os.getenv("OBS_TRANSMISSION_MODE", "stream").strip().lower() or "stream"
OBS_STAGE_CANVAS_WIDTH = int(os.getenv("OBS_STAGE_CANVAS_WIDTH", "1080"))
OBS_STAGE_CANVAS_HEIGHT = int(os.getenv("OBS_STAGE_CANVAS_HEIGHT", "1920"))

SIMULATION_MODE = os.getenv("SIMULATION_MODE", "true").lower() == "true"

MAX_EVENTS_PER_TICK = int(os.getenv("MAX_EVENTS_PER_TICK", "10"))
GIFT_DEBOUNCE_MS = int(os.getenv("GIFT_DEBOUNCE_MS", "1500"))
GIFT_BATCH_WINDOW_MS = int(os.getenv("GIFT_BATCH_WINDOW_MS", "2500"))
EVENT_PROCESSING_TIMEOUT_MS = int(os.getenv("EVENT_PROCESSING_TIMEOUT_MS", "10000"))

TOPIC_SUGGEST_COOLDOWN_MS = int(os.getenv("TOPIC_SUGGEST_COOLDOWN_MS", "60000"))
VIDEO_TRIGGER_COOLDOWN_MS = int(os.getenv("VIDEO_TRIGGER_COOLDOWN_MS", "15000"))

DEFAULT_RECEIVER = os.getenv("DEFAULT_RECEIVER", "Odessa").strip()
