import json
import re

def extract_json_object(text: str) -> dict:
    """Extracts a JSON object from a string, handling markdown blocks if present."""
    try:
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0]
        elif "```" in text:
            text = text.split("```")[1].split("```")[0]
        return json.loads(text.strip())
    except Exception:
        # Fallback to finding anything between first { and last }
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end != -1:
            try:
                return json.loads(text[start : end + 1])
            except Exception:
                pass
        raise

def slugify(text: str) -> str:
    """Standard slugify for filenames or IDs."""
    s = str(text).strip().lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s
