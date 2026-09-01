"""
Bridge Process Manager — Gerencia o processo Python do tango_chat.py.

Permite iniciar, parar e monitorar o processo da bridge via API,
eliminando a necessidade do usuario abrir terminal.
"""

from __future__ import annotations

import asyncio
import json
import logging
import sys
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

log = logging.getLogger("odessa.bridge")

# Diretório de runtime para configs
RUNTIME_DIR = Path(__file__).resolve().parent.parent / "runtime"
BRIDGE_CONFIG_FILE = RUNTIME_DIR / "bridge_config.json"
TANGO_CHAT_SCRIPT = Path(__file__).resolve().parent.parent.parent / "tango_chat" / "tango_chat.py"

MAX_LOG_LINES = 500


def _default_config() -> dict[str, Any]:
    return {
        "mode": "",
        "cdpUrl": "http://127.0.0.1:9222",
        "roomUrl": "https://tango.me/stream/broadcast",
        "port": 7555,
        "autoconnect": True,
        "selectors": {
            "containerChat": '[data-testid="virtuoso-item-list"]',
            "mensagem": '[data-testid^="chat-event-"]',
            "username": ".Hhi6n",
            "textoMsg": ".KR99L",
            "inputTexto": '[data-testid="textarea"]',
            "botaoEnviar": "",
        },
    }


class BridgeProcessManager:
    """Gerencia o subprocesso do tango_chat.py."""

    def __init__(self) -> None:
        self._process: asyncio.subprocess.Process | None = None
        self._log_buffer: deque[str] = deque(maxlen=MAX_LOG_LINES)
        self._started_at: str | None = None
        self._reader_task: asyncio.Task | None = None

    @property
    def is_running(self) -> bool:
        return self._process is not None and self._process.returncode is None

    @property
    def pid(self) -> int | None:
        return self._process.pid if self.is_running else None

    async def start(
        self,
        mode: str = "",
        autoconnect: bool = True,
        config: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if self.is_running:
            return {"ok": False, "error": "already_running", "pid": self.pid}

        script = str(TANGO_CHAT_SCRIPT)
        if not TANGO_CHAT_SCRIPT.exists():
            return {"ok": False, "error": f"Script not found: {script}"}

        effective_config = dict(config or {})
        if mode:
            effective_config["mode"] = mode

        args = [sys.executable, script]
        if effective_config:
            # Pass the complete configuration, including selectors. Environment
            # variables alone previously dropped selector overrides silently.
            args.append(f"--config={json.dumps(effective_config, ensure_ascii=False)}")
        if autoconnect:
            args.append("--autoconnect")

        env_overrides: dict[str, str] = {}
        if effective_config:
            if effective_config.get("cdpUrl"):
                env_overrides["TANGO_CDP_URL"] = effective_config["cdpUrl"]
            if effective_config.get("roomUrl"):
                env_overrides["TANGO_ROOM_URL"] = effective_config["roomUrl"]
            if effective_config.get("port"):
                env_overrides["TANGO_BRIDGE_PORT"] = str(effective_config["port"])

        import os
        env = {**os.environ, **env_overrides}

        self._log_buffer.clear()
        log.info("Starting bridge: %s", " ".join(args))

        try:
            self._process = await asyncio.create_subprocess_exec(
                *args,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                env=env,
            )
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

        self._started_at = datetime.now(timezone.utc).isoformat()
        self._reader_task = asyncio.create_task(self._read_output())

        log.info("Bridge started, pid=%s", self._process.pid)
        return {"ok": True, "pid": self._process.pid}

    async def stop(self) -> dict[str, Any]:
        if not self.is_running:
            return {"ok": False, "error": "not_running"}

        pid = self._process.pid
        log.info("Stopping bridge pid=%s", pid)

        try:
            self._process.terminate()
            try:
                await asyncio.wait_for(self._process.wait(), timeout=5)
            except asyncio.TimeoutError:
                self._process.kill()
                await self._process.wait()
        except Exception as exc:
            log.warning("Error stopping bridge: %s", exc)

        if self._reader_task and not self._reader_task.done():
            self._reader_task.cancel()

        self._process = None
        self._started_at = None
        return {"ok": True, "pid": pid}

    async def get_status(self) -> dict[str, Any]:
        bridge_reachable = False
        bridge_status: dict[str, Any] | None = None

        config = load_bridge_config()
        port = config.get("port", 7555)

        if self.is_running:
            try:
                import urllib.request
                url = f"http://127.0.0.1:{port}/status"
                req = urllib.request.Request(url, method="GET")
                with urllib.request.urlopen(req, timeout=2) as resp:
                    bridge_status = json.loads(resp.read().decode())
                    bridge_reachable = True
            except Exception:
                pass

        return {
            "processRunning": self.is_running,
            "pid": self.pid,
            "startedAt": self._started_at,
            "bridgeUrl": f"http://127.0.0.1:{port}",
            "bridgeReachable": bridge_reachable,
            "bridgeStatus": bridge_status,
        }

    def get_logs(self, limit: int = 100) -> dict[str, Any]:
        limit = min(max(1, limit), MAX_LOG_LINES)
        lines = list(self._log_buffer)[-limit:]
        return {"lines": lines, "total": len(self._log_buffer)}

    async def _read_output(self) -> None:
        """Lê stdout/stderr do processo e armazena no buffer."""
        if not self._process or not self._process.stdout:
            return
        try:
            while True:
                line = await self._process.stdout.readline()
                if not line:
                    break
                decoded = line.decode("utf-8", errors="replace").rstrip()
                if decoded:
                    self._log_buffer.append(decoded)
        except asyncio.CancelledError:
            pass
        except Exception as exc:
            log.warning("Error reading bridge output: %s", exc)


def load_bridge_config() -> dict[str, Any]:
    """Lê config da bridge do disco."""
    try:
        if BRIDGE_CONFIG_FILE.exists():
            raw = json.loads(BRIDGE_CONFIG_FILE.read_text(encoding="utf-8"))
            defaults = _default_config()
            defaults.update(raw)
            if "selectors" in raw and isinstance(raw["selectors"], dict):
                defaults["selectors"] = {**_default_config()["selectors"], **raw["selectors"]}
            return defaults
    except Exception:
        pass
    return _default_config()


def save_bridge_config(config: dict[str, Any]) -> dict[str, Any]:
    """Salva config da bridge no disco."""
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    merged = _default_config()
    for key in ("mode", "cdpUrl", "roomUrl", "port", "autoconnect"):
        if key in config:
            merged[key] = config[key]
    if "selectors" in config and isinstance(config["selectors"], dict):
        merged["selectors"] = {**merged["selectors"], **config["selectors"]}
    BRIDGE_CONFIG_FILE.write_text(json.dumps(merged, indent=2, ensure_ascii=False), encoding="utf-8")
    return merged


# ── Chrome Live Helpers ───────────────────────────────────────────────

def find_chrome_executable() -> str | None:
    """Procura o executável do Google Chrome no Windows."""
    import os
    candidates = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        str(Path.home() / "AppData" / "Local" / "Google" / "Chrome" / "Application" / "chrome.exe"),
    ]
    for path in candidates:
        if Path(path).exists():
            return path
    return None


async def launch_chrome_for_live(url: str = "https://tango.me/stream/broadcast", port: int = 9222) -> dict[str, Any]:
    """Abre o Google Chrome real com porta de depuração remota e URL da live."""
    chrome_path = find_chrome_executable()
    if not chrome_path:
        return {"ok": False, "error": "Google Chrome não encontrado no sistema."}

    # Flags do Chrome para habilitar acoplamento CDP sem interferir no uso normal
    args = [
        chrome_path,
        f"--remote-debugging-port={port}",
        "--no-first-run",
        "--no-default-browser-check",
        url,
    ]

    try:
        import subprocess
        # Inicia Chrome desanexado para não travar o backend
        subprocess.Popen(args, close_fds=True)
        return {
            "ok": True,
            "chromePath": chrome_path,
            "port": port,
            "url": url,
            "message": f"Chrome iniciado na porta {port} com a página {url}",
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


async def get_chrome_debug_tabs(port: int = 9222) -> dict[str, Any]:
    """Verifica se o Chrome está aberto com debug e lista as abas abertas."""
    import urllib.request
    try:
        url = f"http://127.0.0.1:{port}/json/list"
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=1.5) as resp:
            data = json.loads(resp.read().decode())
            tabs = []
            for t in data:
                if t.get("type") == "page":
                    tab_url = t.get("url", "")
                    tabs.append({
                        "id": t.get("id", ""),
                        "title": t.get("title", ""),
                        "url": tab_url,
                        "isTango": "tango.me" in tab_url.lower(),
                        "isBroadcast": "broadcast" in tab_url.lower() or "/stream" in tab_url.lower(),
                    })
            return {
                "runningWithDebug": True,
                "port": port,
                "tabs": tabs,
                "tangoTabFound": any(t["isTango"] for t in tabs),
            }
    except Exception:
        return {
            "runningWithDebug": False,
            "port": port,
            "tabs": [],
            "tangoTabFound": False,
        }


def create_desktop_shortcut(url: str = "https://tango.me/stream/broadcast", port: int = 9222) -> dict[str, Any]:
    """Cria um atalho no Desktop do Windows para abrir o Chrome da Live com 1 clique."""
    chrome_path = find_chrome_executable()
    if not chrome_path:
        return {"ok": False, "error": "Google Chrome não encontrado."}

    desktop_dir = Path.home() / "Desktop"
    if not desktop_dir.exists():
        desktop_dir = Path.home() / "Área de Trabalho"
    if not desktop_dir.exists():
        desktop_dir = Path.home() / "Desktop"

    shortcut_path = desktop_dir / "Tango Live Studio (Odessa).lnk"
    arguments = f'--remote-debugging-port={port} "{url}"'

    ps_script = """
    $payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
    $WshShell = New-Object -ComObject WScript.Shell
    $Shortcut = $WshShell.CreateShortcut($payload.shortcut_path)
    $Shortcut.TargetPath = $payload.chrome_path
    $Shortcut.Arguments = $payload.arguments
    $Shortcut.Description = 'Abre o Chrome com depuração ativa para o Tango Live da Odessa'
    $Shortcut.IconLocation = "$($payload.chrome_path),0"
    $Shortcut.Save()
    """

    try:
        import json
        import subprocess
        payload = json.dumps({
            "shortcut_path": str(shortcut_path),
            "chrome_path": str(chrome_path),
            "arguments": arguments
        })
        subprocess.run(
            ["powershell", "-NoProfile", "-Command", ps_script],
            input=payload,
            text=True,
            check=True,
            capture_output=True
        )
        return {
            "ok": True,
            "shortcutPath": str(shortcut_path),
            "message": f"Atalho criado na Área de Trabalho: {shortcut_path.name}",
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


# Instância global
bridge_manager = BridgeProcessManager()

