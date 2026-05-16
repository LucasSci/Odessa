import sys
import os

path = r'c:\Users\Lucas\Desktop\Odessa\server\api\v1\endpoints\video.py'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Replace get_config
old_get_config = '''@router.get("/config")
async def get_config():
    """Get current persona video configuration"""
    return load_persona_config()'''

new_get_config = '''@router.get("/config")
async def get_config():
    """Get current persona video configuration"""
    config = load_persona_config()

    # Auto-sync with disk to ensure present videos are visible and can be deleted
    from server.core.video_files import list_available_videos
    available_videos = list_available_videos()

    config_videos = config.get("videos", [])
    config_ids = [v.get("id") for v in config_videos if v.get("id")]

    added_new = False
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

    if added_new:
        config["videos"] = config_videos
        from server.core.config_manager import save_persona_config
        save_persona_config(config)

    return config'''

content = content.replace(old_get_config, new_get_config)
content = content.replace(old_get_config.replace('\n', '\r\n'), new_get_config.replace('\n', '\r\n'))

# Replace delete_video start
old_delete_start = '''@router.delete("/{video_id}")
async def delete_video(video_id: str):
    """Delete a video file and its configuration"""
    video_path = get_video_path(video_id)

    # 1. Delete file
    if video_path and video_path.exists():
        try:
            os.remove(video_path)
        except Exception as e:
            logger.warning(f"Failed to delete file {video_path} (locked): {e}. Continuing to clean config.")

    # 2. Update config
    config = load_persona_config()'''

new_delete_start = '''@router.delete("/{video_id}")
async def delete_video(video_id: str):
    """Delete a video file and its configuration"""
    video_path = get_video_path(video_id)

    # 1. Update config first so the video service drops its reference
    config = load_persona_config()'''

content = content.replace(old_delete_start, new_delete_start)
content = content.replace(old_delete_start.replace('\n', '\r\n'), new_delete_start.replace('\n', '\r\n'))

# Replace delete_video end
old_delete_end = '''    if save_persona_config(config):
        from server.services.video_service import video_service
        from server.services.automation.engine import trigger_engine
        video_service.refresh_config()
        trigger_engine.refresh_config()
        return {"status": "success"}

    raise HTTPException(status_code=500, detail="Failed to update configuration after deletion")'''

new_delete_end = '''    if save_persona_config(config):
        from server.services.video_service import video_service
        from server.services.automation.engine import trigger_engine
        video_service.refresh_config()
        trigger_engine.refresh_config()

        # 2. Delete file after a brief delay so frontend drops the handle
        import asyncio
        await asyncio.sleep(0.5)

        if video_path and video_path.exists():
            try:
                os.remove(video_path)
            except Exception as e:
                logger.warning(f"Failed to delete file {video_path} (locked): {e}. It may remain on disk until manual deletion.")

        return {"status": "success"}

    raise HTTPException(status_code=500, detail="Failed to update configuration after deletion")'''

content = content.replace(old_delete_end, new_delete_end)
content = content.replace(old_delete_end.replace('\n', '\r\n'), new_delete_end.replace('\n', '\r\n'))

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print('Patched successfully')
