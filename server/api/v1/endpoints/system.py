"""
system.py — Ciclo de vida do Odessa: status e "Desligar".

Desligar precisa ser limpo: matar o processo no Windows (TerminateProcess)
pula o lifespan de server/main.py e deixa a bridge do Tango e o `ollama serve`
órfãos. Aqui a resposta volta na hora e, em segundo plano, a bridge para, a IA
local sai da memória, o Ollama aberto pelo Odessa fecha e o próprio uvicorn
recebe SIGINT (encerramento normal, com o lifespan rodando).
"""
import asyncio
import logging
import os
import signal

from fastapi import APIRouter

logger = logging.getLogger("odessa.routes.system")

router = APIRouter(tags=["system"])

APP_VERSION = "1.1.0"
_shutting_down = False


async def _stop_everything() -> None:
    await asyncio.sleep(0.3)  # deixa a resposta HTTP sair antes
    try:
        from server.services.bridge_manager import bridge_manager

        if bridge_manager.is_running:
            await bridge_manager.stop()
    except Exception as exc:  # noqa: BLE001
        logger.warning("[shutdown] bridge: %s", exc)
    try:
        from server.api.v1.endpoints.ai import ollama_unload, stop_owned_ollama

        await ollama_unload()
        await asyncio.to_thread(stop_owned_ollama)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[shutdown] ollama: %s", exc)
    logger.info("[shutdown] encerrando o servidor")
    signal.raise_signal(signal.SIGINT)


@router.get("/status")
async def system_status():
    try:
        from server.services.bridge_manager import bridge_manager

        bridge_running = bool(bridge_manager.is_running)
    except Exception:  # noqa: BLE001
        bridge_running = False
    return {
        "ok": True,
        "version": APP_VERSION,
        "pid": os.getpid(),
        "desktop": os.getenv("ODESSA_DESKTOP") == "1",
        "bridgeRunning": bridge_running,
        "shuttingDown": _shutting_down,
    }


@router.post("/shutdown")
async def system_shutdown():
    global _shutting_down
    if not _shutting_down:
        _shutting_down = True
        asyncio.get_running_loop().create_task(_stop_everything())
    return {"ok": True, "shuttingDown": True}
