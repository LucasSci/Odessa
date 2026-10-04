"""Miniaturas de imagens (JPEG reduzido, em cache no disco).

O Estúdio IDLE baixava 97 imagens em tamanho original ao abrir (5,5 MB) e a tela
de Personas 4,5 MB, só para mostrar cartões de poucos centímetros. Aqui a
imagem é reduzida uma vez para a largura pedida e guardada em `.thumbs/` ao lado
do original; se o original mudar, a miniatura é refeita.
"""
from __future__ import annotations

import threading
from pathlib import Path

ALLOWED_WIDTHS = (160, 240, 320, 480, 640)
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}

_lock = threading.Lock()


def nearest_width(width: int) -> int:
    """Só algumas larguras: não deixa um ?w= qualquer encher o disco de arquivos."""
    return min(ALLOWED_WIDTHS, key=lambda allowed: (allowed < width, abs(allowed - width)))


def is_image(path: Path) -> bool:
    return path.suffix.lower() in IMAGE_SUFFIXES


def thumbnail(path: Path, width: int) -> Path:
    """Caminho de um JPEG com no máximo `width` px de largura (gera se preciso)."""
    from PIL import Image, ImageOps

    width = nearest_width(width)
    target = path.parent / ".thumbs" / f"{path.stem}-{width}.jpg"
    source_mtime = path.stat().st_mtime
    if target.exists() and target.stat().st_mtime >= source_mtime:
        return target
    with _lock:
        if target.exists() and target.stat().st_mtime >= source_mtime:
            return target
        target.parent.mkdir(parents=True, exist_ok=True)
        with Image.open(path) as image:
            image = ImageOps.exif_transpose(image)
            if image.mode in ("RGBA", "LA", "P"):
                image = image.convert("RGBA")
                background = Image.new("RGB", image.size, (16, 17, 20))
                background.paste(image, mask=image.getchannel("A"))
                image = background
            else:
                image = image.convert("RGB")
            if image.width > width:
                image = image.resize((width, max(1, round(image.height * width / image.width))), Image.LANCZOS)
            tmp = target.with_suffix(".tmp")
            image.save(tmp, "JPEG", quality=82, optimize=True, progressive=True)
            tmp.replace(target)
    return target
