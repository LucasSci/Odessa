from pathlib import Path
from typing import List, Optional
import logging

logger = logging.getLogger("odessa.video")

# Video storage locations (check in order)
POSSIBLE_VIDEO_DIRS = [
    Path(__file__).parent / "../../assets/videos",  # Project assets (Local/Fast)
    Path.home() / "Videos" / "Odessa",  # Local Videos
    Path.home() / "Downloads" / "Odessa Model",  # User's current location
    Path.home() / "Downloads" / "Videos",  # Downloads
    Path.home() / "OneDrive" / "Videos" / "Captures",  # OneDrive Videos (Potential slow)
]

_cached_video_dir: Optional[Path] = None

def get_video_directory() -> Optional[Path]:
    """Find the first valid video directory and cache it"""
    global _cached_video_dir
    if _cached_video_dir and _cached_video_dir.exists():
        return _cached_video_dir

    for video_dir in POSSIBLE_VIDEO_DIRS:
        try:
            if video_dir.exists() and video_dir.is_dir():
                logger.info(f"Found video directory: {video_dir}")
                _cached_video_dir = video_dir
                return video_dir
        except Exception:
            continue
            
    logger.warning(f"No video directory found in: {[str(d) for d in POSSIBLE_VIDEO_DIRS]}")
    return None

def list_available_videos() -> List[dict]:
    """List all available video files"""
    video_dir = get_video_directory()
    if not video_dir:
        return []

    videos = []
    for video_file in sorted(video_dir.glob("video_*.mp4")):
        # Extract number from filename (e.g., video_01.mp4 -> 01)
        try:
            video_num = video_file.stem.replace("video_", "")
            videos.append({
                "id": video_num,
                "filename": video_file.name,
                "path": str(video_file),
                "size_bytes": video_file.stat().st_size,
            })
        except Exception as e:
            logger.warning(f"Error processing video file {video_file}: {e}")

    return videos

def get_video_path(video_id: str) -> Optional[Path]:
    """Get full path to a specific video by ID"""
    video_dir = get_video_directory()
    if not video_dir:
        return None

    # Sanitize video_id to prevent path traversal
    video_file = (video_dir / f"video_{video_id}.mp4").resolve()

    try:
        # Ensure the resolved path is within the video_dir
        if not video_file.is_relative_to(video_dir.resolve()):
            return None
    except AttributeError:
        # Fallback for Python versions before 3.9
        if video_dir.resolve() not in video_file.parents:
            return None

    if video_file.exists():
        return video_file

    return None
