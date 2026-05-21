import logging
import time
import hashlib
import re
import unicodedata
from datetime import datetime, timezone
from typing import Dict, Any

import threading
import json
import os

from server.models import RegionRequest
from server.services.ocr.engine import OCREngine
from server.services.ocr.capture import ScreenCapturer

logger = logging.getLogger("odessa.ocr.service")

class OCRService:
    def __init__(self):
        self.engine = OCREngine()
        self.capturer = ScreenCapturer()
        self.last_full_text_by_zone: Dict[str, str] = {}
        self.seen_lines_by_zone: Dict[str, Dict[str, float]] = {}
        self.last_line_hashes_by_zone: Dict[str, set[str]] = {}

        self.config_path = os.path.join(os.getcwd(), "server", "data", "ocr_config.json")
        self.config = self._load_config()

        # Background worker state
        self._is_running = False
        self._worker_thread = None

    def _load_config(self) -> Dict[str, Any]:
        if os.path.exists(self.config_path):
            try:
                with open(self.config_path, "r") as f:
                    return json.load(f)
            except Exception as e:
                logger.error(f"Failed to load OCR config: {e}")
        return {"x": 0, "y": 0, "width": 400, "height": 600, "interval_ms": 2000, "enabled": False}

    def save_config(self, config: Dict[str, Any]):
        self.config.update(config)
        os.makedirs(os.path.dirname(self.config_path), exist_ok=True)
        try:
            with open(self.config_path, "w") as f:
                json.dump(self.config, f, indent=2)
        except Exception as e:
            logger.error(f"Failed to save OCR config: {e}")

        # Restart loop if enabled state changed
        if self.config.get("enabled", False):
            self.start_loop()
        else:
            self.stop_loop()

    def start_loop(self):
        if self._is_running:
            return
        self._is_running = True
        self._worker_thread = threading.Thread(target=self._capture_loop, daemon=True)
        self._worker_thread.start()
        logger.info("OCR Background loop started.")

    def stop_loop(self):
        self._is_running = False
        logger.info("OCR Background loop stopped.")

    def _capture_loop(self):
        while self._is_running:
            try:
                interval = self.config.get("interval_ms", 2000) / 1000.0
                request = RegionRequest(
                    x=self.config.get("x", 0),
                    y=self.config.get("y", 0),
                    width=self.config.get("width", 400),
                    height=self.config.get("height", 600),
                    zone_id="live_chat"
                )
                self.process_ocr(request)
            except Exception as e:
                logger.error(f"Error in OCR loop: {e}")
            time.sleep(self.config.get("interval_ms", 2000) / 1000.0)

    def _normalize_line(self, line: str) -> str:
        text = unicodedata.normalize("NFKD", line or "")
        text = text.encode("ascii", "ignore").decode("ascii").lower()
        text = re.sub(r"\s+", " ", text)
        text = re.sub(r"[^\w@.+:* x-]+", "", text)
        return text.strip()

    def _line_hash(self, line: str) -> str:
        return hashlib.sha1(self._normalize_line(line).encode("utf-8")).hexdigest()[:16]

    def _cleanup_seen_lines(self, zone_id: str, now: float, ttl_seconds: float) -> None:
        seen = self.seen_lines_by_zone.setdefault(zone_id, {})
        expired = [key for key, ts in seen.items() if now - ts > ttl_seconds]
        for key in expired:
            seen.pop(key, None)

    def get_new_text(self, prev_text: str, current_text: str, zone_id: str = "global") -> dict[str, Any]:
        now = time.time()
        ttl_seconds = float(self.config.get("dedup_window_ms", 45000) or 45000) / 1000.0
        self._cleanup_seen_lines(zone_id, now, ttl_seconds)

        current_lines = [line.strip() for line in re.split(r"[\r\n]+", current_text or "") if line.strip()]
        previous_lines = [line.strip() for line in re.split(r"[\r\n]+", prev_text or "") if line.strip()]
        previous_hashes = {self._line_hash(line) for line in previous_lines}
        seen = self.seen_lines_by_zone.setdefault(zone_id, {})
        accepted: list[str] = []
        duplicate_hashes: list[str] = []

        for line in current_lines:
            normalized = self._normalize_line(line)
            if not normalized:
                continue
            line_hash = self._line_hash(line)
            is_repeat = line_hash in previous_hashes or line_hash in seen
            if is_repeat:
                duplicate_hashes.append(line_hash)
                continue
            accepted.append(line)
            seen[line_hash] = now

        if not accepted and prev_text and current_text.startswith(prev_text):
            suffix = current_text[len(prev_text):].strip()
            if suffix:
                suffix_hash = self._line_hash(suffix)
                if suffix_hash not in seen:
                    accepted.append(suffix)
                    seen[suffix_hash] = now

        new_content = "\n".join(accepted).strip()
        current_hashes = {self._line_hash(line) for line in current_lines}
        self.last_line_hashes_by_zone[zone_id] = current_hashes
        return {
            "text": new_content,
            "deduped": not bool(new_content) and bool(current_lines),
            "duplicateReason": "seen_line_hash" if duplicate_hashes else ("unchanged_text" if current_text == prev_text else None),
            "lineHashes": list(current_hashes),
            "newLineHashes": [self._line_hash(line) for line in accepted],
        }

    def process_ocr(self, request: RegionRequest, route_to_automation: bool = False) -> Dict[str, Any]:
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
                    int(round(request.x or 0)),
                    int(round(request.y or 0)),
                    int(round(request.width or 100)),
                    int(round(request.height or 100)),
                )

            # 2. Extract Text
            results = self.engine.extract_full_data(img_array)
            text = " ".join(result[1] for result in results).strip()

            # 3. Calculate Confidence
            confidence_values = [float(result[2]) for result in results if len(result) > 2]
            confidence = sum(confidence_values) / len(confidence_values) if confidence_values else None

            # 4. Diff logic for persistent scrolling text
            previous_text = self.last_full_text_by_zone.get(zone_id, "")
            diff = self.get_new_text(previous_text, text, zone_id)
            new_content = diff["text"]
            self.last_full_text_by_zone[zone_id] = text

            # 5. Optional Automation Layer Integration
            if route_to_automation and new_content:
                try:
                    from server.services.automation_service import automation_service
                    automation_service.process_raw_text(new_content)
                except Exception as e:
                    logger.error(f"Automation processing failed: {e}")

            return {
                "text": new_content,
                "full_text": text,
                "error": None,
                "zone_id": zone_id,
                "zone_name": zone_name,
                "confidence": confidence,
                "deduped": diff["deduped"],
                "duplicateReason": diff["duplicateReason"],
                "lineHash": diff["newLineHashes"][0] if diff["newLineHashes"] else None,
                "lineHashes": diff["lineHashes"],
                "captureMode": "image" if request.image else "screen_region",
                "zoneRole": getattr(request, "zone_role", None),
                "sourceHealth": {
                    "ok": bool(text),
                    "hasText": bool(text),
                    "hasNewText": bool(new_content),
                    "confidence": confidence,
                },
                "latency_ms": round((time.perf_counter() - started_at) * 1000),
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
        except Exception as exc:
            logger.error(f"[OCR SERVICE ERROR] {exc}", exc_info=True)
            return {"error": str(exc), "text": ""}

# Singleton instance
ocr_service = OCRService()
