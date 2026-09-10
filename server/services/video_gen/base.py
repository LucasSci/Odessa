"""
base.py — Contratos do pipeline de geração de vídeo.

Define a interface VideoGenProvider (abstração plugável) e o dataclass
VideoGenResult que carrega o resultado de uma geração.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger("odessa.video_gen")


@dataclass
class VideoGenResult:
    """Resultado de uma geração de vídeo."""

    ok: bool
    video_path: Optional[Path] = None
    video_id: Optional[str] = None
    provider: str = "placeholder"
    model: str = ""
    error: Optional[str] = None
    meta: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "ok": self.ok,
            "videoPath": str(self.video_path) if self.video_path else None,
            "videoId": self.video_id,
            "provider": self.provider,
            "model": self.model,
            "error": self.error,
            "meta": self.meta,
        }


class VideoGenProvider:
    """
    Interface de um provedor de geração de vídeo.

    Um provedor recebe um prompt de texto e um frame base (imagem) e produz um
    arquivo de vídeo. Implementações concretas ficam em providers/.
    """

    name = "base"

    def __init__(self, config: Optional[Dict[str, Any]] = None) -> None:
        self.config = config or {}

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
        """Gera um vídeo a partir de um prompt, uma imagem base e imagens de referência.

        Args:
            prompt: Instrução textual (template renderizado com assets da persona).
            base_image_path: Imagem base (rosto da persona ou último frame capturado).
            output_path: Onde salvar o vídeo resultante.
            reference_images: Imagens de referência adicionais (ambiente, roupas).
        """
        raise NotImplementedError
