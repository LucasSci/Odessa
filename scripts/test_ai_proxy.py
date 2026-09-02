# -*- coding: utf-8 -*-
import json
import sys
import urllib.request

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

body = {
    "persona_prompt": "Voce e a Odessa, carinhosa e bem-humorada. Responda curto.",
    "chat_context": "Usuário: Lucas",
    "user_prompt": 'Mensagem: "oi amores"',
    "temperature": 0.7,
}
req = urllib.request.Request(
    "http://localhost:3000/api/v1/ai/respond",
    data=json.dumps(body).encode("utf-8"),
    method="POST",
    headers={"Content-Type": "application/json"},
)
try:
    with urllib.request.urlopen(req, timeout=40) as r:
        d = json.loads(r.read().decode("utf-8"))
        print("PROVIDER:", d.get("provider"))
        print("RESPONSE:", d.get("response"))
except Exception as e:
    print("ERR", e)
