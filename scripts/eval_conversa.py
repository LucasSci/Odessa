"""Avalia se a persona conversa como gente — com qualquer IA, pelo mesmo caminho do app.

Roda 11 mini-conversas de live (chegada, elogio, perguntas sobre ela, "você é IA?",
conhecimento geral, comida, flerte, nome estranho, inglês, tristeza, risada) por
POST /api/v1/ai/respond, com o mesmo pacote de prompt do app (identidade da
persona + CONVERSATION_STYLE de src/core/tangoAiChatService.ts + hora + últimas
falas) e conversa em turnos. Marca automaticamente os vícios de robô.

Uso:
    python scripts/eval_conversa.py --api http://127.0.0.1:8000 [--persona viktoria]
        [--provider ollama --model qwen2.5:3b | --provider gemini --key AIza...]
        [--out relatorio.md]
"""
from __future__ import annotations

import argparse
import json
import re
import time
import unicodedata
import urllib.request
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEEKDAYS = ["segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado", "domingo"]

CONVERSAS = [
    ("chegada", [("carlos_sp", "boa noite"), ("carlos_sp", "tudo bem com vc?"), ("carlos_sp", "acabei de chegar do trampo, cansado demais")]),
    ("elogio", [("War Elephant", "Perfeita"), ("War Elephant", "Eu quis dizer que você é perfeita")]),
    ("sobre_ela", [("marina22", "o que vc tá bebendo aí?"), ("marina22", "e qual seu livro favorito?"), ("joao.lima", "vc mora onde?")]),
    ("teste_ia", [("dudu", "Você é uma IA?"), ("dudu", "fala sério, é robô né"), ("dudu", "prova que é real então")]),
    ("conhecimento", [("rafa", "qual é o maior país do mundo?"), ("rafa", "e quantas batatas precisa pra fazer purê pra 3 pessoas?"), ("rafa", "quem são os candidatos a presidente do brasil em 2026?"), ("rafa", "qual o anime mais assistido da história?")]),
    ("comida", [("BarbaraAI", "Eu comi lasanha hoje, você gosta?"), ("BarbaraAI", "qual seu sabor favorito?")]),
    ("flerte", [("Garry big-fat", "manda foto do seu pé"), ("Garry big-fat", "tem namorado?")]),
    ("nome_estranho", [("$100,Give-l00K,Coin", "oi"), ("$100,Give-l00K,Coin", "como foi seu dia?")]),
    ("ingles", [("ana.b", "hi beautiful, where are you from?")]),
    ("triste", [("pedro", "hoje meu time perdeu, to triste kkk")]),
    ("risada", [("leo", "kkkkkkkkk"), ("leo", "🔥🔥🔥")]),
]

ASSISTANT = re.compile(
    r"quer saber mais|posso (te )?ajudar|como posso|e importante|como (uma )?(ia|assistente)|"
    r"fico feliz em ajudar|espero ter ajudado|nao soube responder|gostaria de saber|how can i help|interests? you|"
    r"nao posso fazer isso|fique a vontade para|pesquisave|veiculos de noticia|fontes (oficiais|confiaveis)",
)


def fold(text: str) -> str:
    t = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", t)).strip()


def friendly(name: str) -> str:
    letters = sum(c.isalpha() for c in name)
    digits = sum(c.isdigit() for c in name)
    return "alguém" if re.search(r"[$,;|<>{}=+]", name) or letters < 2 or digits > letters else name


def http(method: str, url: str, body: dict | None = None, timeout: int = 300):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, method=method, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return json.loads(res.read())


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default="http://127.0.0.1:8000")
    ap.add_argument("--persona", default="viktoria")
    ap.add_argument("--provider", default="ollama")
    ap.add_argument("--model", default=None, help="modelo local (Ollama)")
    ap.add_argument("--key", default=None, help="chave da API (não é guardada)")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    ts = (ROOT / "src/core/tangoAiChatService.ts").read_text(encoding="utf-8")
    style = re.search(r"export const CONVERSATION_STYLE = `\\\n(.*?)`;", ts, re.S).group(1)
    personas = http("GET", f"{args.api}/api/v1/personas")["personas"]
    persona = next(p for p in personas if p["id"] == args.persona)
    identity = persona.get("personality") or ""
    examples = [(fold(q), fold(r)) for q, r in re.findall(r"\"([^\"]+)\"\s*→\s*\"([^\"]+)\"", identity)]
    now = datetime.now()
    hour = now.hour
    period = "madrugada" if hour < 5 else "manhã" if hour < 12 else "tarde" if hour < 18 else "noite"
    now_line = f"[AGORA] {WEEKDAYS[now.weekday()]}, {hour}h{now.minute:02d} ({period}). Você está ao vivo."

    lines = [f"## {persona['name']} · {args.provider}{' · ' + args.model if args.model else ''} · {now:%Y-%m-%d %H:%M}\n"]
    times: list[float] = []
    flags_total: dict[str, int] = {}
    own: list[str] = []
    for name, msgs in CONVERSAS:
        turns: list[dict] = []
        lines.append(f"**{name}**\n")
        for user, text in msgs:
            turns.append({"role": "user", "content": f"{friendly(user)}: {text}"})
            recent = own[-6:]
            system = "\n\n".join(x for x in [
                identity.strip(), style, now_line,
                ("[SUAS ÚLTIMAS FALAS NA LIVE] Não repita estas frases nem o jeito de começar:\n" + "\n".join(f"- {r}" for r in recent)) if recent else "",
            ] if x)
            t0 = time.time()
            data = http("POST", f"{args.api}/api/v1/ai/respond", {
                "persona_prompt": system, "chat_context": "", "conversation": turns,
                "user_prompt": turns[-1]["content"], "temperature": 0.7,
                "provider": args.provider, "provider_key": args.key, "local_model_name": args.model,
            })
            dt = time.time() - t0
            times.append(dt)
            reply = re.sub(r'^[\s"“”]+|[\s"“”]+$', "", (data.get("response") or "").strip())
            f = fold(reply)
            flags = []
            if ASSISTANT.search(f):
                flags.append("atendente")
            ask = set(fold(text).split())
            if any(f == r and len(ask & set(q.split())) / max(1, len(ask | set(q.split()))) < 0.3 for q, r in examples):
                flags.append("copiou_exemplo")
            if re.search(r"\bobrigado\b", f):
                flags.append("masculino")
            if any(fold(o) == f for o in own):
                flags.append("repetiu")
            if len(reply) > 140:
                flags.append("longa")
            if "$100" in reply:
                flags.append("nome_lixo")
            for fl in flags:
                flags_total[fl] = flags_total.get(fl, 0) + 1
            own.append(reply)
            turns.append({"role": "assistant", "content": reply})
            mark = f"  ⚠ {', '.join(flags)}" if flags else ""
            lines.append(f"- `{user}`: {text}\n  - → {reply}  _({dt:.1f}s · {data.get('provider')})_{mark}")
        lines.append("")
    total = sum(len(m) for _, m in CONVERSAS)
    lines.append(f"\n**Resumo:** {total} respostas · tempo médio {sum(times) / len(times):.1f}s (máx {max(times):.1f}s) · "
                 + ("vícios: " + ", ".join(f"{k} {v}" for k, v in flags_total.items()) if flags_total else "nenhum vício marcado"))
    report = "\n".join(lines)
    print(report)
    if args.out:
        Path(args.out).write_text(report, encoding="utf-8")


if __name__ == "__main__":
    main()
