"""
higgsfield.py — Provedor de geração de vídeo via Higgsfield (image2video/dop,
animação com controle de câmera), a partir do frame base já resolvido pelo
pipeline (rosto principal da persona ou último frame capturado).

Reaproveita o cliente compartilhado em higgsfield_service.py (mesmo usado
pela geração de fotos em persona_photogen.py) — só a etapa final (endpoint
usado) muda entre foto e vídeo.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

from server.services.higgsfield_service import HiggsfieldError, generate_video_from_image
from server.services.video_gen.base import VideoGenProvider, VideoGenResult

logger = logging.getLogger("odessa.video_gen.higgsfield")


class HiggsfieldVideoProvider(VideoGenProvider):
    name = "higgsfield"

    def generate(
        self,
        *,
        prompt: str,
        base_image_path: Path,
        output_path: Path,
        duration_sec: float = 4.0,
        width: int = 720,
        height: int = 1280,
        reference_images: Optional[List[Path]] = None,
    ) -> VideoGenResult:
        if not base_image_path.exists():
            return VideoGenResult(
                ok=False,
                provider=self.name,
                error=f"Frame base não encontrado: {base_image_path}",
            )

        try:
            video_bytes = generate_video_from_image(
                base_image_path, prompt, duration_sec=duration_sec
            )
        except HiggsfieldError as exc:
            logger.warning("HiggsfieldVideoProvider falhou: %s", exc)
            return VideoGenResult(ok=False, provider=self.name, error=str(exc))
        except Exception as exc:  # noqa: BLE001
            logger.error("HiggsfieldVideoProvider erro inesperado: %s", exc)
            return VideoGenResult(ok=False, provider=self.name, error=str(exc))

        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(video_bytes)
        if not output_path.exists() or output_path.stat().st_size == 0:
            return VideoGenResult(
                ok=False, provider=self.name, error="Download do vídeo resultou em arquivo vazio"
            )

        return VideoGenResult(
            ok=True,
            video_path=output_path,
            video_id=output_path.stem,
            provider=self.name,
            meta={"prompt": prompt},
        )
