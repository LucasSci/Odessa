import json
import logging
from pathlib import Path
from typing import Dict, Any

logger = logging.getLogger("odessa.config")

CONFIG_PATH = Path(__file__).parent.parent / "data" / "persona_config.json"

def load_persona_config() -> Dict[str, Any]:
    """Loads the persona video configuration from JSON."""
    logger.info(f"Loading persona config from {CONFIG_PATH}")
    if not CONFIG_PATH.exists():
        logger.warning(f"Config file not found at {CONFIG_PATH}, returning empty config.")
        return {"videos": [], "action_map": {}, "transitions": {}}
    
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
            
            # Ensure required sections exist
            if "videos" not in data: data["videos"] = []
            if "action_map" not in data: data["action_map"] = {"gift": [], "message": [], "idle": ["04", "05", "14", "16"]}
            if "transitions" not in data: data["transitions"] = {}
            if "triggers" not in data: 
                data["triggers"] = {
                    "gift_keywords": ["presente", "enviar", "gift", "mimo", "donate"],
                    "message_keywords": ["oi", "olá", "odessa", "você", "linda", "top"]
                }
                
            logger.info(f"Successfully loaded persona config with {len(data.get('videos', []))} videos.")
            return data
    except Exception as e:
        logger.error(f"Error loading persona config: {e}")
        return {
            "videos": [], 
            "action_map": {"gift": [], "message": [], "idle": []}, 
            "transitions": {},
            "triggers": {
                "gift_keywords": ["gift", "presente"],
                "message_keywords": ["oi"]
            }
        }

def save_persona_config(config: Dict[str, Any]) -> bool:
    """Saves the persona video configuration to JSON."""
    try:
        CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=2, ensure_ascii=False)
        return True
    except Exception as e:
        logger.error(f"Error saving persona config: {e}")
        return False
