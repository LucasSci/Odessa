import logging
import time
import io
import base64
import re
from datetime import datetime, timezone
from typing import Optional, Dict, Any

import numpy as np
import easyocr
from PIL import Image, ImageGrab, UnidentifiedImageError
from fastapi import HTTPException

from server.models import RegionRequest

logger = logging.getLogger("odessa.ocr")

class OCRService:
    def __init__(self):
        logger.info("Initializing EasyOCR reader...")
        # Note: GPU is disabled by default for better compatibility in local dev
        self.reader = easyocr.Reader(["en", "pt"], gpu=False)
        logger.info("EasyOCR reader initialized")
        self.last_full_text_by_zone: Dict[str, str] = {}

    def decode_request_image(self, image_data: str) -> bytes:
        try:
            if "," in image_data:
                image_data = image_data.split(",")[1]
            return base64.b64decode(image_data)
        except Exception as exc:
            raise HTTPException(status_code=400, detail="Invalid base64 image data") from exc

    def validate_ocr_dimensions(self, width: int, height: int) -> None:
        if width > 4000 or height > 4000:
            raise HTTPException(status_code=400, detail="Image dimensions too large for OCR")
        if width < 10 or height < 10:
            raise HTTPException(status_code=400, detail="Image dimensions too small for OCR")

    def image_from_request(self, request: RegionRequest) -> np.ndarray:
        if request.image:
            image_bytes = self.decode_request_image(request.image)
            try:
                with Image.open(io.BytesIO(image_bytes)) as image:
                    self.validate_ocr_dimensions(image.width, image.height)
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

        self.validate_ocr_dimensions(request.width, request.height)

        # Use PIL.ImageGrab for robust capture that works even when window is not focused
        # This is crucial for persistent OCR during tab switching
        try:
            screenshot = ImageGrab.grab(
                bbox=(request.x, request.y, request.x + request.width, request.y + request.height)
            )
            logger.debug(f"Successfully captured region via PIL.ImageGrab: ({request.x}, {request.y}, {request.width}x{request.height})")
            return np.array(screenshot.convert("RGB"))
        except Exception as grab_error:
            logger.warning(f"PIL.ImageGrab failed, attempting fallback: {grab_error}")
            # Fallback to full desktop screenshot if region capture fails
            try:
                full_screenshot = ImageGrab.grab()
                # Crop to requested region
                cropped = full_screenshot.crop(
                    (request.x, request.y, request.x + request.width, request.y + request.height)
                )
                return np.array(cropped.convert("RGB"))
            except Exception as fallback_error:
                logger.error(f"Both PIL.ImageGrab methods failed: {fallback_error}", exc_info=True)
                raise HTTPException(status_code=500, detail="Screenshot capture failed") from fallback_error

    def get_new_text(self, prev_text: str, current_text: str) -> str:
        """Simple diff to get new content. In a real scenario, this could be more complex."""
        if not prev_text:
            return current_text
        if current_text.startswith(prev_text):
            return current_text[len(prev_text):].strip()
        # Fallback: if it doesn't match perfectly, return current if different enough
        return current_text if current_text != prev_text else ""

    def process_ocr(self, request: RegionRequest) -> Dict[str, Any]:
        started_at = time.perf_counter()
        zone_id = (request.zone_id or "global").strip() or "global"
        zone_name = (request.zone_name or zone_id).strip() or zone_id

        try:
            img_array = self.image_from_request(request)
            results = self.reader.readtext(img_array)
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
        except HTTPException:
            raise
        except Exception as exc:
            logger.error("[OCR SERVICE EXCEPTION] %s", exc, exc_info=True)
            raise HTTPException(status_code=500, detail=str(exc)) from exc

# Singleton instance
ocr_service = OCRService()
