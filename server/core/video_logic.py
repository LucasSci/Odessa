from typing import Dict, List, Set

# Classification of videos by behavioral group
VIDEO_GROUPS = {
    "base_idle": ["04", "05", "14", "16"],
    "look_side": ["07", "08", "09", "15"],
    "hair_motion": ["10", "11", "12", "13"],
    "thank_you": ["01", "02", "03"],
    "read_screen": ["06"]
}

# Hub-and-Spoke Transition Map
# safe_next: recommended transitions that look natural
# avoid_next: transitions that might cause visible jumps (hands appearing suddenly, etc.)
TRANSITION_MAP = {
    "04": { # idle_main
        "safe_next": ["14", "16", "05", "07", "08", "03"],
        "avoid_next": ["10", "11", "12", "06"]
    },
    "05": { # idle_soft
        "safe_next": ["16", "04", "09", "15", "03"],
        "avoid_next": ["02", "11"]
    },
    "14": { # blink_bridge
        "safe_next": ["04", "16", "09", "13"],
        "avoid_next": ["06"]
    },
    "16": { # idle_close
        "safe_next": ["09", "13", "05", "14", "10"],
        "avoid_next": ["02"]
    },
    "07": { # look_side
        "safe_next": ["05", "14", "09", "16", "06"],
        "avoid_next": ["01", "02"]
    },
    "08": { # look_side_alt
        "safe_next": ["16", "04", "09", "05", "06"],
        "avoid_next": ["10"]
    },
    "09": { # closed_smile
        "safe_next": ["13", "05", "16", "06", "03"],
        "avoid_next": ["02"]
    },
    "10": { # hair_touch
        "safe_next": ["05", "09", "13", "14"],
        "avoid_next": ["04", "06"]
    },
    "11": { # hair_side
        "safe_next": ["04", "05", "16"],
        "avoid_next": ["01", "02", "06"]
    },
    "12": { # hair_neck
        "safe_next": ["05", "09", "13", "16"],
        "avoid_next": ["02"]
    },
    "13": { # hair_to_chest
        "safe_next": ["09", "14", "16", "05"],
        "avoid_next": ["06"]
    },
    "01": { # thank_close
        "safe_next": ["16", "04", "05", "13"],
        "avoid_next": ["06", "07"]
    },
    "02": { # big_thank
        "safe_next": ["05", "16", "04"],
        "avoid_next": ["10", "06"]
    },
    "03": { # thank_soft
        "safe_next": ["05", "04", "16", "14"],
        "avoid_next": ["06"]
    },
    "06": { # read_screen
        "safe_next": ["05", "16", "04"],
        "avoid_next": ["01", "02", "10"]
    }
}

# Predefined sequences for common scenarios
SCENARIO_SEQUENCES = {
    "idle_loop": ["04", "14", "16", "09", "05", "04"],
    "compliment": ["04", "03", "14", "05", "04"],
    "strong_compliment": ["16", "01", "16", "05", "04"],
    "read_chat": ["04", "07", "06", "05", "16"],
    "hair_touch": ["16", "10", "05", "04"]
}

def get_safe_next_clips(clip_id: str) -> List[str]:
    """Returns a list of safe next clip IDs for a given clip, merging defaults with config."""
    from server.core.config_manager import load_persona_config
    
    # Normalize ID
    clean_id = clip_id.replace("video_", "").replace(".mp4", "")
    
    # Get defaults
    defaults = TRANSITION_MAP.get(clean_id, {}).get("safe_next", [])
    
    # Get from config
    config = load_persona_config()
    config_transitions = config.get("transitions", {}).get(clean_id, {}).get("safe_next", [])
    
    # Filter by existing videos
    existing_ids = {v["id"] for v in config.get("videos", [])}
    
    if config_transitions:
        res = [vid for vid in config_transitions if vid in existing_ids]
        if res: return res
        
    res = [vid for vid in defaults if vid in existing_ids]
    if res: return res
    
    # Ultimate fallback: all videos except current
    return [vid for vid in existing_ids if vid != clean_id]

def is_transition_safe(current_id: str, next_id: str) -> bool:
    """Checks if a transition between two clips is considered safe."""
    clean_curr = current_id.replace("video_", "").replace(".mp4", "")
    clean_next = next_id.replace("video_", "").replace(".mp4", "")
    
    safe_next = get_safe_next_clips(clean_curr)
    
    # Also check avoid_next from hardcoded map for safety
    avoid_next = TRANSITION_MAP.get(clean_curr, {}).get("avoid_next", [])
    
    if clean_next in avoid_next:
        return False
        
    return clean_next in safe_next
