from pathlib import Path
from typing import Optional
import base64
import binascii
from datetime import datetime, timezone
import io
import json
import logging
import os
import tempfile
import time

import easyocr
import edge_tts
import numpy as np
import pyautogui
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from google import genai
from openai import OpenAI
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel
from starlette.background import BackgroundTask

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
Image.MAX_IMAGE_PIXELS = MAX_OCR_IMAGE_PIXELS

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "").strip()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()

openai_client = OpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None
gemini_client = genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None

last_full_text_by_zone: dict[str, str] = {}

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Odessa Local Capture API")

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

logger.info("Initializing EasyOCR reader...")
reader = easyocr.Reader(["en", "pt"], gpu=False)
logger.info("EasyOCR reader initialized")

DEFAULT_CHAT_REGION = (17, 145, 331, 405)
DEFAULT_GIFTS_REGION = (600, 200, 200, 300)


class RegionRequest(BaseModel):
    zone_id: Optional[str] = None
    zone_name: Optional[str] = None
    x: Optional[int] = None
    y: Optional[int] = None
    width: Optional[int] = None
    height: Optional[int] = None
    image: Optional[str] = None


class AIRespondRequest(BaseModel):
    persona_prompt: str
    chat_context: str
    model: str = "gemini-2.5-flash"
    temperature: float = 0.9


class LiveEventPayload(BaseModel):
    id: str
    source: str = "manual"
    zoneName: str = "Controle Live"
    text: str
    kind: str = "chat"
    createdAt: str
    time: str


class AIDecideRequest(BaseModel):
    persona_prompt: str
    events: list[LiveEventPayload]
    mode: str = "autopilot_audited"
    model: str = "gemini-2.5-flash"
    temperature: float = 0.72


ALLOWED_ACTIONS = {
    "speak",
    "chat_reply",
    "ack_gift",
    "moderate_message",
    "switch_scene",
    "show_overlay",
    "log_event",
}


def get_new_text(prev_text: str, current_text: str) -> str:
    if not prev_text:
        return current_text

    max_len = min(len(prev_text), 50)
    for length in range(max_len, 9, -1):
        suffix = prev_text[-length:]
        idx = current_text.find(suffix)
        if idx != -1:
            return current_text[idx + length :].strip()

    if abs(len(prev_text) - len(current_text)) < 10:
        return ""

    return current_text


def save_to_log(text: str) -> None:
    try:
        LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        if LOG_FILE.exists():
            lines = LOG_FILE.read_text(encoding="utf-8").splitlines()
            if lines and text.strip() in lines[-1]:
                return

        with LOG_FILE.open("a", encoding="utf-8") as file:
            file.write(f"{text}\n")
        logger.info("Saved capture log entry")
    except Exception as exc:
        logger.error("Error saving capture log: %s", exc)


def cleanup_temp_file(path: str) -> None:
    try:
        Path(path).unlink(missing_ok=True)
    except Exception as exc:
        logger.warning("Could not remove temp file %s: %s", path, exc)


def extract_json_object(text: str) -> dict:
    cleaned = text.strip()
    if cleaned.startswith("```"):
      cleaned = cleaned.strip("`")
      if cleaned.lower().startswith("json"):
          cleaned = cleaned[4:].strip()

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise
        return json.loads(cleaned[start : end + 1])


def normalize_decision(raw: dict, fallback_text: str) -> dict:
    speech = str(raw.get("speech") or "").strip()
    if not speech:
        speech = "Vou acompanhar isso agora e manter a live fluindo."

    intent = str(raw.get("intent") or "respond_live_event").strip()
    reason = str(raw.get("reason") or "Decisao baseada no evento recebido.").strip()
    priority = str(raw.get("priority") or "normal").strip().lower()
    if priority not in {"low", "normal", "high", "urgent"}:
        priority = "normal"

    try:
        confidence = float(raw.get("confidence", 0.7))
    except (TypeError, ValueError):
        confidence = 0.7
    confidence = max(0, min(1, confidence))

    actions = raw.get("actions")
    normalized_actions = []
    if isinstance(actions, list):
        for index, action in enumerate(actions):
            if not isinstance(action, dict):
                continue
            action_type = str(action.get("type") or "log_event").strip()
            if action_type not in ALLOWED_ACTIONS:
                action_type = "log_event"
            label = str(action.get("label") or action_type).strip()
            payload = action.get("payload")
            if not isinstance(payload, dict):
                payload = {}
            normalized_actions.append(
                {
                    "id": str(action.get("id") or f"action-{index + 1}"),
                    "type": action_type,
                    "label": label,
                    "payload": payload,
                    "simulated": action_type != "speak",
                    "status": "queued",
                }
            )

    if not any(action["type"] == "speak" for action in normalized_actions):
        normalized_actions.insert(
            0,
            {
                "id": "action-speak",
                "type": "speak",
                "label": "Falar via TTS",
                "payload": {"text": speech},
                "simulated": False,
                "status": "queued",
            },
        )

    if not normalized_actions:
        normalized_actions.append(
            {
                "id": "action-log",
                "type": "log_event",
                "label": "Registrar evento",
                "payload": {"message": fallback_text},
                "simulated": True,
                "status": "queued",
            }
        )

    return {
        "speech": speech,
        "intent": intent,
        "confidence": confidence,
        "reason": reason,
        "priority": priority,
        "actions": normalized_actions,
    }


def load_regions() -> tuple[tuple[int, int, int, int], tuple[int, int, int, int]]:
    if REGION_FILE.exists():
        try:
            import json

            data = json.loads(REGION_FILE.read_text(encoding="utf-8"))
            return (
                tuple(data.get("chat_region", DEFAULT_CHAT_REGION)),
                tuple(data.get("gifts_region", DEFAULT_GIFTS_REGION)),
            )
        except Exception as exc:
            logger.warning("Cannot load %s: %s", REGION_FILE, exc)
    return DEFAULT_CHAT_REGION, DEFAULT_GIFTS_REGION


def decode_request_image(image_data: str) -> bytes:
    img_data = image_data.split(",", 1)[1] if "," in image_data else image_data
    img_data = "".join(img_data.split())
    estimated_bytes = (len(img_data) * 3) // 4
    if estimated_bytes > MAX_OCR_IMAGE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Image is too large for OCR. Limit is {MAX_OCR_IMAGE_BYTES} bytes.",
        )

    try:
        image_bytes = base64.b64decode(img_data, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Invalid base64 image payload") from exc

    if len(image_bytes) > MAX_OCR_IMAGE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Image is too large for OCR. Limit is {MAX_OCR_IMAGE_BYTES} bytes.",
        )
    return image_bytes


def validate_ocr_dimensions(width: int, height: int) -> None:
    if width * height > MAX_OCR_IMAGE_PIXELS:
        raise HTTPException(
            status_code=413,
            detail=f"Image dimensions are too large for OCR. Limit is {MAX_OCR_IMAGE_PIXELS} pixels.",
        )


def image_from_request(request: RegionRequest) -> np.ndarray:
    if request.image:
        image_bytes = decode_request_image(request.image)
        try:
            with Image.open(io.BytesIO(image_bytes)) as image:
                validate_ocr_dimensions(image.width, image.height)
                return np.array(image.convert("RGB"))
        except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
            raise HTTPException(status_code=400, detail="Invalid image payload") from exc

    if (
        request.x is None
        or request.y is None
        or request.width is None
        or request.height is None
        or request.width <= 0
        or request.height <= 0
    ):
        raise HTTPException(status_code=400, detail="Invalid dimensions or missing image")

    validate_ocr_dimensions(request.width, request.height)

    screenshot = pyautogui.screenshot(
        region=(request.x, request.y, request.width, request.height)
    )
    return np.array(screenshot)


@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "ocr": "ready",
        "gemini_configured": bool(GEMINI_API_KEY),
        "openai_tts_configured": bool(OPENAI_API_KEY),
    }


@app.get("/")
def read_root():
    return {"message": "Odessa local capture API is running"}


@app.post("/ocr")
def perform_ocr(request: RegionRequest):
    started_at = time.perf_counter()
    zone_id = (request.zone_id or "global").strip() or "global"
    zone_name = (request.zone_name or zone_id).strip() or zone_id

    try:
        img_array = image_from_request(request)
        results = reader.readtext(img_array)
        text = " ".join(result[1] for result in results).strip()
        confidence_values = [
            float(result[2])
            for result in results
            if len(result) > 2 and isinstance(result[2], (float, int))
        ]
        confidence = (
            sum(confidence_values) / len(confidence_values)
            if confidence_values
            else None
        )

        previous_text = last_full_text_by_zone.get(zone_id, "")
        new_content = get_new_text(previous_text, text)
        last_full_text_by_zone[zone_id] = text

        if new_content and len(new_content) > 1:
            save_to_log(new_content)

        return {
            "text": new_content,
            "full_text": text,
            "error": None,
            "zone_id": zone_id,
            "zone_name": zone_name,
            "confidence": confidence,
            "latency_ms": round((time.perf_counter() - started_at) * 1000),
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("[OCR EXCEPTION] %s", exc, exc_info=True)
        return {
            "text": "",
            "full_text": "",
            "error": str(exc),
            "zone_id": zone_id,
            "zone_name": zone_name,
            "confidence": None,
            "latency_ms": round((time.perf_counter() - started_at) * 1000),
            "created_at": datetime.now(timezone.utc).isoformat(),
        }


@app.post("/ai/respond")
def generate_ai_response(request: AIRespondRequest):
    if not gemini_client:
        raise HTTPException(
            status_code=503,
            detail="GEMINI_API_KEY is not configured on the backend",
        )

    chat_context = request.chat_context.strip()
    if not chat_context:
        raise HTTPException(status_code=400, detail="chat_context is required")

    try:
        result = gemini_client.models.generate_content(
            model=request.model,
            contents=(
                "[MENSAGENS DO CHAT RECEBIDAS AGORA]:\n"
                f"{chat_context}\n\n"
                "Responda agora como a streamer:"
            ),
            config={
                "system_instruction": request.persona_prompt,
                "temperature": request.temperature,
            },
        )
        return {"response": result.text or ""}
    except Exception as exc:
        logger.error("[AI EXCEPTION] %s", exc, exc_info=True)
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/ai/decide")
def generate_autopilot_decision(request: AIDecideRequest):
    if not gemini_client:
        raise HTTPException(
            status_code=503,
            detail="GEMINI_API_KEY is not configured on the backend",
        )

    if not request.events:
        raise HTTPException(status_code=400, detail="events is required")

    events_payload = [
        {
            "id": event.id,
            "source": event.source,
            "zoneName": event.zoneName,
            "kind": event.kind,
            "text": event.text,
            "createdAt": event.createdAt,
        }
        for event in request.events[-5:]
    ]
    fallback_text = events_payload[-1]["text"]

    decision_contract = {
        "speech": "fala curta da streamer em portugues",
        "intent": "respond_chat | thank_gift | moderate | switch_scene | handle_alert | log_only",
        "confidence": 0.0,
        "reason": "por que esta decisao foi escolhida",
        "priority": "low | normal | high | urgent",
        "actions": [
            {
                "id": "action-1",
                "type": "speak | chat_reply | ack_gift | moderate_message | switch_scene | show_overlay | log_event",
                "label": "nome humano curto",
                "payload": {"text": "detalhes da acao"},
                "simulated": True,
                "status": "queued",
            }
        ],
    }

    try:
        result = gemini_client.models.generate_content(
            model=request.model,
            contents=(
                "Eventos recentes da live em JSON:\n"
                f"{json.dumps(events_payload, ensure_ascii=False)}\n\n"
                "Retorne APENAS um objeto JSON valido seguindo exatamente este contrato:\n"
                f"{json.dumps(decision_contract, ensure_ascii=False)}\n\n"
                "Regras:\n"
                "- Inclua sempre uma action 'speak' com simulated=false para a fala da streamer.\n"
                "- Use 'ack_gift' para presentes, 'moderate_message' para spam/risco, "
                "'switch_scene' para pedido de cena/OBS, 'show_overlay' para alerta visual e "
                "'chat_reply' para resposta textual ao chat.\n"
                "- Acoes externas que nao sejam speak devem vir com simulated=true.\n"
                "- Seja seguro, curto e operacional."
            ),
            config={
                "system_instruction": request.persona_prompt,
                "temperature": request.temperature,
                "response_mime_type": "application/json",
            },
        )
        parsed = extract_json_object(result.text or "{}")
        return normalize_decision(parsed, fallback_text)
    except json.JSONDecodeError as exc:
        logger.error("[AI DECIDE JSON EXCEPTION] %s", exc, exc_info=True)
        raise HTTPException(status_code=502, detail="AI returned invalid JSON") from exc
    except Exception as exc:
        logger.error("[AI DECIDE EXCEPTION] %s", exc, exc_info=True)
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.get("/regions")
def get_regions():
    chat, gifts = load_regions()
    return {
        "chat_region": {"x": chat[0], "y": chat[1], "width": chat[2], "height": chat[3]},
        "gifts_region": {
            "x": gifts[0],
            "y": gifts[1],
            "width": gifts[2],
            "height": gifts[3],
        },
    }


@app.get("/log")
def get_log():
    try:
        if LOG_FILE.exists():
            lines = LOG_FILE.read_text(encoding="utf-8").splitlines(keepends=True)
            return {"log": lines[-50:], "total_lines": len(lines)}
        return {"log": [], "total_lines": 0}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/clear-log")
def clear_log():
    try:
        LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        LOG_FILE.write_text("", encoding="utf-8")
        return {"message": "Log cleared"}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/tts")
async def generate_tts(request: Request):
    data = await request.json()
    text = data.get("text", "").strip()
    voice = data.get("voice", "nova")

    if not text:
        raise HTTPException(status_code=400, detail="No text provided")

    temp_path: Optional[str] = None
    try:
        openai_voices = {"alloy", "echo", "fable", "onyx", "nova", "shimmer"}
        if voice in openai_voices:
            if not openai_client:
                raise HTTPException(
                    status_code=503,
                    detail="OPENAI_API_KEY is not configured for premium TTS voices",
                )

        temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".mp3")
        temp_path = temp_file.name
        temp_file.close()

        if voice in openai_voices:
            response = openai_client.audio.speech.create(
                model="tts-1",
                voice=voice,
                input=text,
            )
            response.stream_to_file(temp_path)
        else:
            communicate = edge_tts.Communicate(text, voice)
            await communicate.save(temp_path)

        return FileResponse(
            temp_path,
            media_type="audio/mpeg",
            background=BackgroundTask(cleanup_temp_file, temp_path),
        )
    except HTTPException:
        if temp_path:
            cleanup_temp_file(temp_path)
        raise
    except Exception as exc:
        if temp_path:
            cleanup_temp_file(temp_path)
        logger.error("[TTS EXCEPTION] %s", exc, exc_info=True)
        raise HTTPException(status_code=502, detail=str(exc)) from exc


if __name__ == "__main__":
    import uvicorn

    logger.info("Starting server on http://0.0.0.0:8000")
    uvicorn.run(app, host="0.0.0.0", port=8000)
