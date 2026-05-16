import asyncio
import logging
import sys
import os

# Add the project root to sys.path
sys.path.append(os.getcwd())

from server.services.automation_service import automation_service

# Setup logging to see what's happening
logging.basicConfig(level=logging.INFO, format='%(name)s - %(levelname)s - %(message)s')

async def test_automation_flow():
    print("=== Odessa Live Automation Engine Test ===")

    # 1. Refresh engine config to load our new triggers
    from server.services.automation.engine import trigger_engine
    trigger_engine.refresh_config()

    # 2. Simulate OCR detection
    test_texts = [
        "Lucas enviou Rosa",
        "Ana mandou um coração",
        "Maria comentou: essa live está ótima!",
        "Bruno enviou Ro5a", # Test normalization
    ]

    for text in test_texts:
        print(f"\n[OCR] Detectado: '{text}'")
        automation_service.process_raw_text(text)

    # 3. Check the queue
    pending = automation_service.get_pending_actions()
    print(f"\n[QUEUE] Ações pendentes: {len(pending)}")
    for i, action in enumerate(pending):
        print(f"  {i+1}. {action.get('type')} - Video: {action.get('videoId')}")

    # 4. Consume an action
    print("\n[CONSUME] Consumindo próxima ação...")
    next_action = await automation_service.consume_next_action()
    if next_action:
        print(f"  Executando: {next_action.get('type')} -> {next_action.get('videoId')}")

    print("\n[FINISH] Teste concluído.")

if __name__ == "__main__":
    asyncio.run(test_automation_flow())
