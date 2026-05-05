import logging
import time
from datetime import datetime, timezone
from typing import Dict, Any

from server.models import RegionRequest
from server.services.ocr.engine import OCREngine
from server.services.ocr.capture import ScreenCapturer

logger = logging.getLogger("odessa.ocr.service")

class OCRService:
    def __init__(self):
        self.engine = OCREngine()
        self.capturer = ScreenCapturer()
        self.last_full_text_by_zone: Dict[str, str] = {}

    def get_new_text(self, prev_text: str, current_text: str) -> str:
        if not prev_text:
            return current_text
        if current_text.startswith(prev_text):
            return current_text[len(prev_text):].strip()
        return current_text if current_text != prev_text else ""

    def process_ocr(self, request: RegionRequest) -> Dict[str, Any]:
        started_at = time.perf_counter()
        zone_id = (request.zone_id or "global").strip() or "global"
        zone_name = (request.zone_name or zone_id).strip() or zone_id

        if not request.image and request.x is None:
            return {"error": "Neither image nor capture coordinates (x) provided", "text": ""}

        try:
            # 1. Get Image
            if request.image:
                img_bytes = self.capturer.decode_base64(request.image)
                img_array = self.capturer.from_bytes(img_bytes)
            else:
                img_array = self.capturer.capture_region(
                    request.x or 0, request.y or 0, 
                    request.width or 100, request.height or 100
                )

            # 2. Extract Text
            results = self.engine.extract_full_data(img_array)
            text = " ".join(result[1] for result in results).strip()
            
            # 3. Calculate Confidence
            confidence_values = [float(result[2]) for result in results if len(result) > 2]
            confidence = sum(confidence_values) / len(confidence_values) if confidence_values else None

            # 4. Diff logic for persistent scrolling text
            previous_text = self.last_full_text_by_zone.get(zone_id, "")
            new_content = self.get_new_text(previous_text, text)
            self.last_full_text_by_zone[zone_id] = text

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
        except Exception as exc:
            logger.error(f"[OCR SERVICE ERROR] {exc}", exc_info=True)
            return {"error": str(exc), "text": ""}

# Singleton instance
ocr_service = OCRService()
