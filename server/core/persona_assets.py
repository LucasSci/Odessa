"""
persona_assets.py — Gerenciamento de imagens de referência por persona.

Cada persona tem três categorias de imagens:
  - faces:        rosto da persona (para identificação e referência de vídeo)
  - environments: ambiente da live (onde os vídeos são gravados)
  - wardrobe:     kit de roupas (imagens de roupas disponíveis)

As imagens são armazenadas em disco em:
  server/runtime/persona-assets/{persona_id}/{category}/{image_id}.{ext}

Os metadados (id, label, filename) são persistidos no índice de personas
(personas.json) dentro de persona.assets[category].
"""
import json
import logging
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from server.core.persona_manager import (
    DATA_DIR,
    PERSONAS_INDEX_PATH,
    _load_index,
    _save_index,
    _ensure_default_persona,
    _slugify,
    get_persona,
)

logger = logging.getLogger("odessa.persona_assets")

ASSETS_DIR = Path(__file__).resolve().parents[1] / "runtime" / "persona-assets"

VALID_CATEGORIES = {"faces", "environments", "wardrobe"}
VALID_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
MAX_IMAGE_BYTES = 10 * 1024 * 1024  # 10 MB


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _category_dir(persona_id: str, category: str) -> Path:
    d = ASSETS_DIR / _slugify(persona_id) / category
    d.mkdir(parents=True, exist_ok=True)
    return d


def _validate_category(category: str) -> str:
    if category not in VALID_CATEGORIES:
        raise ValueError(f"Categoria inválida: '{category}'. Use: {', '.join(sorted(VALID_CATEGORIES))}")
    return category


def _get_persona_assets(index: Dict[str, Any], persona_id: str) -> Dict[str, List[Dict[str, Any]]]:
    persona = next((p for p in index.get("personas", []) if p.get("id") == persona_id), None)
    if persona is None:
        raise ValueError(f"Persona '{persona_id}' não encontrada")
    assets = persona.setdefault("assets", {})
    for cat in VALID_CATEGORIES:
        assets.setdefault(cat, [])
    return assets


def list_assets(persona_id: str, category: str) -> List[Dict[str, Any]]:
    """Lista as imagens de uma categoria de uma persona."""
    category = _validate_category(category)
    index = _ensure_default_persona(_load_index())
    assets = _get_persona_assets(index, persona_id)
    return list(assets.get(category, []))


def save_asset(
    persona_id: str,
    category: str,
    data: bytes,
    filename: str,
    label: str = "",
) -> Dict[str, Any]:
    """Salva uma imagem e registra os metadados no índice."""
    category = _validate_category(category)
    if len(data) > MAX_IMAGE_BYTES:
        raise ValueError(f"Imagem excede o limite de {MAX_IMAGE_BYTES // (1024 * 1024)} MB")

    ext = Path(filename).suffix.lower()
    if ext not in VALID_EXTENSIONS:
        raise ValueError(f"Extensão inválida: '{ext}'. Use: {', '.join(sorted(VALID_EXTENSIONS))}")

    image_id = uuid.uuid4().hex[:12]
    safe_filename = f"{image_id}{ext}"
    dest = _category_dir(persona_id, category) / safe_filename
    dest.write_bytes(data)

    record = {
        "id": image_id,
        "label": label.strip() or Path(filename).stem,
        "filename": safe_filename,
        "originalName": filename,
        "category": category,
        "createdAt": _now(),
    }

    index = _ensure_default_persona(_load_index())
    assets = _get_persona_assets(index, persona_id)
    assets[category].append(record)
    if not _save_index(index):
        raise RuntimeError("Falha ao salvar metadados da imagem")
    return record


def delete_asset(persona_id: str, category: str, image_id: str) -> bool:
    """Remove uma imagem do disco e do índice."""
    category = _validate_category(category)
    index = _ensure_default_persona(_load_index())
    assets = _get_persona_assets(index, persona_id)
    records = assets.get(category, [])
    record = next((r for r in records if r.get("id") == image_id), None)
    if record is None:
        return False

    # Remove do disco
    if record.get("filename"):
        path = _category_dir(persona_id, category) / record["filename"]
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass

    # Remove do índice
    assets[category] = [r for r in records if r.get("id") != image_id]
    _save_index(index)
    return True


def get_asset_path(persona_id: str, category: str, image_id: str) -> Optional[Path]:
    """Retorna o caminho do arquivo de uma imagem."""
    category = _validate_category(category)
    index = _ensure_default_persona(_load_index())
    assets = _get_persona_assets(index, persona_id)
    record = next((r for r in assets.get(category, []) if r.get("id") == image_id), None)
    if record is None or not record.get("filename"):
        return None
    path = _category_dir(persona_id, category) / record["filename"]
    return path if path.exists() else None


def update_asset_label(persona_id: str, category: str, image_id: str, label: str) -> Optional[Dict[str, Any]]:
    """Atualiza o label de uma imagem."""
    category = _validate_category(category)
    index = _ensure_default_persona(_load_index())
    assets = _get_persona_assets(index, persona_id)
    record = next((r for r in assets.get(category, []) if r.get("id") == image_id), None)
    if record is None:
        return None
    record["label"] = label.strip()
    _save_index(index)
    return record


def get_primary_asset(persona_id: str, category: str) -> Optional[Dict[str, Any]]:
    """Retorna a primeira imagem de uma categoria (referência principal)."""
    items = list_assets(persona_id, category)
    return items[0] if items else None


def get_all_asset_paths(persona_id: str, category: str) -> List[Path]:
    """Retorna os caminhos de arquivo de todas as imagens de uma categoria."""
    items = list_assets(persona_id, category)
    paths: List[Path] = []
    for item in items:
        path = get_asset_path(persona_id, category, item["id"])
        if path:
            paths.append(path)
    return paths


def get_asset_url(persona_id: str, category: str, image_id: str) -> str:
    """Constrói a URL pública para servir uma imagem."""
    return f"/api/v1/personas/{persona_id}/assets/{category}/{image_id}"


def get_all_asset_urls(persona_id: str) -> Dict[str, List[Dict[str, Any]]]:
    """Retorna todas as imagens de uma persona com suas URLs públicas."""
    result: Dict[str, List[Dict[str, Any]]] = {}
    for cat in VALID_CATEGORIES:
        items = list_assets(persona_id, cat)
        for item in items:
            item["url"] = get_asset_url(persona_id, cat, item["id"])
        result[cat] = items
    return result
