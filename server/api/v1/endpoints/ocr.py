import base64
import io
import logging
import time
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from PIL import Image, ImageEnhance, ImageOps
from pydantic import BaseModel

from server.config import OBS_OCR_SOURCE_NAME
from server.models import RegionRequest
from server.services.obs_service import obs_service

router = APIRouter(tags=["OCR"])
logger = logging.getLogger("odessa.routes.ocr")


def get_ocr_service():
    from server.services.ocr_service import ocr_service

    return ocr_service


class ObsOcrZone(BaseModel):
    id: str
    name: Optional[str] = None
    role: Optional[str] = None
    x: float
    y: float
    width: float
    height: float


class ObsOcrCycleRequest(BaseModel):
    sourceName: Optional[str] = None
    zones: list[ObsOcrZone]
    settings: Optional[dict[str, Any]] = None


class OcrIngestRequest(BaseModel):
    lines: list[str] | None = None
    text: str | None = None
    source: str = "ocr"
    zoneName: str | None = None
    zoneRole: str | None = None
    zoneId: str | None = None


def _decode_data_url(image_data: str) -> Image.Image:
    encoded = image_data.split(",", 1)[1] if "," in image_data else image_data
    raw = base64.b64decode(encoded)
    return Image.open(io.BytesIO(raw)).convert("RGB")


def _zone_to_data_url(image: Image.Image, zone: ObsOcrZone, settings: dict[str, Any]) -> str:
    left = max(0, min(image.width - 1, int(zone.x)))
    top = max(0, min(image.height - 1, int(zone.y)))
    right = max(left + 1, min(image.width, left + max(1, int(zone.width))))
    bottom = max(top + 1, min(image.height, top + max(1, int(zone.height))))
    cropped = image.crop((left, top, right, bottom))

    magnification = max(1, int(round(float(settings.get("magnification", 1) or 1))))
    if magnification > 1:
        cropped = cropped.resize(
            (cropped.width * magnification, cropped.height * magnification),
            Image.Resampling.NEAREST,
        )

    cropped = ImageOps.grayscale(cropped)
    contrast = float(settings.get("contrast", 1.0) or 1.0)
    brightness = float(settings.get("brightness", 1.0) or 1.0)
    if contrast != 1.0:
        cropped = ImageEnhance.Contrast(cropped).enhance(contrast)
    if brightness != 1.0:
        cropped = ImageEnhance.Brightness(cropped).enhance(brightness)

    buffer = io.BytesIO()
    cropped.convert("RGB").save(buffer, format="PNG")
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"

@router.post("/process")
async def process_ocr(request: RegionRequest):
    """
    Process OCR on a specific screen region or provided image.
    """
    result = get_ocr_service().process_ocr(request)
    if result.get("error"):
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@router.post("/ingest")
async def ingest_ocr(request: OcrIngestRequest):
    """Local FastAPI parity for the Hostinger /api/ocr/ingest handler."""
    from server.services.automation_service import automation_service

    raw_lines = request.lines if isinstance(request.lines, list) else None
    lines = [
        str(line).strip()
        for line in (raw_lines or str(request.text or "").splitlines())
        if str(line).strip()
    ]

    if not lines:
        return {
            "ok": True,
            "linesProcessed": 0,
            "triggered": [],
            "noMatch": [],
            "triggerQueueSize": len(automation_service.get_pending_actions()),
            "zoneName": request.zoneName,
            "zoneRole": request.zoneRole,
            "mode": "local",
        }

    triggered: list[dict[str, Any]] = []
    no_match: list[dict[str, Any]] = []

    hint_kind = "gift" if request.zoneRole in {"gift", "gifts"} else None
    for line in lines:
        summary = automation_service.process_raw_text(
            line,
            event_hint={
                "kind": hint_kind,
                "zoneName": request.zoneName,
                "metadata": {
                    "source": request.source,
                    "zoneId": request.zoneId,
                    "zoneRole": request.zoneRole,
                },
            },
            queue_actions=True,
        )
        events = summary.get("events") if isinstance(summary, dict) else []
        event = events[0] if events else {}
        actions = summary.get("actions") if isinstance(summary, dict) else []
        matched = summary.get("matchedTriggers") if isinstance(summary, dict) else []

        if actions:
            for index, action in enumerate(actions):
                match = matched[index] if index < len(matched) else {}
                gift_key = event.get("gift_key") or event.get("giftKey")
                triggered.append(
                    {
                        "triggerId": action.get("trigger_id") or match.get("id") or "",
                        "triggerName": action.get("trigger_name") or match.get("name") or "",
                        "targetVideoId": action.get("videoId") or match.get("videoId") or "",
                        "queueSize": len(automation_service.get_pending_actions()),
                        "line": line,
                        "eventType": event.get("type") or event.get("kind") or "comment",
                        "kind": event.get("kind") or "chat",
                        "giftKey": gift_key,
                        "sender": event.get("sender") or event.get("user"),
                        "ocrRaw": event.get("ocrRaw"),
                    }
                )
        else:
            gift_key = event.get("gift_key") or event.get("giftKey")
            no_match.append(
                {
                    "eventType": event.get("type") or event.get("kind") or "comment",
                    "kind": event.get("kind") or "chat",
                    "line": line,
                    "reason": "no_trigger_match",
                    "giftKey": gift_key,
                    "sender": event.get("sender") or event.get("user"),
                    "ocrRaw": event.get("ocrRaw"),
                }
            )

    return {
        "ok": True,
        "linesProcessed": len(lines),
        "triggered": triggered,
        "noMatch": no_match,
        "triggerQueueSize": len(automation_service.get_pending_actions()),
        "zoneName": request.zoneName,
        "zoneRole": request.zoneRole,
        "mode": "local",
    }


@router.post("")
@router.post("/")
async def perform_ocr(request: RegionRequest):
    return get_ocr_service().process_ocr(request)


@router.post("/obs-cycle")
async def process_obs_cycle(request: ObsOcrCycleRequest):
    started_at = time.perf_counter()
    source_name = (request.sourceName or OBS_OCR_SOURCE_NAME).strip() or OBS_OCR_SOURCE_NAME
    settings = request.settings or {}

    if not request.zones:
        return {
            "ok": False,
            "sourceName": source_name,
            "image": None,
            "width": None,
            "height": None,
            "sourceActive": None,
            "sourceShowing": None,
            "frameHash": None,
            "capturedAt": None,
            "results": [],
            "error": "No OCR zones provided",
        }

    logger.info("[OCR] OBS cycle started")
    logger.info("[OCR] Zones received: %s", len(request.zones))

    try:
        screenshot = await obs_service.get_source_screenshot(source_name)
        image = _decode_data_url(screenshot["image"])
    except Exception as exc:
        logger.error("[OCR_ERROR] Failed to process OBS screenshot: %s", exc)
        return {
            "ok": False,
            "sourceName": source_name,
            "image": None,
            "width": None,
            "height": None,
            "sourceActive": None,
            "sourceShowing": None,
            "frameHash": None,
            "capturedAt": None,
            "results": [],
            "error": str(exc),
        }

    results: list[dict[str, Any]] = []
    events_detected = 0
    for zone in request.zones:
        try:
            zone_image = _zone_to_data_url(image, zone, settings)
            result = get_ocr_service().process_ocr(
                RegionRequest(
                    zone_id=zone.id,
                    zone_name=zone.name or zone.id,
                    x=zone.x,
                    y=zone.y,
                    width=zone.width,
                    height=zone.height,
                    image=zone_image,
                    zone_role=zone.role,
                )
            )
            result["zone_role"] = zone.role
            result["captureMode"] = "obs"
            result["sourceHealth"] = {
                **(result.get("sourceHealth") or {}),
                "obsSourceName": source_name,
                "sourceActive": screenshot.get("sourceActive"),
                "sourceShowing": screenshot.get("sourceShowing"),
                "frameHash": screenshot.get("frameHash"),
            }
            if result.get("text"):
                events_detected += 1
            results.append(result)
        except Exception as exc:
            logger.error("[OCR_ERROR] Zone %s failed: %s", zone.id, exc)
            results.append(
                {
                    "text": "",
                    "full_text": "",
                    "error": str(exc),
                    "zone_id": zone.id,
                    "zone_name": zone.name or zone.id,
                    "zone_role": zone.role,
                    "confidence": None,
                    "latency_ms": None,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                }
            )

    logger.info("[OCR] Events detected: %s", events_detected)
    return {
        "ok": True,
        "sourceName": source_name,
        "image": screenshot["image"],
        "width": screenshot["width"],
        "height": screenshot["height"],
        "sourceActive": screenshot.get("sourceActive"),
        "sourceShowing": screenshot.get("sourceShowing"),
        "frameHash": screenshot.get("frameHash"),
        "capturedAt": screenshot.get("capturedAt"),
        "results": results,
        "latency_ms": round((time.perf_counter() - started_at) * 1000),
        "error": None,
    }

@router.get("/zones")
async def get_zones():
    """
    Get history of processed zones.
    """
    return get_ocr_service().last_full_text_by_zone

@router.get("/config")
async def get_ocr_config():
    """Get the current OCR configuration."""
    return get_ocr_service().config

@router.post("/config")
async def set_ocr_config(config: dict):
    """Save the OCR configuration and apply it."""
    try:
        service = get_ocr_service()
        service.save_config(config)
        return {"status": "success", "config": service.config}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
