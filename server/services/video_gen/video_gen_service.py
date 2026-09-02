"""
video_gen_service.py — Orquestrador do pipeline de geração de vídeo.

Fluxo: interações de chat alimentam o buffer de prompts -> um prompt é gerado
via RouteLLM -> o prompt + o último frame base geram um vídeo via provedor ->
o vídeo é salvo, enfileirado e registrado no fluxo da persona ativa.

Processamento assíncrono: queued -> generating -> done/error.
"""
from __future__ import annotations

import logging
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from server.config import (
    VIDEO_GEN_MAX_QUEUE,
    VIDEO_GEN_DURATION_SEC,
    VIDEO_GEN_WIDTH,
    VIDEO_GEN_HEIGHT,
    VIDEO_GEN_COOLDOWN_MS,
)
from server.services.video_gen import storage
from server.services.video_gen.prompt_service import prompt_service
from server.services.video_gen.registry import get_provider

logger = logging.getLogger("odessa.video_gen.service")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class VideoGenService:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._processing = False
        self._last_generation_at = 0.0

    # ── Ingestão de eventos de chat ─────────────────────────────────────────
    def ingest_event(self, event: Dict[str, Any], persona_id: Optional[str] = None) -> Dict[str, Any]:
        """Alimenta o buffer de prompts e dispara geração automática se aplicável."""
        prompt_service.add_interaction(event, persona_id=persona_id)
        pid = persona_id or storage.get_active_persona_id()
        if prompt_service.should_auto_generate(pid):
            return self.auto_generate(persona_id=pid)
        return {"ok": True, "auto": False, "bufferSize": prompt_service.buffer_size(pid)}

    # ── Geração de prompt ───────────────────────────────────────────────────
    def generate_prompt(
        self,
        persona_id: Optional[str] = None,
        *,
        force: bool = False,
        custom_instruction: Optional[str] = None,
    ) -> Dict[str, Any]:
        return prompt_service.generate_prompt(
            persona_id,
            force=force,
            custom_instruction=custom_instruction,
        )

    def auto_generate(self, persona_id: Optional[str] = None, *, custom_instruction: Optional[str] = None) -> Dict[str, Any]:
        """Gera um prompt automaticamente e enfileira a geração de vídeo."""
        pid = persona_id or storage.get_active_persona_id()
        now_ms = time.time() * 1000
        if now_ms - self._last_generation_at < VIDEO_GEN_COOLDOWN_MS:
            return {"ok": True, "auto": True, "cooldown": True, "bufferSize": prompt_service.buffer_size(pid)}
        result = self.generate_prompt(pid, force=True, custom_instruction=custom_instruction)
        if not result.get("ok"):
            return result
        self._last_generation_at = now_ms
        enqueued = self.enqueue(result["prompt"], persona_id=pid)
        return {"ok": True, "auto": True, "prompt": result["prompt"], "enqueued": enqueued}

    # ── Fila ────────────────────────────────────────────────────────────────
    def enqueue(self, prompt_record: Dict[str, Any], persona_id: Optional[str] = None) -> Dict[str, Any]:
        pid = persona_id or storage.get_active_persona_id()
        queue = storage.get_queue(pid)
        if len(queue) >= VIDEO_GEN_MAX_QUEUE:
            return {"ok": False, "error": f"Fila cheia (máx {VIDEO_GEN_MAX_QUEUE})"}
        frame = storage.get_latest_frame(pid)
        item = {
            "id": str(uuid.uuid4()),
            "promptId": prompt_record.get("id"),
            "prompt": prompt_record.get("prompt", ""),
            "status": "queued",
            "framePath": str(frame) if frame else None,
            "videoId": None,
            "videoPath": None,
            "error": None,
            "createdAt": _now(),
            "updatedAt": _now(),
        }
        queue.append(item)
        storage.save_queue(queue, pid)
        self._start_processing(pid)
        return {"ok": True, "item": item}

    def get_queue(self, persona_id: Optional[str] = None) -> List[Dict[str, Any]]:
        return storage.get_queue(persona_id)

    # ── Processamento assíncrono ────────────────────────────────────────────
    def _start_processing(self, persona_id: Optional[str] = None) -> None:
        with self._lock:
            if self._processing:
                return
            self._processing = True
        thread = threading.Thread(
            target=self._process_loop,
            args=(persona_id,),
            daemon=True,
            name="video-gen-processor",
        )
        thread.start()

    def _process_loop(self, persona_id: Optional[str] = None) -> None:
        try:
            while True:
                item = self._next_queued(persona_id)
                if not item:
                    break
                self._process_item(item, persona_id)
        finally:
            with self._lock:
                self._processing = False

    def _next_queued(self, persona_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
        pid = persona_id or storage.get_active_persona_id()
        queue = storage.get_queue(pid)
        for item in queue:
            if item.get("status") == "queued":
                return item
        return None

    def _update_item(self, item_id: str, patch: Dict[str, Any], persona_id: Optional[str] = None) -> None:
        pid = persona_id or storage.get_active_persona_id()
        queue = storage.get_queue(pid)
        for item in queue:
            if item.get("id") == item_id:
                item.update(patch)
                item["updatedAt"] = _now()
                break
        storage.save_queue(queue, pid)

    def _process_item(self, item: Dict[str, Any], persona_id: Optional[str] = None) -> None:
        pid = persona_id or storage.get_active_persona_id()
        self._update_item(item["id"], {"status": "generating"}, pid)
        frame_path = item.get("framePath")
        if not frame_path or not Path(frame_path).exists():
            frame_path = storage.get_latest_frame(pid)
        if not frame_path:
            self._update_item(item["id"], {"status": "error", "error": "Nenhum frame base disponível"}, pid)
            self._record_history(item, pid, ok=False, error="Nenhum frame base disponível")
            return

        video_id = f"gen-{item['id'][:8]}"
        # Grava em arquivo temporário e depois copia para o destino final.
        output_path = storage.videos_dir(pid) / f".tmp-{video_id}.mp4"
        provider = get_provider()
        result = provider.generate(
            prompt=item.get("prompt", ""),
            base_image_path=Path(frame_path),
            output_path=output_path,
            duration_sec=VIDEO_GEN_DURATION_SEC,
            width=VIDEO_GEN_WIDTH,
            height=VIDEO_GEN_HEIGHT,
        )

        if not result.ok:
            self._update_item(item["id"], {"status": "error", "error": result.error}, pid)
            self._record_history(item, pid, ok=False, error=result.error)
            return

        saved_path = storage.save_generated_video(result.video_path, video_id, pid)
        try:
            if output_path.exists():
                output_path.unlink()
        except OSError:
            pass
        self._register_in_flow(video_id, saved_path, item.get("prompt", ""), pid)
        self._update_item(
            item["id"],
            {
                "status": "done",
                "videoId": video_id,
                "videoPath": str(saved_path),
                "error": None,
            },
            pid,
        )
        self._record_history(item, pid, ok=True, video_id=video_id, video_path=str(saved_path))

    def _register_in_flow(self, video_id: str, video_path: Path, prompt: str, persona_id: str) -> None:
        try:
            from server.services.workflow_service import workflow_service

            workflow_service.register_generated_video(
                video_id=video_id,
                video_path=video_path,
                prompt=prompt,
                persona_id=persona_id,
            )
        except Exception as exc:  # noqa: BLE001
            logger.error("Falha ao registrar vídeo gerado no fluxo: %s", exc)

    def _record_history(
        self,
        item: Dict[str, Any],
        persona_id: str,
        *,
        ok: bool,
        error: Optional[str] = None,
        video_id: Optional[str] = None,
        video_path: Optional[str] = None,
    ) -> None:
        storage.append_history(
            {
                "promptId": item.get("promptId"),
                "prompt": item.get("prompt"),
                "framePath": item.get("framePath"),
                "ok": ok,
                "error": error,
                "videoId": video_id,
                "videoPath": video_path,
            },
            persona_id=persona_id,
        )

    # ── Estado completo ─────────────────────────────────────────────────────
    def get_state(self, persona_id: Optional[str] = None) -> Dict[str, Any]:
        pid = persona_id or storage.get_active_persona_id()
        queue = storage.get_queue(pid)
        return {
            "personaId": pid,
            "provider": get_provider().name,
            "auto": prompt_service.should_auto_generate(pid),
            "bufferSize": prompt_service.buffer_size(pid),
            "buffer": prompt_service.get_buffer(pid),
            "prompts": storage.get_prompts(pid),
            "queue": queue,
            "history": storage.get_history(pid),
            "latestFrame": str(storage.get_latest_frame(pid)) if storage.get_latest_frame(pid) else None,
            "frameHistory": storage.list_frame_history(pid),
            "videos": storage.list_generated_videos(pid),
            "maxQueue": VIDEO_GEN_MAX_QUEUE,
        }


video_gen_service = VideoGenService()
