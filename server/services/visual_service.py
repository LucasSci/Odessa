import logging
import re
import json
from typing import Dict, Any, Optional

from server.services.ai_service import ai_service
from server.config import GEMINI_IMAGE_MODEL

logger = logging.getLogger("odessa.visual")

class VisualService:
    def slugify_filename(self, value: str, fallback: str = "asset") -> str:
        s = str(value).strip().lower()
        s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
        return s or fallback

    def normalize_visual_asset_request(self, data: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "prompt": str(data.get("prompt") or "Juju streamer style, neon lights, tech vibes").strip(),
            "style": str(data.get("style") or "digital art").strip(),
            "aspectRatio": str(data.get("aspectRatio") or "16:9").strip(),
            "priority": str(data.get("priority") or "normal").strip().lower(),
            "fileName": self.slugify_filename(str(data.get("fileName") or ""), "juju-asset"),
        }

    def fallback_visual_plan(self, prompt: str, error_msg: str) -> Dict[str, Any]:
        return {
            "success": False,
            "error": error_msg,
            "placeholderUrl": f"https://placehold.co/1280x720/1a1a2e/white?text={prompt[:20]}...",
            "fileName": "fallback-asset.png",
        }

    async def generate_visual_image_asset(self, raw_data: Dict[str, Any]) -> Dict[str, Any]:
        request = self.normalize_visual_asset_request(raw_data)
        
        system_prompt = (
            "Voce eh um assistente criativo para a streamer Juju (Odessa). "
            "Sua tarefa eh descrever uma imagem para geracao via IA. "
            "Retorne APENAS um JSON com os campos: 'success' (bool), 'refinedPrompt' (str), 'fileName' (str)."
        )
        user_prompt = f"Crie um asset visual para: {request['prompt']} no estilo {request['style']}."

        try:
            text, provider = ai_service.generate_ai_text_with_fallback(
                gemini_model=GEMINI_IMAGE_MODEL,
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                temperature=0.7,
                json_mode=True
            )
            
            plan = json.loads(text)
            plan["provider"] = provider
            plan["style"] = request["style"]
            
            # Note: In a real scenario, this service would now call DALL-E or Midjourney
            # For the MVP, we return the plan that n8n will use to generate the actual image.
            return plan
        except Exception as exc:
            logger.error("[VISUAL SERVICE EXCEPTION] %s", exc, exc_info=True)
            return self.fallback_visual_plan(request["prompt"], str(exc))

# Singleton instance
visual_service = VisualService()
