"""
memory_learning.py — Memória que cresce, live após live, igual para qualquer IA.

Três coisas ficam guardadas no banco (server/core/database.py):
  - viewer_facts: o que cada pessoa do chat contou (nome, cidade, trabalho,
    time, gostos…). Vale para todas as personas.
  - persona_facts: o que a própria persona já disse de si ("meu vinho favorito
    é Malbec") — para ela nunca se contradizer entre lives.
  - conversation_summaries: resumo curto do que conversaram com cada pessoa.

Aprende em duas camadas:
  1. Na hora, sem IA: frases óbvias ("meu nome é…", "sou de…", "torço pro…").
  2. Em segundo plano, com a IA que estiver ativa (local ou API): a transcrição
     nova de cada pessoa vira fatos + resumo (JSON). Disparado pela interface
     com o chat parado ou no fim da live (POST /memory/learn) — a chave da API
     vem na chamada e nunca é guardada.

O contexto que entra no prompt (build_prompt_context) é o mesmo para todas as IAs.
"""
from __future__ import annotations

import json
import logging
import re
import threading
import unicodedata
import uuid
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple

from server.core.database import db

logger = logging.getLogger("odessa.memory_learning")

MAX_FACTS_PER_VIEWER = 30
MAX_PERSONA_FACTS = 60
MAX_SUMMARIES_PER_VIEWER = 5
MIN_NEW_MESSAGES_TO_LEARN = 8
FACTS_IN_PROMPT = 6
PERSONA_FACTS_IN_PROMPT = 10

# Categorias de valor único: um fato novo substitui o anterior da mesma categoria.
SINGLE_VALUE = {"nome", "cidade", "idade", "trabalho", "time"}
CATEGORIES = SINGLE_VALUE | {"gosto", "vida", "outro"}

_learn_lock = threading.Lock()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _norm(text: str) -> str:
    folded = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", folded).strip()


# ── 1. Fatos óbvios, na hora ───────────────────────────────────────────────

_WORD = r"[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'-]+"
_PLACE = rf"{_WORD}(?:\s+(?:de|do|da|dos|das)?\s*{_WORD}){{0,3}}"
_QUICK_PATTERNS: List[Tuple[str, re.Pattern[str], Callable[[re.Match[str]], str]]] = [
    ("nome", re.compile(rf"\b(?:meu nome (?:é|e)|pode me chamar de|me chamo)\s+({_WORD})", re.I), lambda m: f"se chama {m.group(1).title()}"),
    ("cidade", re.compile(rf"\b(?:sou de|moro em|moro no|moro na|aqui de|falo de)\s+({_PLACE})", re.I), lambda m: f"é de {m.group(1).strip()}"),
    ("idade", re.compile(r"\btenho\s+(\d{2})\s+anos\b", re.I), lambda m: f"tem {m.group(1)} anos"),
    ("trabalho", re.compile(rf"\b(?:trabalho (?:com|como|de|na|no|em)|sou (?:um |uma )?(?:professora?|engenheir[oa]|m[eé]dic[oa]|enfermeir[oa]|motorista|programador[a]?|advogad[oa]|estudante|vendedor[a]?|policial|pedreiro|mec[aâ]nico|designer|caminhoneiro))\s*({_WORD}(?:\s+{_WORD}){{0,2}})?", re.I), lambda m: _third_person(m.group(0).strip(" ,."))),
    ("time", re.compile(rf"\b(?:torço (?:pro|pra|para o|para a|pelo|pela)|sou (?:torcedor|torcedora) d[oa])\s+({_WORD}(?:\s+{_WORD})?)", re.I), lambda m: f"torce pro {m.group(1).strip()}"),
    ("gosto", re.compile(rf"\b(?:eu )?(?:adoro|amo|curto muito|sou apaixonad[oa] por)\s+({_WORD}(?:\s+{_WORD}){{0,3}})", re.I), lambda m: f"gosta de {m.group(1).strip()}"),
]

_NOT_A_NAME = {"voce", "você", "linda", "lindo", "aqui", "bem", "nada", "amor", "seu", "sua"}


def extract_quick_facts(text: str) -> List[Tuple[str, str]]:
    """Fatos ditos com todas as letras na mensagem (sem IA). [(categoria, fato)]."""
    found: List[Tuple[str, str]] = []
    for category, pattern, fmt in _QUICK_PATTERNS:
        match = pattern.search(text or "")
        if not match:
            continue
        if category == "nome" and match.group(1).lower() in _NOT_A_NAME:
            continue
        if category == "gosto" and re.search(r"\b(voc[eê]|te|vc)\b", match.group(0), re.I):
            continue  # "amo você" não é um gosto da pessoa
        found.append((category, fmt(match)))
    return found


# ── Armazenamento ──────────────────────────────────────────────────────────

_FIRST_TO_THIRD = [
    (re.compile(r"^(?:eu\s+)?sou de\b", re.I), "é de"),
    (re.compile(r"^(?:eu\s+)?sou\b", re.I), "é"),
    (re.compile(r"^(?:eu\s+)?moro (em|no|na)\b", re.I), r"mora \1"),
    (re.compile(r"^(?:eu\s+)?trabalho (com|como|de|na|no|em)\b", re.I), r"trabalha \1"),
    (re.compile(r"^(?:eu\s+)?tenho\b", re.I), "tem"),
    (re.compile(r"^(?:eu\s+)?torço\b", re.I), "torce"),
    (re.compile(r"^(?:eu\s+)?gosto\b", re.I), "gosta"),
    (re.compile(r"^(?:eu\s+)?(?:me chamo|meu nome é)\b", re.I), "se chama"),
]
_CATEGORY_HINTS = [
    ("nome", re.compile(r"^(se chama|chama-se|nome)\b", re.I)),
    ("cidade", re.compile(r"^(é de|mora (em|no|na))\b", re.I)),
    ("idade", re.compile(r"^tem \d{1,2} anos\b", re.I)),
    ("trabalho", re.compile(r"^(trabalha|é (programador|professor|engenheir|médic|enfermeir|motorista|advogad|estudante|vendedor|designer))", re.I)),
    ("time", re.compile(r"^torce\b", re.I)),
    ("gosto", re.compile(r"^(gosta|ama|adora)\b", re.I)),
]
_CORE_STOP = {"e", "de", "do", "da", "em", "no", "na", "com", "como", "se", "chama", "tem", "mora", "trabalha", "torce", "pro", "pelo", "pela", "gosta", "um", "uma", "o", "a", "sou", "eu"}


def _third_person(fact: str) -> str:
    for pattern, repl in _FIRST_TO_THIRD:
        fact = pattern.sub(repl, fact, count=1)
    return fact


def _core(fact: str) -> str:
    return " ".join(w for w in _norm(fact).split() if w not in _CORE_STOP)


def add_viewer_fact(user_id: str, category: str, fact: str, source: str = "ai") -> bool:
    """Guarda um fato da pessoa. Repetido = só renova; categoria de valor único substitui.

    O que a pessoa disse com todas as letras (source "chat") vale mais que o
    palpite da IA: um fato da IA nunca apaga um fato "chat" da mesma categoria.
    A categoria é conferida pelo próprio texto (modelo pequeno erra o rótulo).
    """
    fact = _third_person((fact or "").strip()[:160])
    category = category if category in CATEGORIES else "outro"
    for hinted, pattern in _CATEGORY_HINTS:
        if pattern.search(fact):
            category = hinted
            break
    if not user_id or len(fact) < 3:
        return False
    core = _core(fact)
    now = _now()
    with db.get_connection() as conn:
        rows = conn.execute(
            "SELECT id, category, fact, source FROM viewer_facts WHERE user_id = ? AND hidden = 0", (user_id,)
        ).fetchall()
        for row in rows:
            other = _core(row["fact"])
            if other == core or (len(core) > 5 and (core in other or other in core)):
                conn.execute("UPDATE viewer_facts SET last_used_at = ? WHERE id = ?", (now, row["id"]))
                conn.commit()
                return False
        if category in SINGLE_VALUE:
            same = [r for r in rows if r["category"] == category]
            if source != "chat" and any(r["source"] == "chat" for r in same):
                return False  # a pessoa já disse isso com todas as letras
            conn.execute("DELETE FROM viewer_facts WHERE user_id = ? AND category = ? AND hidden = 0", (user_id, category))
        conn.execute(
            "INSERT INTO viewer_facts (id, user_id, category, fact, source, created_at, last_used_at, hidden) VALUES (?, ?, ?, ?, ?, ?, ?, 0)",
            (f"vf-{uuid.uuid4().hex[:16]}", user_id, category, fact, source, now, now),
        )
        extra = conn.execute(
            "SELECT id FROM viewer_facts WHERE user_id = ? ORDER BY last_used_at DESC LIMIT -1 OFFSET ?",
            (user_id, MAX_FACTS_PER_VIEWER),
        ).fetchall()
        for row in extra:
            conn.execute("DELETE FROM viewer_facts WHERE id = ?", (row["id"],))
        conn.commit()
    return True


def add_persona_fact(persona_id: str, fact: str) -> bool:
    fact = (fact or "").strip()[:160]
    if not persona_id or len(fact) < 3:
        return False
    norm = _norm(fact)
    with db.get_connection() as conn:
        for row in conn.execute("SELECT fact FROM persona_facts WHERE persona_id = ?", (persona_id,)).fetchall():
            other = _norm(row["fact"])
            if other == norm or (len(norm) > 8 and (norm in other or other in norm)):
                return False
        conn.execute(
            "INSERT INTO persona_facts (id, persona_id, fact, created_at, hidden) VALUES (?, ?, ?, ?, 0)",
            (f"pf-{uuid.uuid4().hex[:16]}", persona_id, fact, _now()),
        )
        extra = conn.execute(
            "SELECT id FROM persona_facts WHERE persona_id = ? ORDER BY created_at DESC LIMIT -1 OFFSET ?",
            (persona_id, MAX_PERSONA_FACTS),
        ).fetchall()
        for row in extra:
            conn.execute("DELETE FROM persona_facts WHERE id = ?", (row["id"],))
        conn.commit()
    return True


def add_summary(user_id: str, persona_id: str, summary: str) -> None:
    summary = (summary or "").strip()[:300]
    if not user_id or len(summary) < 5:
        return
    with db.get_connection() as conn:
        conn.execute(
            "INSERT INTO conversation_summaries (id, user_id, persona_id, summary, created_at) VALUES (?, ?, ?, ?, ?)",
            (f"cs-{uuid.uuid4().hex[:16]}", user_id, persona_id or "", summary, _now()),
        )
        extra = conn.execute(
            "SELECT id FROM conversation_summaries WHERE user_id = ? AND persona_id = ? ORDER BY created_at DESC LIMIT -1 OFFSET ?",
            (user_id, persona_id or "", MAX_SUMMARIES_PER_VIEWER),
        ).fetchall()
        for row in extra:
            conn.execute("DELETE FROM conversation_summaries WHERE id = ?", (row["id"],))
        conn.commit()


def remember_quick_facts(user_id: str, text: str) -> int:
    return sum(1 for category, fact in extract_quick_facts(text) if add_viewer_fact(user_id, category, fact, "chat"))


# ── Contexto para o prompt (o mesmo para toda IA) ──────────────────────────

def _ago(iso: str) -> str:
    try:
        then = datetime.fromisoformat(iso)
    except (TypeError, ValueError):
        return ""
    days = (datetime.now(timezone.utc) - then).days
    if days <= 0:
        return "hoje mais cedo"
    if days == 1:
        return "ontem"
    if days < 7:
        return f"há {days} dias"
    if days < 60:
        return f"há {days // 7} semana(s)"
    return f"há {days // 30} meses"


def build_prompt_context(username: str, persona_id: str = "", persona_name: str = "") -> Dict[str, Any]:
    """Bloco curto sobre quem está falando + o que a persona já disse de si."""
    from server.services.memory_service import memory_service

    username = (username or "").strip().lstrip("@")
    user_id = memory_service.normalize_user_id(username) if username else ""
    lines: List[str] = []
    used: List[str] = []
    who = persona_name or "você"
    with db.get_connection() as conn:
        user = conn.execute(
            "SELECT id, username, first_seen, last_seen, total_messages, total_gifts, COALESCE(hidden, 0) AS hidden FROM users WHERE id = ?",
            (user_id,),
        ).fetchone() if user_id else None
        if user and user["hidden"]:
            user = None
        if username:
            if not user or int(user["total_messages"] or 0) <= 1:
                lines.append(f"[SOBRE QUEM ESTÁ FALANDO] {username} é novo(a) aqui: não finja que já conhece.")
                used.append(f"@{username}: primeira vez")
            else:
                facts = conn.execute(
                    "SELECT id, fact FROM viewer_facts WHERE user_id = ? AND hidden = 0 ORDER BY last_used_at DESC LIMIT ?",
                    (user["id"], FACTS_IN_PROMPT),
                ).fetchall()
                summary = conn.execute(
                    "SELECT summary, created_at FROM conversation_summaries WHERE user_id = ? AND persona_id = ? ORDER BY created_at DESC LIMIT 1",
                    (user["id"], persona_id or ""),
                ).fetchone()
                head = f"[SOBRE QUEM ESTÁ FALANDO] {username} já conversa com {who} (desde {_ago(user['first_seen'])}"
                head += f", mandou {user['total_gifts']} presente(s))." if int(user["total_gifts"] or 0) else ")."
                lines.append(head)
                used.append(f"@{username}: recorrente")
                if facts:
                    lines.append("O que você já sabe dessa pessoa: " + "; ".join(r["fact"] for r in facts) + ".")
                    used.append(f"{len(facts)} fato(s) de @{username}")
                    now = _now()
                    for r in facts:
                        conn.execute("UPDATE viewer_facts SET last_used_at = ? WHERE id = ?", (now, r["id"]))
                    conn.commit()
                if summary:
                    lines.append(f"Última conversa ({_ago(summary['created_at'])}): {summary['summary']}")
                    used.append("resumo da última conversa")
                lines.append("Use isso com naturalidade, só quando fizer sentido. Nunca recite a lista.")
        persona_facts = conn.execute(
            "SELECT fact FROM persona_facts WHERE persona_id = ? AND hidden = 0 ORDER BY created_at DESC LIMIT ?",
            (persona_id or "", PERSONA_FACTS_IN_PROMPT),
        ).fetchall() if persona_id else []
    if persona_facts:
        lines.append("[O QUE VOCÊ JÁ CONTOU DE SI NO CHAT] Mantenha coerência com isto: " + "; ".join(r["fact"] for r in persona_facts) + ".")
        used.append(f"{len(persona_facts)} fato(s) que a persona já contou")
    return {"found": bool(user), "context": "\n".join(lines), "used": used}


# ── 2. Aprendizado com a IA ativa ──────────────────────────────────────────

LEARN_SYSTEM = """Você organiza a memória de uma streamer sobre as pessoas do chat dela.
Leia a conversa e devolva SÓ um JSON, sem explicação, neste formato:
{"fatos_pessoa": [{"categoria": "nome|cidade|idade|trabalho|time|gosto|vida|outro", "fato": "..."}],
 "fatos_streamer": ["..."],
 "resumo": "..."}
Regras:
- fatos_pessoa: só o que a PESSOA disse sobre ela mesma, com certeza (ex.: "trabalha com TI", "é de Campinas", "tem um cachorro chamado Thor"). Nada de suposição, elogio ou pedido.
- fatos_streamer: só o que a STREAMER afirmou sobre a própria vida (ex.: "disse que o vinho favorito é Malbec"). Nada sobre a pessoa.
- resumo: 1 frase curta do que conversaram, em português.
- Listas vazias quando não houver nada. Frases curtas, em português, na terceira pessoa."""


def _transcript(conn, user_id: str, since: str, persona_name: str) -> Tuple[str, int, str]:
    rows = conn.execute(
        "SELECT username, kind, text, created_at FROM interaction_logs WHERE user_id = ? AND created_at > ? AND kind IN ('chat', 'reply', 'gift') ORDER BY created_at ASC LIMIT 60",
        (user_id, since or ""),
    ).fetchall()
    lines = []
    viewer_count = 0
    for r in rows:
        if r["kind"] == "reply":
            lines.append(f"{persona_name or 'Streamer'}: {r['text']}")
        else:
            viewer_count += 1
            text = r["text"]
            # A bridge grava "nome: mensagem"; tira o nome repetido.
            prefix = f"{r['username']}: "
            if text.lower().startswith(prefix.lower()):
                text = text[len(prefix):]
            lines.append(f"{r['username']}: {text}")
    last = rows[-1]["created_at"] if rows else since
    return "\n".join(lines), viewer_count, last


def pending_users(min_new: int = MIN_NEW_MESSAGES_TO_LEARN, limit: int = 5) -> List[str]:
    with db.get_connection() as conn:
        rows = conn.execute(
            """
            SELECT u.id, COUNT(l.id) AS new_count
            FROM users u JOIN interaction_logs l ON l.user_id = u.id
            WHERE COALESCE(u.hidden, 0) = 0 AND l.kind = 'chat' AND l.created_at > COALESCE(u.learned_until, '')
            GROUP BY u.id HAVING new_count >= ?
            ORDER BY MAX(l.created_at) DESC LIMIT ?
            """,
            (max(1, min_new), limit),
        ).fetchall()
    return [r["id"] for r in rows]


def _parse_json(text: str) -> Dict[str, Any]:
    text = (text or "").strip()
    match = re.search(r"\{.*\}", text, re.S)
    if not match:
        raise ValueError("a IA não devolveu JSON")
    data = json.loads(match.group(0))
    if not isinstance(data, dict):
        raise ValueError("JSON inválido")
    return data


def learn_user(user_id: str, persona_id: str, persona_name: str, generate: Callable[[str, str], str]) -> Dict[str, Any]:
    """Aprende com a conversa nova de uma pessoa. `generate(system, user) -> texto`."""
    with db.get_connection() as conn:
        user = conn.execute("SELECT id, username, COALESCE(learned_until, '') AS learned_until FROM users WHERE id = ?", (user_id,)).fetchone()
        if not user:
            return {"userId": user_id, "skipped": "not_found"}
        transcript, viewer_count, last = _transcript(conn, user_id, user["learned_until"], persona_name)
    if viewer_count == 0:
        return {"userId": user_id, "skipped": "nothing_new"}

    data = _parse_json(generate(LEARN_SYSTEM, f"Pessoa: {user['username']}\nStreamer: {persona_name or 'Streamer'}\n\nConversa:\n{transcript}"))
    added = 0
    for item in (data.get("fatos_pessoa") or [])[:8]:
        if isinstance(item, dict):
            added += add_viewer_fact(user_id, str(item.get("categoria") or "outro"), str(item.get("fato") or ""), "ai")
        elif isinstance(item, str):
            added += add_viewer_fact(user_id, "outro", item, "ai")
    persona_added = 0
    for fact in (data.get("fatos_streamer") or [])[:5]:
        if isinstance(fact, str):
            persona_added += add_persona_fact(persona_id, fact)
    if isinstance(data.get("resumo"), str):
        add_summary(user_id, persona_id, data["resumo"])
    with db.get_connection() as conn:
        conn.execute("UPDATE users SET learned_until = ? WHERE id = ?", (last, user_id))
        conn.commit()
    return {"userId": user_id, "facts": added, "personaFacts": persona_added, "summary": bool(data.get("resumo"))}


def learn_pending(persona_id: str, persona_name: str, generate: Callable[[str, str], str], *, max_users: int = 3, min_new: int = MIN_NEW_MESSAGES_TO_LEARN) -> Dict[str, Any]:
    """Aprende com quem tem conversa nova. Uma rodada por vez (a IA local não aguenta duas)."""
    if not _learn_lock.acquire(blocking=False):
        return {"status": "busy", "learned": []}
    try:
        learned = []
        for user_id in pending_users(min_new, max_users):
            try:
                learned.append(learn_user(user_id, persona_id, persona_name, generate))
            except Exception as exc:  # noqa: BLE001 — uma pessoa com erro não para as outras
                logger.warning("[memória] aprendizado de %s falhou: %s", user_id, exc)
                learned.append({"userId": user_id, "error": str(exc)[:200]})
        return {"status": "done", "learned": learned}
    finally:
        _learn_lock.release()


# ── Tela de Memória ────────────────────────────────────────────────────────

def list_viewer_facts(user_id: str) -> List[Dict[str, Any]]:
    with db.get_connection() as conn:
        rows = conn.execute(
            "SELECT id, category, fact, source, created_at, hidden FROM viewer_facts WHERE user_id = ? ORDER BY created_at DESC",
            (user_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def list_summaries(user_id: str) -> List[Dict[str, Any]]:
    with db.get_connection() as conn:
        rows = conn.execute(
            "SELECT id, persona_id, summary, created_at FROM conversation_summaries WHERE user_id = ? ORDER BY created_at DESC",
            (user_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def list_persona_facts(persona_id: str) -> List[Dict[str, Any]]:
    with db.get_connection() as conn:
        rows = conn.execute(
            "SELECT id, fact, created_at FROM persona_facts WHERE persona_id = ? AND hidden = 0 ORDER BY created_at DESC",
            (persona_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def delete_viewer_fact(fact_id: str) -> bool:
    with db.get_connection() as conn:
        cur = conn.execute("DELETE FROM viewer_facts WHERE id = ?", (fact_id,))
        conn.commit()
    return cur.rowcount > 0


def delete_persona_fact(fact_id: str) -> bool:
    with db.get_connection() as conn:
        cur = conn.execute("DELETE FROM persona_facts WHERE id = ?", (fact_id,))
        conn.commit()
    return cur.rowcount > 0


def forget_user(conn, user_id: str) -> None:
    conn.execute("DELETE FROM viewer_facts WHERE user_id = ?", (user_id,))
    conn.execute("DELETE FROM conversation_summaries WHERE user_id = ?", (user_id,))


def forget_everything(conn) -> None:
    for table in ("viewer_facts", "persona_facts", "conversation_summaries"):
        conn.execute(f"DELETE FROM {table}")  # noqa: S608 — nomes fixos
