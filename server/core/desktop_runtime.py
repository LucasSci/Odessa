from __future__ import annotations

import importlib
import os
import threading
import time
from typing import Any


BOOT_STARTED_AT = time.perf_counter()
BOOT_EVENTS: list[dict[str, Any]] = []
WARMUP_STATE: dict[str, Any] = {
    "running": False,
    "startedAt": None,
    "finishedAt": None,
    "services": {},
    "error": None,
}
_warmup_lock = threading.Lock()
CORE_SERVICES = [
    ("video", "server.services.video_service", "video_service"),
    ("workflow", "server.services.workflow_service", "workflow_service"),
    ("automation", "server.services.automation_service", "automation_service"),
]
HEAVY_SERVICES = [
    ("ai", "server.services.ai_service", "ai_service"),
    ("tts", "server.services.tts_service", "tts_service"),
    ("ocr", "server.services.ocr_service", "ocr_service"),
]


def mark_boot_event(name: str, **metadata: Any) -> None:
    BOOT_EVENTS.append(
        {
            "name": name,
            "atMs": round((time.perf_counter() - BOOT_STARTED_AT) * 1000),
            **metadata,
        }
    )


def _load_service(label: str, module_name: str, attr_name: str | None = None) -> dict[str, Any]:
    started = time.perf_counter()
    try:
        module = importlib.import_module(module_name)
        if attr_name:
            getattr(module, attr_name)
        result = {
            "ready": True,
            "durationMs": round((time.perf_counter() - started) * 1000),
            "error": None,
        }
    except Exception as exc:
        result = {
            "ready": False,
            "durationMs": round((time.perf_counter() - started) * 1000),
            "error": str(exc),
        }
    WARMUP_STATE["services"][label] = result
    mark_boot_event(f"warmup:{label}", **result)
    return result


def warmup_runtime_sync(level: str = "heavy") -> dict[str, Any]:
    level = "core" if level == "core" else "heavy"
    with _warmup_lock:
        if WARMUP_STATE["running"]:
            return WARMUP_STATE
        WARMUP_STATE.update(
            {
                "running": True,
                "startedAt": time.time(),
                "finishedAt": None,
                "level": level,
                "error": None,
            }
        )
        if level == "heavy":
            WARMUP_STATE["services"] = {}

    try:
        services = CORE_SERVICES if level == "core" else [*CORE_SERVICES, *HEAVY_SERVICES]
        for label, module_name, attr_name in services:
            current = WARMUP_STATE.get("services", {}).get(label)
            if current and current.get("ready"):
                continue
            _load_service(label, module_name, attr_name)
    except Exception as exc:
        WARMUP_STATE["error"] = str(exc)
    finally:
        WARMUP_STATE["running"] = False
        WARMUP_STATE["finishedAt"] = time.time()
        mark_boot_event("warmup:finished", level=level, coreReady=core_services_ready(), heavyReady=heavy_ready())
    return WARMUP_STATE


def warmup_runtime_background(level: str = "heavy") -> dict[str, Any]:
    if WARMUP_STATE["running"]:
        return WARMUP_STATE
    thread = threading.Thread(
        target=warmup_runtime_sync,
        args=(level,),
        name=f"odessa-runtime-warmup-{level}",
        daemon=True,
    )
    thread.start()
    return WARMUP_STATE


def core_services_ready() -> bool:
    services = WARMUP_STATE.get("services") or {}
    return all(bool(services.get(name, {}).get("ready")) for name, _module, _attr in CORE_SERVICES)


def core_ready() -> bool:
    return True


def heavy_ready() -> bool:
    services = WARMUP_STATE.get("services") or {}
    required = ["video", "workflow", "automation", "ai", "tts", "ocr"]
    return all(bool(services.get(name, {}).get("ready")) for name in required)


def ready_payload() -> dict[str, Any]:
    now = time.perf_counter()
    return {
        "ok": core_ready(),
        "pid": os.getpid(),
        "coreReady": core_ready(),
        "coreServicesReady": core_services_ready(),
        "heavyReady": heavy_ready(),
        "desktopEnabled": os.getenv("ODESSA_DESKTOP") == "1",
        "runtimeRoot": os.getenv("ODESSA_RUNTIME_ROOT"),
        "pythonExecutable": os.getenv("ODESSA_PYTHON_EXE"),
        "uptimeMs": round((now - BOOT_STARTED_AT) * 1000),
        "warmup": WARMUP_STATE,
        "services": WARMUP_STATE.get("services") or {},
    }


def boot_metrics_payload() -> dict[str, Any]:
    return {
        "pid": os.getpid(),
        "uptimeMs": round((time.perf_counter() - BOOT_STARTED_AT) * 1000),
        "events": BOOT_EVENTS,
        "warmup": WARMUP_STATE,
    }
