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

CORS_ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv("CORS_ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173").split(",")
    if origin.strip()
]

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
