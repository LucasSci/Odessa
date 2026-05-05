import logging
import shutil
import os
from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from server.core.video_files import list_available_videos, get_video_path, get_video_directory
from server.core.config_manager import load_persona_config, save_persona_config

logger = logging.getLogger("odessa.routes.video")

router = APIRouter(prefix="/api/video", tags=["video"])

@router.get("/available")
async def get_available_videos():
    """List all available persona videos"""
    videos = list_available_videos()
    return {
        "videos": videos,
        "total": len(videos),
    }

@router.get("/play/{video_id}")
async def play_video(video_id: str):
    """Stream a specific video file"""
    video_path = get_video_path(video_id)
    
    if not video_path:
        raise HTTPException(
            status_code=404,
            detail=f"Video '{video_id}' not found"
        )

    return FileResponse(
        video_path,
        media_type="video/mp4",
        headers={"Content-Disposition": f"inline; filename=video_{video_id}.mp4"},
    )

@router.get("/next")
async def get_next_video(trigger: str = None):
    """Determine the next video ID based on current state and optional trigger"""
    from server.services.video_service import video_service
    video_filename = video_service.get_next_video(trigger)
    # Extract ID from filename (video_04.mp4 -> 04)
    video_id = video_filename.replace("video_", "").replace(".mp4", "")
    return {"id": video_id, "filename": video_filename}

@router.get("/state")
async def get_video_state():
    """Get the current state for synchronization across clients"""
    from server.services.video_service import video_service
    return video_service.get_state()

@router.get("/safe-next/{video_id}")
async def get_safe_next(video_id: str):
    """Get a list of safe transitions for a specific video"""
    from server.core.video_logic import get_safe_next_clips
    safe_ids = get_safe_next_clips(video_id)
    return {"current": video_id, "safe_next": safe_ids}

@router.get("/config")
async def get_config():
    """Get current persona video configuration"""
    return load_persona_config()

@router.post("/config")
async def update_config(config: dict):
    """Update persona video configuration"""
    if save_persona_config(config):
        from server.services.video_service import video_service
        video_service.refresh_config()
        return {"status": "success"}
    raise HTTPException(status_code=500, detail="Failed to save configuration")

@router.post("/upload")
async def upload_video(file: UploadFile = File(...)):
    """Upload a new video file"""
    logger.info(f"Received upload request for file: {file.filename}")
    
    video_dir = get_video_directory()
    if not video_dir:
        # Fallback to assets/videos in the project root
        video_dir = Path(__file__).parent.parent.parent / "assets" / "videos"
    
    try:
        video_dir.mkdir(parents=True, exist_ok=True)
        file_path = video_dir / file.filename
        
        logger.info(f"Saving uploaded file to: {file_path}")
        
        # Reset file pointer just in case
        await file.seek(0)
        content = await file.read()
        
        with open(file_path, "wb") as buffer:
            buffer.write(content)
        
        # If it doesn't follow the pattern, we'll use the filename as ID (sanitized)
        video_id = None
        if file.filename.startswith("video_") and file.filename.endswith(".mp4"):
            video_id = file.filename.replace("video_", "").replace(".mp4", "")
        else:
            # Use filename without extension as ID, but prefix with video_ for consistency on disk
            clean_name = "".join(c for c in file.filename.split('.')[0] if c.isalnum() or c in ('_', '-'))
            video_id = clean_name
            # If we renamed it on disk to follow our pattern:
            new_filename = f"video_{video_id}.mp4"
            new_path = video_dir / new_filename
            if file_path != new_path:
                if new_path.exists():
                    os.remove(new_path)
                os.rename(file_path, new_path)
                file_path = new_path
                logger.info(f"Renamed {file.filename} to {new_filename} for system compatibility")

        # 3. Auto-register in config if not present
        config = load_persona_config()
        video_entries = config.get("videos", [])
        if not any(v["id"] == video_id for v in video_entries):
            new_entry = {
                "id": video_id,
                "label": video_id.replace("_", " ").title(),
                "group": "base_idle",
                "description": f"Uploaded video: {file.filename}"
            }
            video_entries.append(new_entry)
            config["videos"] = video_entries
            save_persona_config(config)
            from server.services.video_service import video_service
            video_service.refresh_config()
            logger.info(f"Auto-registered new video {video_id} in config")

        logger.info(f"Upload successful: {file.filename} (Final ID: {video_id})")
        return {
            "status": "success",
            "filename": file.filename,
            "id": video_id,
            "path": str(file_path)
        }
    except Exception as e:
        logger.error(f"Upload failed for {file.filename}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")

@router.delete("/{video_id}")
async def delete_video(video_id: str):
    """Delete a video file and its configuration"""
    video_path = get_video_path(video_id)
    
    # 1. Delete file
    if video_path and video_path.exists():
        try:
            os.remove(video_path)
        except Exception as e:
            logger.error(f"Failed to delete file {video_path}: {e}")
            raise HTTPException(status_code=500, detail="Failed to delete video file")

    # 2. Update config
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

    if save_persona_config(config):
        from server.services.video_service import video_service
        video_service.refresh_config()
        return {"status": "success"}
    
    raise HTTPException(status_code=500, detail="Failed to update configuration after deletion")

@router.get("/health")
async def video_health():
    """Check video system health"""
    videos = list_available_videos()
    return {
        "status": "ok" if videos else "no_videos",
        "available_count": len(videos),
        "videos": [v["id"] for v in videos],
    }
