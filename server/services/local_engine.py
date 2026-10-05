"""
local_engine.py — o motor da IA local do Odessa na GPU integrada (llama.cpp / Vulkan).

O Ollama do usuário roda só na CPU (ele descarta a GPU integrada por padrão).
Medido no PC da live (Ryzen 5 5500U, Radeon Vega), qwen3:4b-instruct, mesmo
prompt da live:

    GPU integrada: 3,2–4,3 s por resposta, ~37% de UM núcleo
    CPU:           6,3–16,5 s por resposta, 330–390% (~4 dos 6 núcleos)

Ou seja: 3× mais rápido e ~3,5 núcleos livres para o OBS durante a live.

O motor é o `llama-server` do llama.cpp — o mesmo que o Ollama usa por baixo.
Aqui o Odessa roda ele direto, como processo filho:
  - binário: o próprio do Odessa (pasta `llama/` do programa, quando o
    instalador trouxer) ou o que já vem com o Ollama instalado (com o backend
    Vulkan, que o Ollama deixa numa subpasta);
  - modelo: o arquivo GGUF que o Ollama já baixou (lido pelo manifest, sem copiar);
  - só em 127.0.0.1, com token, numa porta livre;
  - GPU primeiro; se o motor não subir na GPU, sobe na CPU;
  - descarrega depois de 10 min sem uso fora da live (devolve a RAM).
Se nada disso existir, o Odessa continua usando o Ollama como antes.
"""
from __future__ import annotations

import json
import logging
import os
import re
import secrets
import socket
import subprocess
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger("odessa.local_engine")

CONTEXT_TOKENS = 4096
IDLE_UNLOAD_S = 10 * 60
START_TIMEOUT_S = 180
THREADS = 4


def _install_root() -> Path:
    return Path(__file__).resolve().parents[2]


def find_engine() -> Optional[Dict[str, Any]]:
    """{exe, env} do llama-server com backend de GPU, ou None."""
    custom = os.getenv("ODESSA_LLAMA_SERVER", "").strip()
    candidates: List[Path] = []
    if custom:
        candidates.append(Path(custom))
    candidates.append(_install_root() / "llama" / "llama-server.exe")
    local = os.getenv("LOCALAPPDATA", "")
    if local:
        candidates.append(Path(local) / "Programs" / "Ollama" / "lib" / "ollama" / "llama-server.exe")
    for exe in candidates:
        if not exe.is_file():
            continue
        env = dict(os.environ)
        vulkan = exe.parent / "vulkan" / "ggml-vulkan.dll"
        if not (exe.parent / "ggml-vulkan.dll").exists() and vulkan.exists():
            # O Ollama guarda o backend Vulkan numa subpasta que o llama-server
            # não procura sozinho.
            env["GGML_BACKEND_PATH"] = str(vulkan)
        return {"exe": exe, "env": env}
    return None


def ollama_models_dir() -> Path:
    custom = os.getenv("OLLAMA_MODELS", "").strip()
    return Path(custom) if custom else Path.home() / ".ollama" / "models"


# Nome de modelo do Ollama ("qwen3:4b-instruct", "user/modelo:tag") e o hash do
# arquivo: o nome vem do pedido e vira caminho no disco — nada de "..".
_MODEL_NAME = re.compile(r"^[a-z0-9][a-z0-9._-]*(?:/[a-z0-9][a-z0-9._-]*)?(?::[a-z0-9][a-z0-9._-]*)?$", re.IGNORECASE)
_BLOB_DIGEST = re.compile(r"^sha256:[0-9a-f]{64}$")


def resolve_model(name: str, models_dir: Optional[Path] = None) -> Optional[Path]:
    """Arquivo GGUF de um modelo do Ollama ("qwen3:4b-instruct"), pelo manifest."""
    models_dir = models_dir or ollama_models_dir()
    name = (name or "").strip()
    if not _MODEL_NAME.match(name) or ".." in name:
        return None
    model, _, tag = name.partition(":")
    if not model:
        return None
    namespace, _, short = model.rpartition("/")
    manifest = models_dir / "manifests" / "registry.ollama.ai" / (namespace or "library") / short / (tag or "latest")
    try:
        layers = json.loads(manifest.read_text(encoding="utf-8")).get("layers") or []
    except (OSError, ValueError):
        return None
    digest = next((layer.get("digest") for layer in layers if layer.get("mediaType") == "application/vnd.ollama.image.model"), None)
    if not digest or not _BLOB_DIGEST.match(str(digest)):
        return None
    blob = models_dir / "blobs" / str(digest).replace(":", "-")
    return blob if blob.is_file() else None


def _log_safe(value: object) -> str:
    """Texto para o log sem quebra de linha (um valor vindo de fora não forja linhas)."""
    return str(value).replace("\r", " ").replace("\n", " ")


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class LocalEngine:
    """Um llama-server por vez, para o modelo pedido."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._proc: Optional[subprocess.Popen] = None
        self._port = 0
        self._token = ""
        self._model = ""
        self._device = ""
        self._last_used = 0.0
        self._gpu_failed_for: set[str] = set()

    # ── estado ──────────────────────────────────────────────────────────────
    @property
    def running(self) -> bool:
        return self._proc is not None and self._proc.poll() is None

    def status(self) -> Dict[str, Any]:
        engine = find_engine()
        return {
            "available": engine is not None,
            "engine": str(engine["exe"]) if engine else None,
            "running": self.running,
            "model": self._model if self.running else None,
            "device": self._device if self.running else None,
            "idleSeconds": round(time.monotonic() - self._last_used) if self.running and self._last_used else None,
        }

    # ── ciclo de vida ───────────────────────────────────────────────────────
    def _spawn(self, exe: Path, env: Dict[str, str], model_path: Path, gpu: bool) -> bool:
        port, token = _free_port(), secrets.token_urlsafe(24)
        args = [
            str(exe), "-m", str(model_path), "--host", "127.0.0.1", "--port", str(port),
            "--api-key", token, "-c", str(CONTEXT_TOKENS), "-np", "1", "--jinja", "-t", str(THREADS),
            "--no-webui", "-ngl", "99" if gpu else "0",
        ]
        proc = subprocess.Popen(
            args, cwd=str(exe.parent), env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        deadline = time.monotonic() + START_TIMEOUT_S
        import urllib.request

        while time.monotonic() < deadline:
            if proc.poll() is not None:
                return False
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=2) as res:
                    if json.loads(res.read()).get("status") == "ok":
                        self._proc, self._port, self._token = proc, port, token
                        return True
            except Exception:  # noqa: BLE001 — ainda carregando
                pass
            time.sleep(0.5)
        proc.kill()
        return False

    def ensure(self, model: str) -> Optional[Dict[str, Any]]:
        """Motor pronto para `model`: {url, token} ou None (sem motor/modelo)."""
        with self._lock:
            if self.running and self._model == model:
                self._last_used = time.monotonic()
                return {"url": f"http://127.0.0.1:{self._port}", "token": self._token}
            engine = find_engine()
            model_path = resolve_model(model)
            if not engine or not model_path:
                return None
            self._stop_locked()
            started = time.monotonic()
            gpu = model not in self._gpu_failed_for
            ok = self._spawn(engine["exe"], engine["env"], model_path, gpu=gpu)
            if not ok and gpu:
                logger.warning("[motor local] não subiu na GPU com %s; tentando na CPU", _log_safe(model))
                self._gpu_failed_for.add(model)
                gpu = False
                ok = self._spawn(engine["exe"], engine["env"], model_path, gpu=False)
            if not ok:
                logger.error("[motor local] não subiu com %s", _log_safe(model))
                return None
            self._model, self._device, self._last_used = model, "gpu" if gpu else "cpu", time.monotonic()
            logger.info("[motor local] %s pronto na %s em %.1f s", _log_safe(model), self._device.upper(), time.monotonic() - started)
            return {"url": f"http://127.0.0.1:{self._port}", "token": self._token}

    def mark_used(self) -> None:
        self._last_used = time.monotonic()

    def _stop_locked(self) -> None:
        proc, self._proc = self._proc, None
        if proc is not None and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()

    def stop(self) -> None:
        with self._lock:
            self._stop_locked()

    def unload_if_idle(self, idle_s: float = IDLE_UNLOAD_S) -> bool:
        with self._lock:
            if self.running and time.monotonic() - self._last_used >= idle_s:
                logger.info("[motor local] descarregado depois de %d min sem uso", idle_s // 60)
                self._stop_locked()
                return True
        return False


local_engine = LocalEngine()


def engine_mode() -> str:
    """'gpu' (motor do Odessa) ou 'ollama'. Padrão: motor do Odessa quando existe."""
    from server.core.atomic_json import read_json
    from server.config import RUNTIME_DIR

    saved = read_json(RUNTIME_DIR / "ai_engine.json", default_factory=dict) if (RUNTIME_DIR / "ai_engine.json").exists() else {}
    mode = str(saved.get("mode") or os.getenv("ODESSA_LOCAL_ENGINE", "auto")).strip().lower()
    if mode == "ollama":
        return "ollama"
    return "gpu" if find_engine() else "ollama"


def set_engine_mode(mode: str) -> None:
    from server.core.atomic_json import write_json
    from server.config import RUNTIME_DIR

    write_json(RUNTIME_DIR / "ai_engine.json", {"mode": "ollama" if mode == "ollama" else "auto"})
