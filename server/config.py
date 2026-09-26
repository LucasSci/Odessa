import os
from pathlib import Path

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SERVER_DIR = Path(__file__).resolve().parent
RUNTIME_DIR = SERVER_DIR / "runtime"
RUNTIME_DIR.mkdir(exist_ok=True)

load_dotenv(PROJECT_ROOT / ".env")
load_dotenv(SERVER_DIR / ".env", override=False)

# Perfis de navegador da bridge (guardam o LOGIN DO TANGO). Ficam fora da pasta
# do programa: o instalador substitui server/ a cada atualização e, quando o
# perfil morava em server/runtime, todo update apagava o login.
_local_app_data = os.getenv("LOCALAPPDATA", "").strip()
BROWSER_PROFILES_DIR = Path(
    os.getenv("ODESSA_BROWSER_PROFILES_DIR", "").strip()
    or (Path(_local_app_data) / "Odessa" / "browser-profiles" if _local_app_data else RUNTIME_DIR / "browser-profiles")
)

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "").strip()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "").strip()
ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-haiku-4-5-20251001").strip()
# Base URL do provedor OpenAI-compatível. Padrão: RouteLLM da Abacus.AI.
# Para usar a OpenAI oficial, defina OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "https://routellm.abacus.ai/v1").strip().rstrip("/")
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
AI_PROVIDER = os.getenv("AI_PROVIDER", "ollama").strip().lower()
# Desligado por padrao: uma fala pronta com HTTP 200 esconde que a IA caiu.
ENABLE_LOCAL_FALLBACK = os.getenv("ENABLE_LOCAL_FALLBACK", "false").lower() == "true"
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434").strip().rstrip("/")
# 3B por padrão: o 7B (qwen2.5:latest) travava notebooks a cada resposta da persona.
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:3b").strip()
OLLAMA_TIMEOUT = float(os.getenv("OLLAMA_TIMEOUT", "90"))
# Consumo da IA local. Sem limite o Ollama usa todos os núcleos físicos e, num
# notebook, a live inteira (OBS, navegador) trava enquanto a persona "pensa".
# Padrão: 1/3 das threads lógicas (4 num Ryzen 5 5500U), sobrando CPU para o resto.
OLLAMA_NUM_THREAD = int(os.getenv("OLLAMA_NUM_THREAD", "0") or 0) or max(2, (os.cpu_count() or 6) // 3)
# Quanto tempo o modelo fica na RAM depois da última resposta (antes: 30 min).
OLLAMA_KEEP_ALIVE = os.getenv("OLLAMA_KEEP_ALIVE", "10m").strip() or "10m"

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

# ── Video Generation Pipeline ──────────────────────────────────────────────
# Provedor de geração de vídeo. "placeholder" simula o pipeline completo sem
# chamar API real (ideal para testes). "routellm" tenta a API de vídeo da
# Abacus.AI via RouteLLM (OpenAI-compatível).
VIDEO_GEN_PROVIDER = os.getenv("VIDEO_GEN_PROVIDER", "placeholder").strip().lower()
VIDEO_GEN_API_KEY = os.getenv("VIDEO_GEN_API_KEY", "").strip()
VIDEO_GEN_MODEL = os.getenv("VIDEO_GEN_MODEL", "video-gen").strip()
# Gera vídeo automaticamente quando o buffer de prompts atinge o limiar.
VIDEO_GEN_AUTO = os.getenv("VIDEO_GEN_AUTO", "true").strip().lower() not in {"0", "false", "no"}
# Diretório raiz de persistência por persona (server/runtime/video-gen/{persona_id}/).
ODESSA_VIDEO_GEN_DIR = Path(os.getenv("ODESSA_VIDEO_GEN_DIR", RUNTIME_DIR / "video-gen"))
# Tamanho máximo da fila de vídeos pendentes por persona.
VIDEO_GEN_MAX_QUEUE = int(os.getenv("VIDEO_GEN_MAX_QUEUE", "8"))

# ── Higgsfield (fotos/vídeos com personagem consistente via SoulId) ────────
HIGGSFIELD_KEY_ID = os.getenv("HIGGSFIELD_KEY_ID", "").strip()
HIGGSFIELD_KEY_SECRET = os.getenv("HIGGSFIELD_KEY_SECRET", "").strip()
HIGGSFIELD_BASE_URL = os.getenv("HIGGSFIELD_BASE_URL", "https://api.higgsfield.ai").strip()
HIGGSFIELD_POLL_INTERVAL_SEC = float(os.getenv("HIGGSFIELD_POLL_INTERVAL_SEC", "3"))
HIGGSFIELD_POLL_TIMEOUT_SEC = float(os.getenv("HIGGSFIELD_POLL_TIMEOUT_SEC", "120"))

# ── Geração de foto autônoma da persona (autoconfig via conversa) ──────────
# Provedor: "higgsfield" (SoulId, consistência de personagem -- usado só se
# HIGGSFIELD_KEY_ID estiver configurada) ou "gemini" (fallback, sempre
# disponível se GEMINI_API_KEY estiver configurada).
PHOTO_GEN_PROVIDER = os.getenv(
    "PHOTO_GEN_PROVIDER", "higgsfield" if HIGGSFIELD_KEY_ID else "gemini"
).strip().lower()
PHOTO_GEN_COOLDOWN_MS = int(os.getenv("PHOTO_GEN_COOLDOWN_MS", "30000"))
MAX_GENERATED_PHOTOS = int(os.getenv("MAX_GENERATED_PHOTOS", "20"))

# Allowlist de hosts de webhook (sufixos; ex.: "hooks.n8n.cloud,hook.eu2.make.com").
# Vazio = apenas o host de N8N_ACTION_WEBHOOK_URL (se houver) é permitido.
WEBHOOK_ALLOWED_HOSTS = [
    host.strip().lower()
    for host in os.getenv("ODESSA_WEBHOOK_ALLOWED_HOSTS", "").split(",")
    if host.strip()
]

# Limites de payload: upload de vídeo e frame base64 (data URL)
VIDEO_UPLOAD_MAX_BYTES = int(os.getenv("VIDEO_UPLOAD_MAX_BYTES", str(256 * 1024 * 1024)))
VIDEO_FRAME_MAX_BYTES = int(os.getenv("VIDEO_FRAME_MAX_BYTES", str(8 * 1024 * 1024)))
# Formato do frame base capturado (png|jpg).
VIDEO_GEN_FRAME_FORMAT = os.getenv("VIDEO_GEN_FRAME_FORMAT", "png").strip().lower()
# Duração (segundos) e resolução padrão do vídeo gerado.
VIDEO_GEN_DURATION_SEC = float(os.getenv("VIDEO_GEN_DURATION_SEC", "4"))
VIDEO_GEN_WIDTH = int(os.getenv("VIDEO_GEN_WIDTH", "720"))
VIDEO_GEN_HEIGHT = int(os.getenv("VIDEO_GEN_HEIGHT", "1280"))
# Nº de interações de chat acumuladas antes de gerar um prompt automaticamente.
VIDEO_GEN_PROMPT_THRESHOLD = int(os.getenv("VIDEO_GEN_PROMPT_THRESHOLD", "5"))
# Cooldown mínimo (ms) entre gerações automáticas.
VIDEO_GEN_COOLDOWN_MS = int(os.getenv("VIDEO_GEN_COOLDOWN_MS", "30000"))
