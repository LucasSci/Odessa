"""
persona_content.py — Agregação de todo o conteúdo (fotos + vídeos, enviados
ou autogerados) de uma persona num único formato, pro Content Studio
(Organizar/Gerar/Visualizar — ver PersonaContentStudio.tsx).

Junta três fontes que hoje vivem em sistemas de armazenamento separados:
  1. persona_assets (faces/environments/wardrobe) — uploads manuais E fotos
     autogeradas (distinguidas pela tag "generated" adicionada em
     persona_assets.save_asset(), ver persona_photogen.py).
  2. video_gen/storage — vídeos gerados automaticamente pelo pipeline de
     video-gen, com histórico de prompts/erros pra contexto.

É a mesma fonte de dados usada tanto pela aba "Organizar" (grade completa)
quanto "Visualizar" (contadores + recentes) do Content Studio — evita
duplicar a lógica de agregação no frontend.
"""
import logging
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException

from server.core import persona_assets, persona_manager
from server.services.video_gen import storage as video_gen_storage

logger = logging.getLogger("odessa.routes.persona_content")

router = APIRouter(tags=["personas"])

ASSET_CATEGORIES = ("faces", "environments", "wardrobe")


def _find_persona(index: Dict[str, Any], persona_id: str):
    return next((p for p in index.get("personas", []) if p.get("id") == persona_id), None)


def _image_items(persona_id: str) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    for category in ASSET_CATEGORIES:
        for asset in persona_assets.list_assets(persona_id, category):
            items.append(
                {
                    "id": asset["id"],
                    "kind": "image",
                    "category": category,
                    "url": f"/api/v1/personas/{persona_id}/assets/{category}/{asset['id']}",
                    "label": asset.get("label") or asset.get("originalName") or asset["id"],
                    "createdAt": asset.get("createdAt"),
                    "generated": bool(asset.get("generated")),
                    "provider": asset.get("source"),
                    "prompt": asset.get("prompt"),
                }
            )
    return items


def _video_items(persona_id: str) -> List[Dict[str, Any]]:
    videos = video_gen_storage.list_generated_videos(persona_id)
    history_by_video_id = {
        h.get("videoId"): h for h in video_gen_storage.get_history(persona_id) if h.get("videoId")
    }
    items: List[Dict[str, Any]] = []
    for video in videos:
        history_entry = history_by_video_id.get(video["id"], {})
        items.append(
            {
                "id": video["id"],
                "kind": "video",
                "category": "generated",
                "url": video.get("playUrl"),
                "label": video["id"],
                "createdAt": history_entry.get("createdAt"),
                "generated": True,
                "provider": history_entry.get("provider") or "video-gen",
                "prompt": history_entry.get("prompt"),
                "sizeBytes": video.get("sizeBytes"),
            }
        )
    return items


@router.get("/{persona_id}/content")
def get_persona_content(persona_id: str):
    """Lista todo o conteúdo (fotos + vídeos) de uma persona, num formato
    único — fonte de dados do Content Studio."""
    index = persona_manager._ensure_default_persona(persona_manager._load_index())
    if _find_persona(index, persona_id) is None:
        raise HTTPException(status_code=404, detail=f"Persona '{persona_id}' não encontrada")

    items = _image_items(persona_id) + _video_items(persona_id)
    items.sort(key=lambda item: item.get("createdAt") or "", reverse=True)

    counts: Dict[str, int] = {}
    for item in items:
        key = f"{item['kind']}:{item['category']}"
        counts[key] = counts.get(key, 0) + 1

    return {
        "items": items,
        "total": len(items),
        "generatedCount": sum(1 for item in items if item.get("generated")),
        "countsByCategory": counts,
    }
