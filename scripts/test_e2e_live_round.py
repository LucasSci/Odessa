import requests
import time
import json

base_url = "http://localhost:8000/api/v1"

print("--- Teste End-to-End da Odessa Live Engine ---")

# 1. Simular OCR lendo o chat
texto_lido = "Lucas enviou Rosa"
print(f"\n1. OCR leu na tela: '{texto_lido}'")
print("Enviando texto bruto para o Motor de Automação...")

res = requests.post(f"{base_url}/automation/test-trigger?text={texto_lido}")
print(f"Status do Parser: {res.status_code}")

# Dar tempo para a fila processar
time.sleep(1)

# 2. Checar Fila de Execução (O que o Studio vai consumir)
print("\n2. Checando a Fila de Ações (O que o Studio vai tocar agora)...")
res_queue = requests.get(f"{base_url}/automation/queue")
queue_data = res_queue.json().get("queue", [])
if queue_data:
    for action in queue_data:
        print(f"SUCESSO - ACAO NA FILA: Tocar video ID = '{action.get('videoId')}' (Prioridade: {action.get('priority', 0)})")
else:
    print("FALHA - Nenhuma acao na fila. O gatilho falhou.")

# 3. Verificando os Logs do Raciocínio da Odessa
print("\n3. Logs Internos de Execução (Raciocínio):")
res_logs = requests.get(f"{base_url}/automation/logs")
logs = res_logs.json().get("logs", [])
for log in reversed(logs[:5]): # Mostrar os últimos 5
    print(f"[{log['stage']}] {log['message']}")

print("\n-------------------------------------------")
print("Se houver uma ação na fila, o PersonaStudio.tsx já capturou e está tocando o vídeo na tela!")
