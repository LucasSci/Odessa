import logging
import os
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from fastapi import APIRouter, HTTPException, Request, UploadFile, File
from pydantic import BaseModel
from fastapi.responses import FileResponse, JSONResponse
from server.core.video_files import list_available_videos, get_video_path, get_video_directory
from server.config import VIDEO_UPLOAD_MAX_BYTES
from server.core.config_manager import load_persona_config, save_persona_config
from server.services.video_edit_store import get_video_edit_store, valid_video_id

logger = logging.getLogger("odessa.routes.video")

UPLOAD_ALLOWED_SUFFIXES = {".mp4", ".webm"}
UPLOAD_CHUNK_BYTES = 1024 * 1024


def looks_like_video(head: bytes) -> bool:
    """Assinatura de MP4/MOV (`ftyp` no byte 4) ou de WebM/Matroska (EBML)."""
    return head[4:8] == b"ftyp" or head[:4] == b"\x1a\x45\xdf\xa3"

router = APIRouter(tags=["video"])


class ForceVideoRequest(BaseModel):
    videoId: str
    state: str = "ACTION"


class BulkVideoRequest(BaseModel):
    videoIds: list[str]


class WorkflowImportRequest(BaseModel):
    workflow: dict | None = None
    dryRun: bool = False


class PreviewActionRequest(BaseModel):
    action: dict


class PreviewConnectionRequest(BaseModel):
    connectionId: str


def _is_video_action(action: dict, video_id: str) -> bool:
    payload = action.get("payload") if isinstance(action.get("payload"), dict) else {}
    return action.get("videoId") == video_id or payload.get("videoId") == video_id


def _clean_video_references(config: dict, video_id: str) -> dict:
    config["videos"] = [v for v in config.get("videos", []) if v.get("id") != video_id]

    action_map = config.get("action_map", {})
    for action in list(action_map):
        action_map[action] = [vid for vid in action_map[action] if vid != video_id]

    transitions = config.get("transitions", {})
    transitions.pop(video_id, None)
    for vid in list(transitions):
        if "safe_next" in transitions[vid]:
            transitions[vid]["safe_next"] = [target for target in transitions[vid]["safe_next"] if target != video_id]

    removed_node_ids = {
        node.get("nodeId")
        for node in config.get("flowNodes", [])
        if node.get("videoId") == video_id
    }
    config["flowNodes"] = [node for node in config.get("flowNodes", []) if node.get("videoId") != video_id]
    config["flowConnections"] = [
        conn for conn in config.get("flowConnections", [])
        if conn.get("fromVideoId") != video_id
        and conn.get("toVideoId") != video_id
        and conn.get("fromNodeId") not in removed_node_ids
        and conn.get("toNodeId") not in removed_node_ids
    ]
    config["flowCanvasVideoIds"] = [vid for vid in config.get("flowCanvasVideoIds", []) if vid != video_id]
    if config.get("idleVideoId") == video_id:
        config["idleVideoId"] = ""

    gift_map = config.get("gift_map", {})
    for gift in list(gift_map):
        gift_map[gift] = [vid for vid in gift_map[gift] if vid != video_id]

    next_triggers = []
    for trigger in config.get("triggers", []):
        actions = [a for a in trigger.get("actions", []) if not _is_video_action(a, video_id)]
        if actions:
            next_triggers.append({**trigger, "actions": actions})
    config["triggers"] = next_triggers
    return config


def _refresh_runtime_config() -> None:
    from server.services.video_service import video_service
    from server.services.automation.engine import trigger_engine
    video_service.refresh_config()
    trigger_engine.refresh_config()

@router.get("/available")
async def get_available_videos():
    """List all available persona videos"""
    videos = list_available_videos()
    return {
        "videos": videos,
        "total": len(videos),
    }


@router.get("/edits")
async def list_video_edits():
    """Todas as edições salvas (cortes, velocidade, áudio, transição), por videoId."""
    return {"edits": get_video_edit_store().all()}


@router.put("/{video_id}/edit")
async def save_video_edit(video_id: str, edit: dict):
    if not valid_video_id(video_id):
        raise HTTPException(status_code=400, detail="videoId inválido")
    return {"edit": get_video_edit_store().put(video_id, edit)}


@router.get("/{video_id}/edit/history")
async def video_edit_history(video_id: str):
    """Versões salvas do clip (mais nova primeiro), para o editor restaurar."""
    if not valid_video_id(video_id):
        raise HTTPException(status_code=400, detail="videoId inválido")
    return {"versions": get_video_edit_store().history(video_id)}


@router.delete("/{video_id}/edit")
async def delete_video_edit(video_id: str):
    if not valid_video_id(video_id):
        raise HTTPException(status_code=400, detail="videoId inválido")
    return {"removed": get_video_edit_store().delete(video_id)}


@router.get("/trash")
async def list_trashed_videos():
    config = load_persona_config()
    archived = [video for video in config.get("archivedVideos", []) if video.get("id")]
    return {"videos": archived, "total": len(archived)}

@router.get("/play/{video_id}")
async def play_video(video_id: str):
    """Stream a specific video file"""
    video_path = get_video_path(video_id)

    if not video_path:
        raise HTTPException(
            status_code=404,
            detail=f"Video '{video_id}' not found"
        )

    media_type = "video/webm" if video_path.suffix.lower() == ".webm" else "video/mp4"
    return FileResponse(
        video_path,
        media_type=media_type,
        headers={"Content-Disposition": f"inline; filename={video_path.name}"},
    )

@router.get("/next")
async def get_next_video(trigger: str = None, giftName: str = None):
    """Determine the next video ID based on current state and optional trigger and giftName"""
    from server.services.video_service import video_service
    video_filename = video_service.get_next_video(trigger, gift_name=giftName)
    # Extract ID from filename (video_04.mp4 -> 04)
    video_id = video_filename.replace("video_", "").replace(".mp4", "")
    return {"id": video_id, "filename": video_filename}

@router.get("/state")
async def get_video_state():
    """Get the current state for synchronization across clients"""
    from server.services.video_service import video_service
    return video_service.get_state()

@router.post("/force")
async def force_video(request: ForceVideoRequest):
    """Immediately set the active video used by Studio and OBS overlay sync."""
    from server.services.video_service import video_service
    try:
        return video_service.force_video(request.videoId, request.state)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/workflow/export")
async def export_workflow():
    from server.services.workflow_service import workflow_service

    workflow = workflow_service.export_workflow()
    return JSONResponse(
        workflow,
        headers={
            "Content-Disposition": "attachment; filename=odessa-workflow.json",
        },
    )


@router.get("/{video_id}/timeline-metadata")
async def video_timeline_metadata(video_id: str):
    video_path = get_video_path(video_id)
    if not video_path:
        raise HTTPException(status_code=404, detail=f"Video '{video_id}' not found")
    stat = video_path.stat()
    return {
        "ok": True,
        "videoId": video_id,
        "filename": video_path.name,
        "size": stat.st_size,
        "updatedAt": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
        "playUrl": f"/api/video/play/{video_id}",
        "thumbnailStrategy": "client-filmstrip",
    }


@router.post("/workflow/validate")
async def validate_workflow(payload: dict):
    from server.services.workflow_service import workflow_service

    try:
        return workflow_service.validate_workflow(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/workflow/import")
async def import_workflow(request: WorkflowImportRequest):
    from server.services.workflow_service import workflow_service

    try:
        result = workflow_service.import_workflow(request.workflow or {}, dry_run=request.dryRun)
        if not request.dryRun:
            _refresh_runtime_config()
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/preview-action")
async def preview_video_action(request: PreviewActionRequest):
    from server.services.video_service import video_service

    return video_service.preview_action(request.action)


@router.post("/workflow/preview-connection")
async def preview_workflow_connection(request: PreviewConnectionRequest):
    config = load_persona_config()
    connection = next(
        (item for item in config.get("flowConnections", []) if item.get("id") == request.connectionId),
        None,
    )
    if not connection:
        raise HTTPException(status_code=404, detail="Connection not found")
    nodes = {item.get("nodeId"): item for item in config.get("flowNodes", [])}
    from_node = nodes.get(connection.get("fromNodeId"))
    to_node = nodes.get(connection.get("toNodeId"))
    settings = connection.get("connectionSettings") or {}
    return {
        "ok": True,
        "dryRun": True,
        "connection": connection,
        "fromClip": from_node,
        "toClip": to_node,
        "previewTailSec": settings.get("previewTailSec", 2),
        "previewHeadSec": settings.get("previewHeadSec", 2),
        "message": "Preview metadata only; no OBS/live/chat/TTS/webhook action executed.",
    }


@router.post("/{video_id}/archive")
async def archive_video(video_id: str):
    """Move a video to Odessa's reversible trash and remove active references."""
    from server.core.video_files import archive_video_file, get_video_path
    from server.services.video_service import video_service

    config = load_persona_config()
    video = next((item for item in config.get("videos", []) if item.get("id") == video_id), None)
    if not video and not get_video_path(video_id):
        raise HTTPException(status_code=404, detail=f"Video '{video_id}' not found")

    if video_service.current_video_id == video_id:
        video_service.return_to_idle()

    archived_path = archive_video_file(video_id)
    archived_entry = {
        **(video or {"id": video_id, "label": video_id, "group": "unknown"}),
        "id": video_id,
        "archivedAt": datetime.now(timezone.utc).isoformat(),
        "archivedPath": str(archived_path) if archived_path else None,
    }
    config = _clean_video_references(config, video_id)
    archived_videos = [item for item in config.get("archivedVideos", []) if item.get("id") != video_id]
    archived_videos.append(archived_entry)
    config["archivedVideos"] = archived_videos

    if save_persona_config(config):
        _refresh_runtime_config()
        return {"status": "archived", "video": archived_entry}
    raise HTTPException(status_code=500, detail="Failed to archive video")


@router.post("/archive/bulk")
async def archive_videos_bulk(request: BulkVideoRequest):
    archived = []
    failed = []
    for video_id in request.videoIds:
        try:
            archived.append(await archive_video(video_id))
        except HTTPException as exc:
            failed.append({"id": video_id, "error": exc.detail})
    return {"status": "done" if not failed else "partial_success", "archived": archived, "failed": failed}


@router.post("/{video_id}/restore")
async def restore_video(video_id: str):
    from server.core.video_files import restore_video_file

    config = load_persona_config()
    archived = config.get("archivedVideos", [])
    entry = next((item for item in archived if item.get("id") == video_id), None)
    if not entry:
        raise HTTPException(status_code=404, detail=f"Archived video '{video_id}' not found")

    restored_path = None
    if entry.get("archivedPath"):
        restored_path = restore_video_file(str(entry["archivedPath"]), video_id)

    restored_entry = {k: v for k, v in entry.items() if k not in {"archivedAt", "archivedPath"}}
    restored_entry.setdefault("loop", False)
    videos = [item for item in config.get("videos", []) if item.get("id") != video_id]
    videos.append(restored_entry)
    config["videos"] = videos
    config["archivedVideos"] = [item for item in archived if item.get("id") != video_id]

    if save_persona_config(config):
        _refresh_runtime_config()
        return {"status": "restored", "video": restored_entry, "path": str(restored_path) if restored_path else None}
    raise HTTPException(status_code=500, detail="Failed to restore video")


@router.delete("/{video_id}/purge")
async def purge_archived_video(video_id: str):
    from server.core.video_files import purge_archived_video_file

    config = load_persona_config()
    archived = config.get("archivedVideos", [])
    entry = next((item for item in archived if item.get("id") == video_id), None)
    if not entry:
        raise HTTPException(status_code=404, detail=f"Archived video '{video_id}' not found")

    if entry.get("archivedPath") and not purge_archived_video_file(str(entry["archivedPath"])):
        raise HTTPException(status_code=409, detail="Archived file could not be purged")
    config["archivedVideos"] = [item for item in archived if item.get("id") != video_id]
    if save_persona_config(config):
        return {"status": "purged", "id": video_id}
    raise HTTPException(status_code=500, detail="Failed to update archive after purge")

@router.post("/idle")
async def return_to_idle():
    """Return the player to the configured Idle loop."""
    from server.services.video_service import video_service
    return video_service.return_to_idle()

@router.post("/advance")
async def advance_video(request: Request):
    """Avança para o próximo clip do fluxo.

    Vários players tocam o mesmo clip ao mesmo tempo (overlay do OBS, fontes
    duplicadas, Palco do painel) e todos avisam quando ele termina. Com
    fromNodeId/fromVideoId (o clip que terminou) o avanço é idempotente: só o
    primeiro aviso avança; os atrasados viram no-op em vez de pular o clip que
    acabou de começar. Sem corpo (botão "Próximo") avança sempre.
    """
    from server.services.video_service import video_service

    body: dict = {}
    try:
        parsed = await request.json()
        if isinstance(parsed, dict):
            body = parsed
    except Exception:
        body = {}
    return video_service.advance(
        from_node_id=body.get("fromNodeId") or None,
        from_video_id=body.get("fromVideoId") or None,
    )

@router.post("/scenario/{scenario_id}")
async def trigger_scenario(scenario_id: str):
    """Trigger a predefined video sequence scenario"""
    from server.services.video_service import video_service
    if video_service.set_scenario(scenario_id):
        return {"status": "success", "scenario": scenario_id}
    else:
        raise HTTPException(status_code=404, detail=f"Scenario '{scenario_id}' not found")

@router.get("/safe-next/{video_id}")
async def get_safe_next(video_id: str):
    """Get a list of safe transitions for a specific video"""
    from server.core.video_logic import get_safe_next_clips
    safe_ids = get_safe_next_clips(video_id)
    return {"current": video_id, "safe_next": safe_ids}

@router.get("/config")
async def get_config():
    """Get current persona video configuration with bidirectional disk sync"""
    config = load_persona_config()

    # Auto-sync with disk
    from server.core.video_files import list_available_videos
    available_videos = list_available_videos()
    available_ids = {av["id"] for av in available_videos}

    config_videos = config.get("videos", [])
    config_ids = [v.get("id") for v in config_videos if v.get("id")]

    added_new = False

    # 1. Add videos present on disk but missing from config
    for av in available_videos:
        if av["id"] not in config_ids:
            config_videos.append({
                "id": av["id"],
                "label": av["id"].replace("_", " ").title(),
                "group": "uploaded",
                "description": f"Auto-detected: {av['filename']}",
                "loop": False,
            })
            added_new = True
        else:
            for video in config_videos:
                if video.get("id") == av["id"] and video.get("missingFile"):
                    video["missingFile"] = False
                    video["description"] = video.get("description") or f"File restored: {av['filename']}"
                    added_new = True

    # 2. Remove videos from config that are no longer on disk
    #
    # Só faz sentido se a pasta de vídeos foi listada de verdade. Com a pasta
    # indisponível (OneDrive offline, disco externo desligado, caminho errado) a
    # listagem vem VAZIA — e o filtro abaixo apagaria a biblioteca inteira da
    # config e a gravaria. Listagem vazia com vídeos cadastrados = "não sei",
    # então não mexe em nada.
    original_len = len(config_videos)
    if available_ids or not config_videos:
        config_videos = [v for v in config_videos if v.get("id") in available_ids or v.get("missingFile")]
    else:
        logger.warning(
            "Pasta de vídeos sem arquivos, mas a config tem %d vídeo(s): preservando a config.",
            original_len,
        )
    if len(config_videos) < original_len:
        added_new = True

    if added_new:
        config["videos"] = config_videos
        from server.core.config_manager import save_persona_config
        save_persona_config(config)

    return config

@router.get("/library")
async def get_video_library():
    """Agrega os vídeos de TODAS as personas, carimbando personaId/personaName
    em cada um. Usado só pelo filtro "todas as personas" da Biblioteca — o
    modo padrão ("persona ativa") continua em GET /config, sem passar por
    aqui, pra não arriscar regressão no comportamento de hoje."""
    from server.core import persona_manager
    from server.api.v1.endpoints.personas import _read_persona_config_raw

    videos: list[dict] = []
    for persona in persona_manager.list_personas():
        persona_id = persona.get("id")
        if not persona_id:
            continue
        raw = _read_persona_config_raw(persona_id)
        for video in raw.get("videos", []) or []:
            videos.append({
                **video,
                "personaId": persona_id,
                "personaName": persona.get("name") or persona_id,
            })
    return {"videos": videos}


@router.post("/config")
async def update_config(config: dict):
    """Update persona video configuration"""
    if save_persona_config(config):
        from server.services.video_service import video_service
        from server.services.automation.engine import trigger_engine
        video_service.refresh_config()
        trigger_engine.refresh_config()
        return {"status": "success"}
    raise HTTPException(status_code=500, detail="Failed to save configuration")

@router.post("/upload")
async def upload_video(file: UploadFile = File(...)):
    """Upload a new video file"""
    logger.info(f"Received upload request for file: {file.filename}")

    video_dir = get_video_directory()
    if not video_dir:
        # Fallback to assets/videos in the project root
        video_dir = Path(__file__).resolve().parents[4] / "assets" / "videos"

    original_name = Path(file.filename or "upload.mp4").name
    suffix = Path(original_name).suffix.lower()
    if suffix not in UPLOAD_ALLOWED_SUFFIXES:
        # Antes qualquer extensão era aceita e gravada como veio (ou renomeada
        # para .mp4 sem conferir): agora só .mp4/.webm.
        raise HTTPException(status_code=400, detail="Formato não suportado: envie um arquivo .mp4 ou .webm.")

    try:
        video_dir.mkdir(parents=True, exist_ok=True)
        # Grava num arquivo temporário na mesma pasta e só troca de nome no fim:
        # um upload interrompido/inválido nunca deixa lixo com nome de vídeo.
        tmp_path = video_dir / f".upload-{uuid.uuid4().hex}.tmp"
        try:
            size = 0
            head = b""
            with open(tmp_path, "wb") as buffer:
                await file.seek(0)
                # Em pedaços: ler tudo de uma vez carregava até 256 MB na memória.
                while True:
                    chunk = await file.read(UPLOAD_CHUNK_BYTES)
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > VIDEO_UPLOAD_MAX_BYTES:
                        raise HTTPException(
                            status_code=413,
                            detail=f"Arquivo excede o limite de {VIDEO_UPLOAD_MAX_BYTES // (1024 * 1024)} MB",
                        )
                    if len(head) < 16:
                        head += chunk[: 16 - len(head)]
                    buffer.write(chunk)
            if size == 0:
                raise HTTPException(status_code=400, detail="Arquivo vazio.")
            if not looks_like_video(head):
                raise HTTPException(status_code=400, detail="O conteúdo não parece um vídeo MP4/WebM válido.")

            # If it doesn't follow the pattern, we'll use the filename as ID (sanitized)
            if original_name.startswith("video_"):
                video_id = Path(original_name).stem.replace("video_", "")
                final_name = original_name
            else:
                # Use filename without extension as ID, but prefix with video_ for consistency on disk
                clean_name = "".join(c for c in Path(original_name).stem if c.isalnum() or c in ('_', '-'))
                video_id = clean_name or f"upload_{int(time.time())}"
                final_name = f"video_{video_id}{suffix}"
            file_path = video_dir / final_name
            os.replace(tmp_path, file_path)
            logger.info(f"Saved upload {file.filename} as {final_name}")
        finally:
            if tmp_path.exists():
                try:
                    tmp_path.unlink()
                except OSError:
                    pass

        # 3. Auto-register in config if not present
        config = load_persona_config()
        video_entries = config.get("videos", [])
        existing_entry = next((v for v in video_entries if v.get("id") == video_id), None)
        if existing_entry:
            existing_entry["missingFile"] = False
            existing_entry["description"] = existing_entry.get("description") or f"Uploaded video: {original_name}"
            save_persona_config(config)
            from server.services.video_service import video_service
            from server.services.automation.engine import trigger_engine
            video_service.refresh_config()
            trigger_engine.refresh_config()
        else:
            new_entry = {
                "id": video_id,
                "label": video_id.replace("_", " ").title(),
                "group": "uploaded",
                "description": f"Uploaded video: {original_name}",
                "loop": False,
            }
            video_entries.append(new_entry)
            config["videos"] = video_entries
            save_persona_config(config)
            from server.services.video_service import video_service
            from server.services.automation.engine import trigger_engine
            video_service.refresh_config()
            trigger_engine.refresh_config()
            logger.info(f"Auto-registered new video {video_id} in config")

        logger.info(f"Upload successful: {file.filename} (Final ID: {video_id})")
        # Sem o caminho absoluto no retorno (o frontend só usa o status).
        return {
            "status": "success",
            "filename": file.filename,
            "id": video_id,
        }
    except HTTPException:
        raise
    except Exception as e:
        # O detalhe (com caminhos do disco) fica só no log do servidor.
        logger.error(f"Upload failed for {file.filename}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Falha ao salvar o vídeo.")

@router.delete("/{video_id}")
async def delete_video(video_id: str):
    """Archive a video file and its configuration references (reversible delete)."""
    return await archive_video(video_id)


async def _legacy_delete_video(video_id: str):
    """Delete a video file and its configuration references"""
    from server.core.video_files import delete_video_file

    # Force idle to release file lock if it is currently playing
    from server.services.video_service import video_service
    if video_service.current_video_id == video_id:
        video_service.return_to_idle()

    # 1. Update config first so the video service drops its reference
    config = load_persona_config()
    config["videos"] = [v for v in config.get("videos", []) if v["id"] != video_id]

    # Clean action_map
    action_map = config.get("action_map", {})
    for action in action_map:
        action_map[action] = [vid for vid in action_map[action] if vid != video_id]

    # Clean transitions
    transitions = config.get("transitions", {})
    if video_id in transitions:
        del transitions[video_id]
    for vid in transitions:
        if "safe_next" in transitions[vid]:
            transitions[vid]["safe_next"] = [target for target in transitions[vid]["safe_next"] if target != video_id]

    # Clean flow nodes and connections
    config["flowNodes"] = [node for node in config.get("flowNodes", []) if node.get("videoId") != video_id]
    config["flowConnections"] = [conn for conn in config.get("flowConnections", []) if conn.get("fromVideoId") != video_id and conn.get("toVideoId") != video_id]
    config["flowCanvasVideoIds"] = [vid for vid in config.get("flowCanvasVideoIds", []) if vid != video_id]
    if config.get("idleVideoId") == video_id:
        config["idleVideoId"] = ""

    # Clean gift_map
    gift_map = config.get("gift_map", {})
    for gift in gift_map:
        gift_map[gift] = [vid for vid in gift_map[gift] if vid != video_id]

    # Clean triggers
    triggers = config.get("triggers", [])
    for trigger in triggers:
        trigger["actions"] = [a for a in trigger.get("actions", []) if a.get("videoId") != video_id]
    config["triggers"] = [t for t in triggers if t.get("actions")]

    if save_persona_config(config):
        from server.services.video_service import video_service
        from server.services.automation.engine import trigger_engine
        video_service.refresh_config()
        trigger_engine.refresh_config()

        # 2. Delete file after a delay so frontend/player drops the handle
        # On Windows, we need more time and sometimes multiple attempts
        import asyncio
        await asyncio.sleep(2.0)

        from server.core.video_files import delete_video_file
        success = delete_video_file(video_id)

        if not success:
            # If it failed, try one last time after a bit more sleep
            await asyncio.sleep(2.0)
            success = delete_video_file(video_id)

        if not success:
            raise HTTPException(
                status_code=409,
                detail=f"O arquivo do vídeo '{video_id}' está bloqueado pelo sistema (Windows). "
                       "Tente fechar prévias ou o OBS Overlay e tente novamente."
            )

        return {"status": "success"}

    raise HTTPException(status_code=500, detail="Failed to update configuration after deletion")

@router.delete("/all/clear")
async def clear_all_videos():
    """Archive all active videos instead of deleting them permanently."""
    available = list_available_videos()
    result = await archive_videos_bulk(BulkVideoRequest(videoIds=[video["id"] for video in available]))
    return {**result, "archived_count": len(result.get("archived", []))}

@router.get("/health")
async def video_health():
    """Check video system health"""
    videos = list_available_videos()
    return {
        "status": "ok" if videos else "no_videos",
        "available_count": len(videos),
        "videos": [v["id"] for v in videos],
    }
