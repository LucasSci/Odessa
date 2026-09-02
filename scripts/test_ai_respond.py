# -*- coding: utf-8 -*-
import json
import sys
import urllib.request

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

body = {
    "persona_prompt": "Voce e a Odessa, uma streamer carinhosa e bem-humorada. Responda de forma curta e calorosa.",
    "chat_context": "Usuário: Lucas",
    "user_prompt": 'Mensagem: "oi amores, tudo bem?"',
    "temperature": 0.7,
}
req = urllib.request.Request(
    "http://localhost:8000/api/v1/ai/respond",
    data=json.dumps(body).encode("utf-8"),
    method="POST",
    headers={"Content-Type": "application/json"},
)
try:
    with urllib.request.urlopen(req, timeout=40) as r:
        data = json.loads(r.read().decode("utf-8"))
        print("PROVIDER:", data.get("provider"))
        print("RESPONSE:", data.get("response"))
except urllib.error.HTTPError as e:
    print("HTTP", e.code)
    print(e.read().decode("utf-8"))
except Exception as e:
    print("ERR", e)
