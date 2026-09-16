"""
trigger_synthesis.py — Infere uma condição de gatilho (presente ou palavra-
chave) a partir do buffer de interações que originou um vídeo gerado, pra que
o vídeo deixe de ficar "órfão" (sem triggerId) e volte a tocar quando o chat
repetir o mesmo tipo de interação.

Só usa sinais estruturados já calculados por prompt_service.generate_prompt()
(videoType + interactions) — nunca pede pra IA "inventar" uma condição a
partir do texto do prompt de vídeo, que descreve direção de cena, não uma
especificação de gatilho.
"""
from __future__ import annotations

import re
from collections import Counter
from typing import Any

from server.services.automation.parser import event_parser

# Palavras curtas/funcionais demais pra virar palavra-chave de gatilho —
# mesmo espírito do filtro de chatLearning.ts (meaningfulWords), cobrindo os
# idiomas mais comuns no chat (pt/en/es), já que o app responde em qualquer
# um deles.
_STOPWORDS = {
    # português
    "para", "com", "uma", "isso", "muito", "esse", "essa", "esta", "este",
    "voce", "você", "vc", "que", "não", "nao", "sim", "mas", "por", "sua",
    "seu", "meu", "minha", "aqui", "hoje", "agora", "bem", "tudo", "todo",
    "toda", "gente", "vai", "vou", "foi", "ser", "tem", "tão", "tao",
    "mais", "menos", "oi", "ola", "olá", "obrigada", "obrigado", "linda",
    "lindo", "gata", "amo",
    # inglês
    "the", "and", "you", "your", "that", "this", "with", "for", "are",
    "hello", "hi", "hey", "thanks", "thank", "love", "beautiful",
    # espanhol
    "como", "muy", "con", "esto", "eso", "hola", "gracias", "buena",
    "buenas", "hermosa", "preciosa",
}

_WORD_RE = re.compile(r"[a-zà-ÿ]+", re.IGNORECASE)


def _meaningful_words(text: str) -> list[str]:
    words = _WORD_RE.findall((text or "").lower())
    return [w for w in words if len(w) >= 4 and w not in _STOPWORDS]


def synthesize_trigger_condition(
    video_type: str | None,
    interactions: list[dict[str, Any]] | None,
) -> dict[str, Any] | None:
    """Retorna {"eventType", "conditions", "label"} ou None quando não há
    sinal confiável suficiente no buffer para criar um gatilho sensato.
    """
    interactions = interactions or []

    gift_interactions = [it for it in interactions if it.get("kind") == "gift"]
    if video_type == "GATILHO" and gift_interactions:
        names = Counter(
            (it.get("giftName") or it.get("text") or "").strip()
            for it in gift_interactions
            if (it.get("giftName") or it.get("text"))
        )
        if names:
            gift_name, _count = names.most_common(1)[0]
            return {
                "eventType": "gift",
                "conditions": {"giftKey": event_parser.gift_key_for(gift_name)},
                "label": gift_name,
            }

    # Sem presente no buffer (ou vídeo FLUXO): tenta uma palavra-chave a
    # partir do texto das mensagens de chat/comentário.
    word_counter: Counter[str] = Counter()
    for it in interactions:
        if it.get("kind") not in {"chat", "comment"}:
            continue
        word_counter.update(_meaningful_words(it.get("text") or ""))

    if not word_counter:
        return None

    keyword, _count = word_counter.most_common(1)[0]
    return {
        "eventType": "comment",
        "conditions": {"keyword": keyword},
        "label": keyword,
    }
