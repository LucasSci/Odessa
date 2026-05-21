from pathlib import Path
from typing import List, Optional
import logging
import os
import shutil

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


def get_video_trash_directory() -> Path:
    return Path(__file__).resolve().parents[2] / "lixo temporario" / "videos"

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
    """List all available video files in the designated directory."""
    video_dir = get_video_directory()
    if not video_dir:
        return []

    videos = []
    # We now look for all mp4 and webm files to ensure "present" videos can be managed
    extensions = [".mp4", ".webm"]
    video_files = []
    for ext in extensions:
        video_files.extend(list(video_dir.glob(f"*{ext}")))

    video_files = sorted(video_files, key=lambda f: f.name)

    for video_file in video_files:
        try:
            # Extract ID: if it starts with video_, strip it. Otherwise use stem.
            if video_file.name.startswith("video_"):
                video_id = video_file.stem.replace("video_", "")
            else:
                video_id = video_file.stem

            videos.append({
                "id": video_id,
                "filename": video_file.name,
                "path": str(video_file),
                "size_bytes": video_file.stat().st_size,
            })
        except Exception as e:
            logger.warning(f"Error processing video file {video_file}: {e}")

    return videos

def get_video_path(video_id: str) -> Optional[Path]:
    """Get full path to a specific video by ID, checking both prefixed and non-prefixed versions"""
    video_dir = get_video_directory()
    if not video_dir:
        return None

    # Check common patterns
    search_patterns = [
        f"video_{video_id}.mp4",
        f"video_{video_id}.webm",
        f"{video_id}.mp4",
        f"{video_id}.webm",
    ]

    for pattern in search_patterns:
        video_file = video_dir / pattern
        if video_file.exists():
            return video_file

    return None

def delete_video_file(video_id: str) -> bool:
    """Attempt to delete a video file from disk safely."""
    path = get_video_path(video_id)
    if not path or not path.exists():
        return True

    try:
        # On Windows, files might be locked by the browser or the streaming response.
        if path.exists():
            path.unlink()
            logger.info(f"Successfully deleted video file: {path}")
        return True
    except Exception as e:
        logger.error(f"Failed to delete video file {path}: {e}")
        return False


def archive_video_file(video_id: str) -> Optional[Path]:
    """Move a video to the reversible project trash area."""
    path = get_video_path(video_id)
    if not path or not path.exists():
        return None
    trash_dir = get_video_trash_directory()
    trash_dir.mkdir(parents=True, exist_ok=True)
    target = trash_dir / path.name
    if target.exists():
        target = trash_dir / f"{path.stem}-{int(path.stat().st_mtime)}{path.suffix}"
    shutil.move(str(path), str(target))
    logger.info("Archived video file %s -> %s", path, target)
    return target


def restore_video_file(archived_path: str, video_id: str) -> Optional[Path]:
    """Restore a video from the reversible trash area."""
    source = Path(archived_path)
    trash_root = get_video_trash_directory().resolve()
    try:
        resolved = source.resolve()
    except Exception:
        return None
    if trash_root not in resolved.parents and resolved != trash_root:
        logger.error("Refusing to restore video outside trash: %s", source)
        return None
    if not resolved.exists():
        return None
    video_dir = get_video_directory() or (Path(__file__).resolve().parents[2] / "assets" / "videos")
    video_dir.mkdir(parents=True, exist_ok=True)
    target = video_dir / resolved.name
    if target.exists():
        target = video_dir / f"video_{video_id}{resolved.suffix}"
    shutil.move(str(resolved), str(target))
    logger.info("Restored video file %s -> %s", resolved, target)
    return target


def purge_archived_video_file(archived_path: str) -> bool:
    """Permanently remove a video already inside the reversible trash area."""
    source = Path(archived_path)
    trash_root = get_video_trash_directory().resolve()
    try:
        resolved = source.resolve()
    except Exception:
        return False
    if trash_root not in resolved.parents:
        logger.error("Refusing to purge video outside trash: %s", source)
        return False
    if not resolved.exists():
        return True
    try:
        resolved.unlink()
        return True
    except Exception as exc:
        logger.error("Failed to purge archived video %s: %s", resolved, exc)
        return False
