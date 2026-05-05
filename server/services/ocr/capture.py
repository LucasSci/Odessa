import logging
import io
import base64
import numpy as np
from PIL import Image, ImageGrab, UnidentifiedImageError
from fastapi import HTTPException

logger = logging.getLogger("odessa.ocr.capture")

class ScreenCapturer:
    @staticmethod
    def decode_base64(image_data: str) -> bytes:
        try:
            if "," in image_data:
                image_data = image_data.split(",")[1]
            return base64.b64decode(image_data)
        except Exception as exc:
            raise HTTPException(status_code=400, detail="Invalid base64 image data") from exc

    def capture_region(self, x: int, y: int, width: int, height: int) -> np.ndarray:
        try:
            screenshot = ImageGrab.grab(bbox=(x, y, x + width, y + height))
            return np.array(screenshot.convert("RGB"))
        except Exception as grab_error:
            logger.warning(f"Region capture failed, attempting full fallback: {grab_error}")
            try:
                full_screenshot = ImageGrab.grab()
                cropped = full_screenshot.crop((x, y, x + width, y + height))
                return np.array(cropped.convert("RGB"))
            except Exception as fallback_error:
                logger.error(f"Screenshot capture failed: {fallback_error}")
                raise HTTPException(status_code=500, detail="Capture failed") from fallback_error

    def from_bytes(self, image_bytes: bytes) -> np.ndarray:
        try:
            with Image.open(io.BytesIO(image_bytes)) as image:
                return np.array(image.convert("RGB"))
        except Exception as exc:
            raise HTTPException(status_code=400, detail="Invalid image bytes") from exc
