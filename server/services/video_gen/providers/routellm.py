"""
routellm.py — Provedor de geração de vídeo via RouteLLM (Abacus.AI).

Tenta chamar a API de geração de vídeo da Abacus.AI (OpenAI-compatível)
usando o frame base como imagem de partida e o prompt como instrução.

NOTA: o contrato exato do endpoint de vídeo pode variar. Este provedor é
"best-effort": envia o frame base (data URL) + prompt para o endpoint de
geração de vídeo do RouteLLM e baixa o resultado. Se a API não estiver
configurada ou falhar, retorna um VideoGenResult com erro — o pipeline
continua testável com o provedor "placeholder".
"""
from __future__ import annotations

import base64
import logging
import mimetypes
import time
import urllib.request
from pathlib import Path
from typing import Any, Dict, Optional

from server.config import OPENAI_BASE_URL, VIDEO_GEN_API_KEY, VIDEO_GEN_MODEL
from server.services.video_gen.base import VideoGenProvider, VideoGenResult

logger = logging.getLogger("odessa.video_gen.routellm")


class RouteLLMVideoProvider(VideoGenProvider):
    name = "routellm"

    def __init__(self, config: Optional[Dict[str, Any]] = None) -> None:
        super().__init__(config)
        self.api_key = (config or {}).get("api_key") or VIDEO_GEN_API_KEY
        self.base_url = ((config or {}).get("base_url") or OPENAI_BASE_URL).rstrip("/")
        self.model = (config or {}).get("model") or VIDEO_GEN_MODEL

    def _data_url(self, path: Path) -> str:
        mime = mimetypes.guess_type(str(path))[0] or "image/png"
        with open(path, "rb") as f:
            b64 = base64.b64encode(f.read()).decode("ascii")
        return f"data:{mime};base64,{b64}"

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
        if not self.api_key:
            return VideoGenResult(
                ok=False,
                provider=self.name,
                error="VIDEO_GEN_API_KEY não configurado",
            )
        if not base_image_path.exists():
            return VideoGenResult(
                ok=False,
                provider=self.name,
                error=f"Frame base não encontrado: {base_image_path}",
            )

        output_path.parent.mkdir(parents=True, exist_ok=True)
        endpoint = f"{self.base_url}/v1/videos/generations"
        payload = {
            "model": self.model,
            "prompt": prompt,
            "image": self._data_url(base_image_path),
            "duration": float(duration_sec or 4.0),
            "size": f"{width}x{height}",
        }
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        try:
            req = urllib.request.Request(
                endpoint,
                data=__import__("json").dumps(payload).encode("utf-8"),
                headers=headers,
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=180) as resp:
                body = __import__("json").loads(resp.read().decode("utf-8"))

            video_url = (
                body.get("data", [{}])[0].get("url")
                or body.get("video_url")
                or body.get("url")
            )
            if not video_url:
                return VideoGenResult(
                    ok=False,
                    provider=self.name,
                    error=f"Resposta sem URL de vídeo: {str(body)[:500]}",
                )
            urllib.request.urlretrieve(video_url, str(output_path))
            if not output_path.exists() or output_path.stat().st_size == 0:
                return VideoGenResult(
                    ok=False,
                    provider=self.name,
                    error="Download do vídeo resultou em arquivo vazio",
                )
            return VideoGenResult(
                ok=True,
                video_path=output_path,
                video_id=output_path.stem,
                provider=self.name,
                model=self.model,
                meta={"prompt": prompt, "sourceUrl": video_url},
            )
        except Exception as exc:  # noqa: BLE001
            logger.error("RouteLLMVideoProvider falhou: %s", exc)
            return VideoGenResult(ok=False, provider=self.name, error=str(exc))
