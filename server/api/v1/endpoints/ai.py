import json
import logging
from fastapi import APIRouter, HTTPException
from server.models import AIRespondRequest, AIDecideRequest
from server.services.ai_service import ai_service
from server.utils.text_utils import extract_json_object

router = APIRouter(tags=["AI"])
logger = logging.getLogger("odessa.routes.ai")

@router.post("/respond")
def ai_respond(request: AIRespondRequest):
    try:
        text, provider = ai_service.generate_ai_text_with_fallback(
            gemini_model=request.model,
            system_prompt=request.persona_prompt,
            user_prompt=request.user_prompt,
            temperature=request.temperature,
        )
        return {"response": text, "provider": provider}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("[AI RESPOND EXCEPTION] %s", exc, exc_info=True)
        raise HTTPException(status_code=502, detail=str(exc)) from exc

@router.post("/decide")
def ai_decide(request: AIDecideRequest):
    if not request.events:
        raise HTTPException(status_code=400, detail="events is required")

    events_payload = [
        {
            "id": event.id,
            "source": event.source,
            "zoneName": event.zoneName,
            "kind": event.kind,
            "text": event.text,
            "createdAt": event.createdAt,
            "metadata": event.metadata or {},
        }
        for event in request.events[-5:]
    ]
    tools_payload = request.tools or []
    rules_payload = request.rules or []
    context_payload = request.context or {}

    decision_contract = {
        "context_analysis": "analise breve (PASSO 1: PENSAR)",
        "sentiment": "positivo | negativo | neutro | hype | caotico",
        "intent": "respond_chat | thank_gift | redeem_gift | moderate | switch_scene | media_request | topic_shift | handle_alert | log_only",
        "reason": "por que esta decisao foi escolhida",
        "priority": "low | normal | high | urgent",
        "actions": [
            {
                "id": "action-1",
                "type": "speak | chat_reply | etc",
                "capability": "tts.speak | etc",
                "label": "nome humano",
                "payload": {},
                "requiresApproval": False,
                "simulated": True,
                "status": "queued",
            }
        ],
        "speech": "O que a streamer vai falar (PASSO FINAL: FALAR)",
    }
    
    user_prompt = (
        "Eventos recentes:\n"
        f"{json.dumps(events_payload, ensure_ascii=False)}\n\n"
        "Ferramentas:\n"
        f"{json.dumps(tools_payload, ensure_ascii=False)}\n\n"
        "Regras:\n"
        f"{json.dumps(rules_payload, ensure_ascii=False)}\n\n"
        "Contexto:\n"
        f"{json.dumps(context_payload, ensure_ascii=False)}\n\n"
        "Retorne APENAS um objeto JSON valido seguindo exatamente este contrato:\n"
        f"{json.dumps(decision_contract, ensure_ascii=False)}\n\n"
    )

    try:
        text, provider = ai_service.generate_ai_text_with_fallback(
            gemini_model=request.model,
            system_prompt=request.persona_prompt,
            user_prompt=user_prompt,
            temperature=request.temperature,
            json_mode=True,
        )
        try:
            parsed = extract_json_object(text or "{}")
            parsed["provider"] = provider
            return parsed
        except Exception:
            # Simple fallback if JSON parsing fails twice
            logger.error("[AI DECIDE JSON EXCEPTION] %s", text)
            raise HTTPException(status_code=502, detail="AI returned invalid JSON decision")
            
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("[AI DECIDE EXCEPTION] %s", exc, exc_info=True)
        raise HTTPException(status_code=502, detail=str(exc)) from exc
