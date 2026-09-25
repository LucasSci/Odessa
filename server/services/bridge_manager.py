"""
Bridge Process Manager — Gerencia o processo Python do tango_chat.py.

Permite iniciar, parar e monitorar o processo da bridge via API,
eliminando a necessidade do usuario abrir terminal.
"""

from __future__ import annotations

import asyncio
import json
import logging
import shutil
import subprocess
import sys
import threading
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from server.core.atomic_json import file_lock, read_json, write_json

log = logging.getLogger("odessa.bridge")

# Diretório de runtime para configs
RUNTIME_DIR = Path(__file__).resolve().parent.parent / "runtime"
BRIDGE_CONFIG_FILE = RUNTIME_DIR / "bridge_config.json"
TANGO_CHAT_SCRIPT = Path(__file__).resolve().parent.parent.parent / "tango_chat" / "tango_chat.py"

MAX_LOG_LINES = 500

# Token compartilhado com o tango_chat.py (ver tango_chat/bridge_guard.py).
# Persistido em disco: o bridge_manager "adota" uma bridge órfã de uma execução
# anterior do backend, e ela só continua acessível se o token sobreviver ao
# reinício. TANGO_BRIDGE_TOKEN no ambiente tem prioridade (ex.: docker-compose).
BRIDGE_TOKEN_HEADER = "X-Bridge-Token"
_BRIDGE_TOKEN_FILE = "bridge.token"
_token_cache: dict[Path, str] = {}


def get_bridge_token() -> str:
    import os
    import secrets

    explicit = os.environ.get("TANGO_BRIDGE_TOKEN", "").strip()
    if explicit:
        return explicit
    path = RUNTIME_DIR / _BRIDGE_TOKEN_FILE
    cached = _token_cache.get(path)
    if cached:
        return cached
    try:
        token = path.read_text(encoding="utf-8").strip()
    except OSError:
        token = ""
    if len(token) < 24:
        token = secrets.token_urlsafe(32)
        RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
        path.write_text(token, encoding="utf-8")
        try:
            path.chmod(0o600)  # sem efeito no Windows; protege em Linux/Mac
        except OSError:
            pass
    _token_cache[path] = token
    return token


def bridge_auth_headers() -> dict[str, str]:
    return {BRIDGE_TOKEN_HEADER: get_bridge_token()}



def _default_config() -> dict[str, Any]:
    return {
        "mode": "",
        # Navegador da live: "auto" (padrão do sistema → Edge → Chrome…) ou um id
        # fixo (edge, chrome, brave, opera, vivaldi). Ver browser_discovery.py.
        "browser": "auto",
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
        self._process: subprocess.Popen | None = None
        self._log_buffer: deque[str] = deque(maxlen=MAX_LOG_LINES)
        self._started_at: str | None = None
        self._reader_thread: threading.Thread | None = None
        self._adopted: bool = False

    @property
    def is_running(self) -> bool:
        return self._process is not None and self._process.poll() is None

    @property
    def pid(self) -> int | None:
        return self._process.pid if self.is_running else None

    def _probe_bridge(self, port: int) -> dict[str, Any] | None:
        """Consulta o /status de um bridge na porta, se houver um respondendo."""
        try:
            import urllib.request
            url = f"http://127.0.0.1:{port}/status"
            req = urllib.request.Request(url, method="GET", headers=bridge_auth_headers())
            with urllib.request.urlopen(req, timeout=2) as resp:
                return json.loads(resp.read().decode())
        except Exception:
            return None

    def _port_in_use(self, port: int) -> bool:
        """Verifica se algo já está escutando na porta (bridge órfã, etc.)."""
        try:
            import socket
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.settimeout(0.5)
                return s.connect_ex(("127.0.0.1", port)) == 0
        except Exception:
            return False

    async def start(
        self,
        mode: str = "",
        autoconnect: bool = True,
        config: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if self.is_running:
            return {"ok": False, "error": "already_running", "pid": self.pid}

        # Se já existe um bridge respondendo na porta (ex.: processo órfão de
        # uma execução anterior do backend), adota-o em vez de tentar iniciar
        # outro e falhar com "porta em uso".
        effective_config = dict(config or {})
        if mode:
            effective_config["mode"] = mode
        port = int(effective_config.get("port", 7555))
        existing = await asyncio.to_thread(self._probe_bridge, port)
        if existing is not None:
            self._adopted = True
            self._started_at = existing.get("startedAt") or datetime.now(timezone.utc).isoformat()
            log.info("Adopting already-running bridge on port %s", port)
            return {
                "ok": True,
                "pid": None,
                "adopted": True,
                "bridgeStatus": existing,
            }

        script = str(TANGO_CHAT_SCRIPT)
        if not TANGO_CHAT_SCRIPT.exists():
            return {"ok": False, "error": f"Script not found: {script}"}

        effective_config = dict(config or {})
        if mode:
            effective_config["mode"] = mode

        # Navegador do modo standalone (a bridge abre o navegador ela mesma):
        # o escolhido/Automático em vez de só o Chromium embutido, com o mesmo
        # perfil dedicado do botão "Abrir navegador da live" — o login do Tango
        # feito num modo vale no outro. Sem navegador instalado, fica o embutido.
        chosen = await asyncio.to_thread(resolve_live_browser, effective_config.get("browser"))
        if chosen:
            effective_config["browserId"] = chosen["id"]
            effective_config["browserName"] = chosen["name"]
            effective_config["browserChannel"] = chosen.get("playwrightChannel")
            effective_config["browserExecutable"] = chosen["path"]
            effective_config["profileDir"] = str(debug_profile_dir_for(chosen["id"]))

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
        # Sempre, mesmo sem config: sem o token a bridge nasceria aberta.
        env_overrides["TANGO_BRIDGE_TOKEN"] = get_bridge_token()

        import os
        env = {**os.environ, **env_overrides}

        self._log_buffer.clear()
        log.info("Starting bridge: %s", " ".join(args))

        try:
            # subprocess.Popen (síncrono) em vez de asyncio.create_subprocess_exec:
            # uvicorn --reload no Windows força o worker a rodar sob
            # SelectorEventLoop (uvicorn/loops/asyncio.py usa
            # asyncio.SelectorEventLoop diretamente quando use_subprocess=True,
            # ignorando qualquer asyncio.set_event_loop_policy em código de app),
            # e SelectorEventLoop não implementa subprocess_exec — sempre falha
            # com NotImplementedError (que além disso stringifica pra "",
            # mascarando o erro). Popen não depende do loop, então funciona
            # com --reload ligado ou desligado. launch_chrome_for_live() abaixo
            # já usa o mesmo padrão.
            self._process = subprocess.Popen(
                args,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                env=env,
                text=True,
                bufsize=1,
            )
        except Exception as exc:
            log.exception("Failed to spawn bridge subprocess")
            return {"ok": False, "error": str(exc) or type(exc).__name__}

        self._started_at = datetime.now(timezone.utc).isoformat()
        self._reader_thread = threading.Thread(
            target=self._read_output, daemon=True, name="bridge-output-reader"
        )
        self._reader_thread.start()

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
                await asyncio.to_thread(self._process.wait, timeout=5)
            except subprocess.TimeoutExpired:
                self._process.kill()
                await asyncio.to_thread(self._process.wait)
        except Exception as exc:
            log.warning("Error stopping bridge: %s", exc)

        # Thread daemon: termina sozinha quando o pipe fecha (processo morto);
        # não precisa de cancelamento explícito como uma asyncio.Task.
        self._reader_thread = None

        self._process = None
        self._started_at = None
        return {"ok": True, "pid": pid}

    async def get_status(self) -> dict[str, Any]:
        config = load_bridge_config()
        port = config.get("port", 7555)

        # Sempre sonda a porta: mesmo sem processo gerenciado (ex.: bridge órfã
        # de uma execução anterior), reflete a realidade da conectividade.
        # Numa thread: no Windows uma conexão recusada em localhost leva ~2 s, e
        # a sonda síncrona aqui dentro congelava o servidor inteiro (Palco,
        # overlay do OBS e painel travavam a cada consulta de status).
        bridge_status = await asyncio.to_thread(self._probe_bridge, port)
        bridge_reachable = bridge_status is not None

        if self._adopted and not bridge_reachable:
            # O processo adotado (que nao temos um handle Popen dele, so
            # sabiamos que algo respondia na porta) morreu ou foi encerrado
            # externamente. Sem isso, self._adopted ficava True para sempre
            # depois da primeira adocao -- o painel continuava mostrando
            # "bridge ativa" mesmo com o processo morto, e um /bridge/start
            # seguinte tambem achava que ja tinha algo rodando e nao subia
            # um processo novo. Limpa para refletir a realidade e permitir
            # que o proximo start funcione de verdade.
            self._adopted = False
            self._started_at = None

        if self._process is not None and not self.is_running:
            # O processo que NÓS mesmos iniciamos (self._process não é None)
            # morreu sozinho (crash, erro de import etc.) sem passar por
            # stop() — sem isto, startedAt/pid ficavam "fantasmas" indicando
            # uma bridge de pé mesmo com processRunning:false, confundindo
            # o diagnóstico de por que ela caiu.
            self._process = None
            self._started_at = None

        process_running = self.is_running or self._adopted

        return {
            "processRunning": process_running,
            "pid": self.pid,
            "adopted": self._adopted,
            "startedAt": self._started_at,
            "bridgeUrl": f"http://127.0.0.1:{port}",
            "bridgeReachable": bridge_reachable,
            "bridgeStatus": bridge_status,
        }

    def get_logs(self, limit: int = 100) -> dict[str, Any]:
        limit = min(max(1, limit), MAX_LOG_LINES)
        lines = list(self._log_buffer)[-limit:]
        return {"lines": lines, "total": len(self._log_buffer)}

    def _read_output(self) -> None:
        """Lê stdout/stderr do processo (bloqueante) e armazena no buffer.

        Roda numa thread dedicada porque agora usamos subprocess.Popen (as
        pipes dele são síncronas), não mais asyncio.subprocess.
        """
        if not self._process or not self._process.stdout:
            return
        try:
            for line in self._process.stdout:
                decoded = line.rstrip()
                if decoded:
                    self._log_buffer.append(decoded)
        except (ValueError, OSError):
            pass  # pipe fechado (processo encerrado) — encerra a thread normalmente
        except Exception as exc:
            log.warning("Error reading bridge output: %s", exc)


def load_bridge_config() -> dict[str, Any]:
    """Lê config da bridge do disco."""
    try:
        if BRIDGE_CONFIG_FILE.exists():
            raw = read_json(BRIDGE_CONFIG_FILE, default_factory=dict)
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
    merged = _default_config()
    for key in ("mode", "cdpUrl", "roomUrl", "port", "autoconnect"):
        if key in config:
            merged[key] = config[key]
    # Navegador: telas antigas mandam o config sem este campo — mantém o salvo.
    from server.services.browser_discovery import AUTO, SPECS

    browser = str(config.get("browser") or load_bridge_config().get("browser") or AUTO).strip().lower()
    merged["browser"] = browser if browser == AUTO or any(spec.id == browser for spec in SPECS) else AUTO
    if "selectors" in config and isinstance(config["selectors"], dict):
        merged["selectors"] = {**merged["selectors"], **config["selectors"]}
    write_json(BRIDGE_CONFIG_FILE, merged)
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


def validate_chrome_target(url: Any, port: Any) -> tuple[str, int]:
    """Valida url/porta que vão para a linha de comando do Chrome.

    Sem isso, um `url` como `--renderer-cmd-prefix=<comando>` seria lido pelo
    Chrome como FLAG e executaria um programa; num atalho .lnk o mesmo valor
    ficaria gravado. Só aceita http(s) com host, sem espaços/aspas/controle e
    sem começar com "-". Levanta ValueError com mensagem para o usuário.
    """
    if not isinstance(url, str) or not url.strip():
        raise ValueError("URL da live vazia.")
    candidate = url.strip()
    if candidate.startswith("-"):
        raise ValueError("URL inválida.")
    if any(ch.isspace() or ch in "\"'`^<>|" or ord(ch) < 32 for ch in candidate):
        raise ValueError("URL contém caracteres não permitidos.")
    parsed = urlparse(candidate)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ValueError("Use uma URL http(s) completa (ex.: https://tango.me/...).")

    try:
        port_num = int(port)
    except (TypeError, ValueError):
        raise ValueError("Porta inválida.") from None
    if not 1024 <= port_num <= 65535:
        raise ValueError("A porta deve estar entre 1024 e 65535.")
    return candidate, port_num


def resolve_live_browser(browser: str | None = None) -> dict[str, Any] | None:
    """Navegador da live: o pedido, senão a preferência salva, senão o Automático."""
    from server.services.browser_discovery import resolve_browser

    preference = browser or load_bridge_config().get("browser") or "auto"
    chosen = resolve_browser(preference)
    return chosen.to_dict() if chosen else None


def debug_profile_dir_for(browser_id: str) -> Path:
    """Perfil dedicado por navegador (a porta de depuração não funciona no perfil
    padrão, e perfis de navegadores diferentes não podem ser compartilhados).

    Fica em BROWSER_PROFILES_DIR, fora da pasta do programa, para o login do
    Tango sobreviver às atualizações. O perfil antigo do Chrome
    (server/runtime/chrome-debug-profile) é movido na primeira vez.
    """
    from server.config import BROWSER_PROFILES_DIR

    path = BROWSER_PROFILES_DIR / browser_id
    legacy = RUNTIME_DIR / "chrome-debug-profile"
    if browser_id == "chrome" and not path.exists() and legacy.exists():
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(legacy), str(path))
            log.info("Perfil do Chrome (login do Tango) movido para %s", path)
        except OSError as exc:
            # Chrome aberto com esse perfil segura os arquivos: usa o antigo por ora.
            log.warning("Não deu para mover o perfil do Chrome (%s); usando o antigo.", exc)
            return legacy
    path.mkdir(parents=True, exist_ok=True)
    return path


async def launch_chrome_for_live(
    url: str = "https://tango.me/stream/broadcast",
    port: int = 9222,
    browser: str | None = None,
) -> dict[str, Any]:
    """Abre o navegador da live (Edge, Chrome, Brave…) com porta de depuração e a URL da live.

    O nome ficou por compatibilidade; o navegador vem de `browser` ou do config.
    """
    try:
        url, port = validate_chrome_target(url, port)
    except ValueError as exc:
        return {"ok": False, "error": str(exc)}

    chosen = resolve_live_browser(browser)
    if not chosen:
        return {"ok": False, "error": "Nenhum navegador compatível encontrado (Edge, Chrome, Brave, Opera ou Vivaldi)."}
    chrome_path = chosen["path"]

    # Desde o Chrome ~136 (e no Edge, mesmo motor), --remote-debugging-port é
    # ignorado SILENCIOSAMENTE quando o processo usa o user-data-dir PADRÃO do
    # usuário — restrição de segurança contra ativação remota de depuração no
    # perfil principal. Precisa de um --user-data-dir dedicado.
    debug_profile_dir = debug_profile_dir_for(chosen["id"])

    # Flags do Chrome para habilitar acoplamento CDP sem interferir no uso normal
    args = [
        chrome_path,
        f"--remote-debugging-port={port}",
        f"--user-data-dir={debug_profile_dir}",
        "--no-first-run",
        "--no-default-browser-check",
        "--",  # o que vem depois é sempre URL, nunca flag
        url,
    ]

    try:
        import subprocess
        # Inicia Chrome desanexado para não travar o backend
        subprocess.Popen(args, close_fds=True)
        return {
            "ok": True,
            "chromePath": chrome_path,
            "browser": chosen["id"],
            "browserName": chosen["name"],
            "port": port,
            "url": url,
            "message": f"{chosen['name']} iniciado na porta {port} com a página {url}",
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


async def get_chrome_debug_tabs(port: int = 9222) -> dict[str, Any]:
    """Verifica se o Chrome está aberto com debug e lista as abas abertas.

    Roda numa thread para não bloquear o servidor (ver get_status)."""
    return await asyncio.to_thread(_chrome_debug_tabs_sync, port)


def _chrome_debug_tabs_sync(port: int) -> dict[str, Any]:
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


def create_desktop_shortcut(
    url: str = "https://tango.me/stream/broadcast",
    port: int = 9222,
    browser: str | None = None,
) -> dict[str, Any]:
    """Cria um atalho no Desktop do Windows que abre o navegador da live com 1 clique."""
    try:
        url, port = validate_chrome_target(url, port)
    except ValueError as exc:
        return {"ok": False, "error": str(exc)}

    chosen = resolve_live_browser(browser)
    if not chosen:
        return {"ok": False, "error": "Nenhum navegador compatível encontrado (Edge, Chrome, Brave, Opera ou Vivaldi)."}
    chrome_path = chosen["path"]

    desktop_dir = Path.home() / "Desktop"
    if not desktop_dir.exists():
        desktop_dir = Path.home() / "Área de Trabalho"
    if not desktop_dir.exists():
        desktop_dir = Path.home() / "Desktop"

    shortcut_path = desktop_dir / "Tango Live Studio (Odessa).lnk"
    debug_profile_dir = debug_profile_dir_for(chosen["id"])
    # Mesmo motivo do launch_chrome_for_live: sem --user-data-dir dedicado,
    # o Chrome ignora --remote-debugging-port silenciosamente no perfil padrão.
    arguments = f'--remote-debugging-port={port} --user-data-dir="{debug_profile_dir}" -- "{url}"'

    ps_script = """
    $payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
    $WshShell = New-Object -ComObject WScript.Shell
    $Shortcut = $WshShell.CreateShortcut($payload.shortcut_path)
    $Shortcut.TargetPath = $payload.chrome_path
    $Shortcut.Arguments = $payload.arguments
    $Shortcut.Description = 'Abre o navegador da live com depuração ativa para o Tango Live da Odessa'
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

