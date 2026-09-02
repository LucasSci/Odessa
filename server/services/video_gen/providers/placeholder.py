"""
placeholder.py — Provedor de geração de vídeo "placeholder".

Simula o pipeline completo sem chamar API real. Usa ffmpeg (se disponível)
para gerar um vídeo curto e reproduzível a partir do frame base, aplicando um
zoom suave (zoompan) para dar movimento. Se ffmpeg não estiver disponível,
grava um arquivo de marcador para que o fluxo de registro continue testável.
"""
from __future__ import annotations

import logging
import shutil
import subprocess
from pathlib import Path
from typing import Any, Dict, Optional

from server.services.video_gen.base import VideoGenProvider, VideoGenResult

logger = logging.getLogger("odessa.video_gen.placeholder")


class PlaceholderProvider(VideoGenProvider):
    name = "placeholder"

    def generate(
        self,
        *,
        prompt: str,
        base_image_path: Path,
        output_path: Path,
        duration_sec: float = 4.0,
        width: int = 720,
        height: int = 1280,
    ) -> VideoGenResult:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        ffmpeg = shutil.which("ffmpeg")
        if not ffmpeg:
            # Sem ffmpeg: grava um marcador para manter o pipeline testável.
            output_path.write_bytes(b"placeholder-video")
            return VideoGenResult(
                ok=True,
                video_path=output_path,
                video_id=output_path.stem,
                provider=self.name,
                model="placeholder",
                meta={"mode": "marker", "prompt": prompt},
            )

        duration = max(0.5, float(duration_sec or 4.0))
        try:
            cmd = [
                ffmpeg,
                "-y",
                "-loop", "1",
                "-i", str(base_image_path),
                "-vf",
                f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
                f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:black,"
                f"zoompan=z='min(zoom+0.0008,1.15)':d={int(duration * 25)}:s={width}x{height}:fps=25",
                "-t", f"{duration:.2f}",
                "-c:v", "libx264",
                "-pix_fmt", "yuv420p",
                "-movflags", "+faststart",
                str(output_path),
            ]
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=120,
            )
            if result.returncode != 0 or not output_path.exists() or output_path.stat().st_size == 0:
                logger.error("ffmpeg falhou: %s", result.stderr[-2000:])
                return VideoGenResult(
                    ok=False,
                    provider=self.name,
                    error=f"ffmpeg error: {result.stderr[-500:]}",
                )
            return VideoGenResult(
                ok=True,
                video_path=output_path,
                video_id=output_path.stem,
                provider=self.name,
                model="placeholder",
                meta={
                    "mode": "ffmpeg_zoompan",
                    "durationSec": duration,
                    "width": width,
                    "height": height,
                    "prompt": prompt,
                },
            )
        except Exception as exc:  # noqa: BLE001
            logger.error("PlaceholderProvider falhou: %s", exc)
            return VideoGenResult(ok=False, provider=self.name, error=str(exc))
