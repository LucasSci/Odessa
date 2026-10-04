"""
idle_studio.py — Rotas do Estúdio da IDLE (ver server/services/idle_studio.py).
"""
from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from server.config import VIDEO_UPLOAD_MAX_BYTES
from server.services import idle_studio
from server.services.idle_studio import StudioError

router = APIRouter(tags=["idle-studio"])

UPLOAD_CHUNK_BYTES = 1024 * 1024


def _run(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except StudioError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.message) from exc


class ItemUpdate(BaseModel):
    status: Optional[str] = None
    chosen: Optional[str] = None


class FlowRequest(BaseModel):
    publish: bool = False


@router.get("/personas")
def list_studio_personas():
    return {"personas": idle_studio.list_personas()}


@router.get("/{persona_id}")
def get_studio(persona_id: str):
    return _run(idle_studio.studio_view, persona_id)


@router.post("/{persona_id}/items/{key}/assets")
async def upload_item_asset(persona_id: str, key: str, file: UploadFile = File(...)):
    chunks: list[bytes] = []
    size = 0
    while chunk := await file.read(UPLOAD_CHUNK_BYTES):
        size += len(chunk)
        if size > VIDEO_UPLOAD_MAX_BYTES:
            raise HTTPException(status_code=413, detail=f"Arquivo acima de {VIDEO_UPLOAD_MAX_BYTES // (1024 * 1024)} MB.")
        chunks.append(chunk)
    return _run(idle_studio.add_asset, persona_id, key, b"".join(chunks), file.content_type or "", file.filename or "")


@router.delete("/{persona_id}/items/{key}/assets/{asset_id}")
def delete_item_asset(persona_id: str, key: str, asset_id: str):
    return _run(idle_studio.remove_asset, persona_id, key, asset_id)


@router.patch("/{persona_id}/items/{key}")
def patch_item(persona_id: str, key: str, request: ItemUpdate):
    return _run(idle_studio.update_item, persona_id, key, status=request.status, chosen=request.chosen)


@router.get("/{persona_id}/assets/{asset_id}")
def serve_asset(persona_id: str, asset_id: str, download: bool = False, w: Optional[int] = None):
    key, entry, asset = _run(idle_studio.find_asset, persona_id, asset_id)
    path = idle_studio.asset_path(persona_id, asset)
    if w and not download:
        from server.core.thumbnails import is_image, thumbnail

        # Cartões da tela: miniatura (o original continua no download/cópia).
        if is_image(path):
            return FileResponse(thumbnail(path, w), media_type="image/jpeg", headers={"Cache-Control": "max-age=3600"})
    name = idle_studio.auto_name(key, entry, asset)
    disposition = "attachment" if download else "inline"
    return FileResponse(
        idle_studio.asset_path(persona_id, asset),
        media_type=asset.get("type") or "application/octet-stream",
        headers={"Content-Disposition": f"{disposition}; filename*=UTF-8''{quote(name)}"},
    )


@router.post("/{persona_id}/flow")
def build_flow(persona_id: str, request: FlowRequest):
    return _run(idle_studio.build_flow, persona_id, publish=request.publish)


@router.post("/{persona_id}/items/{key}/generate")
def generate_item(persona_id: str, key: str):
    return _run(idle_studio.start_generation, persona_id, key)


@router.get("/jobs/{job_id}")
def get_job(job_id: str):
    return _run(idle_studio.job_status, job_id)
