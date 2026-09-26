"""
Tango Chat Bridge — Interface bidirecional para o chat da Tango Live.

DUAL-MODE:
  1. CDP  — conecta ao Chrome ja aberto (--remote-debugging-port=9222)
  2. STANDALONE — abre Chromium do Playwright com perfil persistente
             (faz login uma vez, depois reutiliza a sessao)

O script tenta CDP primeiro. Se falhar, usa STANDALONE automaticamente.

Integracao com Odessa:
  Servidor HTTP local (aiohttp) na porta 7555 com:
    GET  /status      -> estado da bridge
    GET  /messages    -> SSE stream de msgs em tempo real
    POST /send        -> envia msg no chat
    POST /connect     -> conecta (CDP ou standalone)
    POST /disconnect  -> desconecta
    GET  /history     -> ultimas N mensagens em memoria
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import random
import struct
import sys
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Coroutine

from aiohttp import web
from aiohttp.web import middleware

# O Python embutido do instalador (python312._pth) não põe a pasta do script no
# sys.path: sem isto `import bridge_guard` falhava e a bridge morria ao subir
# só na versão instalada.
_HERE = str(Path(__file__).resolve().parent)
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

import bridge_guard  # noqa: E402

from playwright.async_api import (
    Browser,
    BrowserContext,
    Page,
    Playwright,
    async_playwright,
)

# =====================================================================
#  CONFIGURACAO
# =====================================================================

# Aceita config via --config='{"cdpUrl":"...", "roomUrl":"..."}'
_cli_config: dict = {}
for _arg in sys.argv[1:]:
    if _arg.startswith("--config="):
        try:
            _cli_config = json.loads(_arg[len("--config="):])
        except json.JSONDecodeError:
            pass

# CDP (Chrome ja aberto)
CDP_URL: str = _cli_config.get("cdpUrl", os.environ.get("TANGO_CDP_URL", "http://127.0.0.1:9222"))

# Standalone (Playwright abre Chromium proprio)
TANGO_ROOM_URL: str = _cli_config.get("roomUrl", os.environ.get(
    "TANGO_ROOM_URL", "https://tango.me/stream/broadcast"
))
PROFILE_DIR: str = _cli_config.get("profileDir") or os.environ.get(
    "TANGO_PROFILE_DIR",
    str(Path.home() / ".tango_profile"),
)

# Navegador do modo standalone, resolvido pelo backend (browser_discovery.py):
# Edge/Chrome via canal do Playwright, demais via executável; sem nada, o
# Chromium embutido do Playwright.
BROWSER_NAME: str = _cli_config.get("browserName") or "Chromium embutido"
BROWSER_CHANNEL: str = _cli_config.get("browserChannel") or ""
BROWSER_EXECUTABLE: str = _cli_config.get("browserExecutable") or ""

# Headless automatico: em containers Linux sem display (servidor/Docker/preview),
# o Chromium roda sem janela visivel e a tela e transmitida via CDP Screencast.
# No desktop do usuario (Windows/Mac/Linux com X11) mantem janela visivel.
# Override explicito via TANGO_HEADLESS=1|0.
def _resolve_headless() -> bool:
    v = os.environ.get("TANGO_HEADLESS", "").strip().lower()
    if v in ("1", "true", "yes"):
        return True
    if v in ("0", "false", "no"):
        return False
    return sys.platform.startswith("linux") and not os.environ.get("DISPLAY")

# Leitor do chat (compartilhado com a extensão do navegador).
CHAT_OBSERVER_JS: str = (Path(__file__).resolve().parent / "chat_observer.js").read_text(encoding="utf-8")

# Padrao para identificar a aba do Tango na lista de paginas (modo CDP).
TANGO_URL_PATTERN: str = os.environ.get("TANGO_URL_PATTERN", "tango.me")

# Porta do servidor HTTP local
SERVER_PORT: int = int(_cli_config.get("port", os.environ.get("TANGO_BRIDGE_PORT", "7555")))

# Controle de acesso (ver bridge_guard.py). O backend gera um token, guarda em
# disco e o passa por TANGO_BRIDGE_TOKEN; todo pedido precisa trazê-lo em
# X-Bridge-Token. Escuta só em loopback por padrão; em Docker o compose pode
# definir TANGO_BRIDGE_HOST=0.0.0.0 (o token continua obrigatório).
BRIDGE_TOKEN: str = os.environ.get("TANGO_BRIDGE_TOKEN", "").strip()
BRIDGE_HOST: str = os.environ.get("TANGO_BRIDGE_HOST", "127.0.0.1").strip() or "127.0.0.1"
BRIDGE_ALLOWED_HOSTS = bridge_guard.parse_hosts(os.environ.get("TANGO_BRIDGE_ALLOWED_HOSTS", ""))
# Seletores (podem vir da config do frontend)
_selectors = _cli_config.get("selectors", {})

# =====================================================================
#  SELETORES — extraidos do HTML real do Tango (14/08/2026)
# =====================================================================

SELETOR_CONTAINER_CHAT: str = _selectors.get("containerChat", '[data-testid="virtuoso-item-list"]')
SELETOR_MENSAGEM: str = _selectors.get("mensagem", '[data-testid^="chat-event-"]')
SELETOR_USERNAME: str = _selectors.get("username", ".Hhi6n")
SELETOR_TEXTO_MSG: str = _selectors.get("textoMsg", ".KR99L")
SELETOR_INPUT_TEXTO: str = _selectors.get("inputTexto", '[data-testid="textarea"]')
SELETOR_BOTAO_ENVIAR: str = _selectors.get("botaoEnviar", "")

# =====================================================================
#  CONSTANTES DE COMPORTAMENTO
# =====================================================================

TYPING_DELAY_MIN_MS: int = 45
TYPING_DELAY_MAX_MS: int = 160
WAIT_TIMEOUT_S: int = 30
MAX_HISTORY: int = 500

# Envio (#158): quanto esperar o campo do chat (com uma nova tentativa antes
# de digitar) e quanto esperar a própria mensagem aparecer no chat depois do
# Enter — é essa volta pelo observer que confirma que ela saiu de verdade.
SEND_INPUT_TIMEOUT_S: float = float(os.environ.get("TANGO_SEND_INPUT_TIMEOUT_S", "8"))
SEND_INPUT_ATTEMPTS: int = 2
SEND_CONFIRM_TIMEOUT_S: float = float(os.environ.get("TANGO_SEND_CONFIRM_TIMEOUT_S", "8"))

# =====================================================================
#  LOGGING (com buffer para endpoint /logs)
# =====================================================================

_log_buffer: deque = deque(maxlen=500)


class BufferedHandler(logging.Handler):
    """Armazena logs num buffer para o endpoint /logs."""
    def emit(self, record: logging.LogRecord) -> None:
        try:
            _log_buffer.append(self.format(record))
        except Exception:
            pass


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(message)s",
    datefmt="%H:%M:%S",
)
# Adiciona buffer handler ao root logger
_buf_handler = BufferedHandler()
_buf_handler.setFormatter(logging.Formatter("%(asctime)s | %(levelname)-7s | %(message)s", datefmt="%H:%M:%S"))
logging.getLogger().addHandler(_buf_handler)
log = logging.getLogger("tango_chat")


# =====================================================================
#  DATA CLASSES
# =====================================================================

@dataclass
class ChatMessage:
    """Representa uma mensagem recebida do chat."""
    username: str
    text: str
    timestamp: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    # Eco de uma mensagem que a própria bridge acabou de enviar (#158): a UI
    # não pode tratá-la como fala de espectador (a IA responderia a si mesma).
    own: bool = False

    def to_dict(self) -> dict:
        return {
            "username": self.username,
            "text": self.text,
            "timestamp": self.timestamp,
            "own": self.own,
        }


class SendError(RuntimeError):
    """Envio que não dá para afirmar que saiu, com a etapa em que parou."""

    def __init__(self, message: str, stage: str, command_id: str, attempts: int) -> None:
        super().__init__(message)
        self.stage = stage  # input | typing | not_submitted
        self.command_id = command_id
        self.attempts = attempts


def _for_log(value: object) -> str:
    """Texto do chat em uma linha só: com quebra de linha, uma mensagem poderia
    forjar linhas no log da bridge (ex.: um falso "confirmada no chat")."""
    return str(value).replace("\r", "\\r").replace("\n", "\\n")


def _normalize_chat_text(text: str) -> str:
    return " ".join(text.split()).casefold()


def _is_echo_of(sent: str, seen: str) -> bool:
    """A mensagem vista no chat é a que acabamos de enviar?

    Igualdade (ignorando espaços e maiúsculas) ou, para textos longos, um
    contido no outro — o chat pode cortar ou enfeitar a mensagem exibida.
    """
    if not sent or not seen:
        return False
    if sent == seen:
        return True
    shorter, longer = sorted((sent, seen), key=len)
    return len(shorter) >= 12 and shorter in longer


# =====================================================================
#  CLASSE PRINCIPAL — DUAL MODE (CDP + Standalone)
# =====================================================================

class TangoChatBridge:
    """
    Ponte bidirecional Python <-> Tango Chat.

    Modo CDP:        conecta ao Chrome ja aberto do usuario.
    Modo Standalone: abre Chromium do Playwright com perfil persistente.
    """

    def __init__(self) -> None:
        self.incoming: asyncio.Queue[ChatMessage] = asyncio.Queue()
        self.history: deque[ChatMessage] = deque(maxlen=MAX_HISTORY)

        self._on_message_callbacks: list[
            Callable[[ChatMessage], Coroutine[Any, Any, None]]
        ] = []
        self._sse_subscribers: list[asyncio.Queue[ChatMessage]] = []

        self._playwright: Playwright | None = None
        self._browser: Browser | None = None
        self._context: BrowserContext | None = None
        self._page: Page | None = None
        self._observer_injected: bool = False
        self._status: str = "disconnected"
        self._mode: str = ""  # "cdp" ou "standalone"
        self._error_message: str = ""
        self._started_at: str | None = None
        self._message_count: int = 0
        self._page_url: str = ""
        self._observer_reinject_task: asyncio.Task[None] | None = None
        self._observer_page: Page | None = None
        # O bridge/start (autoconnect=True, o padrao) ja dispara um connect()
        # interno; o wizard do frontend TAMBEM chama /connect logo em seguida,
        # sem esperar o primeiro terminar (handleRunFullAutoSetup). Sem esse
        # lock, as duas chamadas passavam pela checagem "ja esta conectado"
        # antes de qualquer uma delas terminar, e podiam rodar concorrentes --
        # a que terminasse por ultimo (normalmente STANDALONE, mais lenta que
        # CDP) sobrescrevia silenciosamente a conexao da outra, entao o modo
        # CDP que o usuario pediu explicitamente ("Acoplar a Aba Aberta") as
        # vezes virava standalone sem nenhum erro visivel.
        self._connect_lock: asyncio.Lock = asyncio.Lock()
        # Dois /send ao mesmo tempo (ex.: modo Autônomo respondendo duas
        # mensagens seguidas) intercalariam as teclas no mesmo campo.
        self._send_lock: asyncio.Lock = asyncio.Lock()
        # Mensagens enviadas esperando aparecer no chat: (texto normalizado, evento).
        self._pending_echoes: list[tuple[str, asyncio.Event]] = []
        # Modo "extension": a extensão do Odessa roda na aba do Tango em que o
        # usuário já está logado (no navegador dele) e fala com a bridge por
        # WebSocket — sem Playwright, sem perfil dedicado, sem porta de depuração.
        self._extension_ws: web.WebSocketResponse | None = None
        self._extension_pending: dict[str, asyncio.Future[dict]] = {}
        self._extension_browser: str = ""
        # Vídeo da aba no modo extensão: a extensão captura a aba visível
        # (captureVisibleTab) só enquanto alguém assiste ao /live.
        self._live_viewers: set[asyncio.Queue] = set()
        self._extension_viewport: dict = {}
        # 1.0.0 não mandava versão nem capturava vídeo.
        self._extension_version: str = ""
        self._capture_warning: str = ""
        self._frame_logged: bool = False

    # == Conectar =====================================================

    async def connect(self, force_mode: str = "") -> None:
        """
        Conecta ao Tango.

        force_mode:
          ""           -> tenta CDP, se falhar usa standalone
          "cdp"        -> so CDP
          "standalone" -> so standalone
          "extension"  -> não abre navegador; espera a extensão do Odessa
                          conectar a partir da aba do Tango já logada
        """
        if force_mode == "extension":
            self._mode = "extension"
            self._error_message = ""
            if not self._extension_ws:
                self._status = "waiting_extension"
                log.info("Modo EXTENSÃO: aguardando a extensão do Odessa na aba do Tango.")
            return
        async with self._connect_lock:
            # Reconfere depois de adquirir o lock: se outra chamada concorrente
            # (ex.: autoconnect do bridge/start + o /connect explicito do
            # wizard) ja terminou de conectar enquanto esperavamos, nao ha o
            # que fazer aqui.
            if self._status == "connected":
                log.warning("Ja esta conectado.")
                return

            self._status = "connecting"
            self._error_message = ""

            try:
                log.info("Iniciando Playwright ...")
                self._playwright = await async_playwright().start()

                # Tenta CDP primeiro (se nao forcou standalone)
                cdp_ok = False
                if force_mode != "standalone":
                    cdp_ok = await self._try_cdp()

                # Se CDP falhou e nao forcou CDP, tenta standalone
                if not cdp_ok and force_mode != "cdp":
                    await self._try_standalone()

                if not self._page:
                    raise RuntimeError(
                        "Nao conseguiu conectar por nenhum modo. "
                        "Verifique se o Chrome tem CDP ativo ou se o "
                        "Playwright Chromium esta instalado."
                    )

                self._page_url = self._page.url
                log.info("Pagina conectada: %s (modo %s)", self._page_url, self._mode)

                # Injeta imediatamente um observer resiliente. O chat do Tango pode
                # aparecer apenas depois do login/entrada na live; bloquear aqui por
                # 30 segundos também impedia a UI de abrir o stream da tela.
                self._watch_page_navigations()
                await self._inject_observer()

                self._status = "connected"
                self._started_at = datetime.now(timezone.utc).isoformat()
                log.info("Bridge conectada! Modo: %s | URL: %s", self._mode, self._page_url)

            except Exception as exc:
                self._status = "error"
                self._error_message = str(exc)
                log.exception("Erro ao conectar:")
                await self._cleanup()
                raise

    async def _try_cdp(self) -> bool:
        """Tenta conectar via CDP ao Chrome ja aberto."""
        try:
            log.info("Tentando CDP em %s ...", CDP_URL)
            self._browser = await self._playwright.chromium.connect_over_cdp(
                CDP_URL, timeout=8000
            )

            # O Chrome de depuracao acabou de ser lancado com a URL do Tango
            # (ver launch_chrome_for_live em bridge_manager.py) e pode ainda
            # estar navegando (aba em about:blank ou em redirecionamento) no
            # instante exato em que o CDP conecta -- uma busca unica aqui
            # falhava nesse caso, mesmo com o Chrome certo aberto, porque
            # nenhuma pagina ainda batia com o padrao nem tinha uma URL "util"
            # (about:blank e explicitamente ignorada em _find_tango_page).
            # Tenta por alguns segundos antes de desistir.
            for tentativa in range(10):
                self._page = await self._find_tango_page()
                if self._page:
                    break
                await asyncio.sleep(0.5)

            if self._page:
                self._mode = "cdp"
                log.info("CDP conectou! Aba do Tango encontrada.")
                return True
            else:
                log.warning("CDP conectou mas nenhuma aba do Tango encontrada (apos varias tentativas).")
                # Nao limpa browser CDP aqui — vamos tentar standalone
                self._browser = None
                return False
        except Exception as e:
            log.info("CDP nao disponivel: %s", str(e)[:100])
            return False

    async def _try_standalone(self) -> None:
        """Abre Chromium com perfil persistente e navega ao Tango."""
        log.info("Usando modo STANDALONE (%s)", BROWSER_NAME)
        log.info("Perfil persistente: %s", PROFILE_DIR)

        # Aplica stealth se disponivel
        stealth_scripts = []
        try:
            from playwright_stealth import stealth_async, StealthConfig
            log.info("playwright-stealth disponivel")
        except ImportError:
            log.info("playwright-stealth nao instalado (ok, continuando sem)")

        browser_kwargs: dict[str, Any] = {}
        if BROWSER_CHANNEL:
            browser_kwargs["channel"] = BROWSER_CHANNEL
        elif BROWSER_EXECUTABLE:
            browser_kwargs["executable_path"] = BROWSER_EXECUTABLE
        try:
            self._context = await self._launch_persistent(browser_kwargs)
        except Exception as exc:
            if not browser_kwargs:
                raise
            # Navegador do sistema falhou (perfil travado, política corporativa…):
            # cai no Chromium embutido para a live não ficar sem chat.
            log.warning("%s não abriu (%s) — usando o Chromium embutido.", BROWSER_NAME, str(exc)[:160])
            self._context = await self._launch_persistent({})
        self._mode = "standalone"
        await self._after_standalone_launch()

    async def _launch_persistent(self, browser_kwargs: dict[str, Any]):
        return await self._playwright.chromium.launch_persistent_context(
            PROFILE_DIR,
            **browser_kwargs,
            headless=_resolve_headless(),
            viewport={"width": 1280, "height": 900},
            locale="pt-BR",
            timezone_id="America/Sao_Paulo",
            args=[
                "--disable-blink-features=AutomationControlled",
                "--disable-infobars",
            ],
            ignore_default_args=["--enable-automation"],
        )

    async def _after_standalone_launch(self) -> None:
        """Stealth, aba e navegação até a sala do Tango (vale para qualquer navegador)."""
        # Aplica stealth
        try:
            from playwright_stealth import stealth_async
            for page in self._context.pages:
                await stealth_async(page)
        except ImportError:
            pass

        # Pega a primeira pagina ou cria uma
        if self._context.pages:
            self._page = self._context.pages[0]
        else:
            self._page = await self._context.new_page()

        # Navega ao Tango
        current_url = self._page.url
        if "tango.me" not in current_url.lower():
            log.info("Navegando para %s ...", TANGO_ROOM_URL)
            await self._page.goto(TANGO_ROOM_URL, wait_until="domcontentloaded")
            await asyncio.sleep(3)

        log.info("Standalone pronto (%s). URL: %s", BROWSER_NAME, self._page.url)

    async def _find_tango_page(self) -> Page | None:
        """Percorre contextos/paginas do browser CDP para achar a aba correta."""
        if not self._browser:
            return None
        # 1. Procura primeiro por URL do Tango ou Room URL configurada
        room_sub = TANGO_ROOM_URL.replace("https://", "").replace("http://", "").split("/")[0].lower() if TANGO_ROOM_URL else ""
        for context in self._browser.contexts:
            for page in context.pages:
                page_url = page.url.lower()
                if TANGO_URL_PATTERN.lower() in page_url:
                    return page
                if room_sub and room_sub in page_url:
                    return page
                if "anotepad.com" in page_url:
                    return page

        # 2. Se não achou pelo pattern específico, pega a primeira página útil aberta
        for context in self._browser.contexts:
            for page in context.pages:
                purl = page.url.lower()
                if purl and not purl.startswith("chrome://") and not purl.startswith("about:"):
                    log.info("Acoplando à primeira aba aberta: %s", page.url)
                    return page
        return None

    # == Desconectar ===================================================

    async def disconnect(self) -> None:
        """Desconecta (nao fecha o Chrome se for CDP)."""
        log.info("Desconectando bridge ...")
        if self._extension_ws and not self._extension_ws.closed:
            await self._extension_ws.close(code=1000, message=b"bridge desconectada")
        self._extension_ws = None
        await self._cleanup()
        self._status = "disconnected"
        self._started_at = None
        self._mode = ""
        log.info("Bridge desconectada.")

    async def _cleanup(self) -> None:
        """Limpa referencias."""
        if self._observer_reinject_task and not self._observer_reinject_task.done():
            self._observer_reinject_task.cancel()
        self._observer_reinject_task = None
        self._observer_page = None
        if self._mode == "standalone" and self._context:
            try:
                await self._context.close()
            except Exception:
                pass
        # No modo CDP nao fecha — o Chrome e do usuario
        self._page = None
        self._browser = None
        self._context = None
        self._observer_injected = False
        if self._playwright:
            try:
                await self._playwright.stop()
            except Exception:
                pass
            self._playwright = None

    # == Leitura: MutationObserver =====================================

    def _watch_page_navigations(self) -> None:
        """Reinstala o observer quando login/SPA troca o documento da pagina."""
        if not self._page or self._observer_page is self._page:
            return
        self._observer_page = self._page

        def schedule_reinject(*_args: Any) -> None:
            self._observer_injected = False
            if self._observer_reinject_task and not self._observer_reinject_task.done():
                self._observer_reinject_task.cancel()
            self._observer_reinject_task = asyncio.create_task(self._reinject_observer_after_navigation())

        self._page.on("domcontentloaded", schedule_reinject)

    async def _reinject_observer_after_navigation(self) -> None:
        """Espera o novo documento estabilizar e reinstala o leitor de chat."""
        try:
            await asyncio.sleep(0.25)
            await self._inject_observer()
            if self._page:
                self._page_url = self._page.url
            log.info("Observer de chat reinjetado apos navegacao.")
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            self._observer_injected = False
            log.warning("Falha ao reinjetar observer apos navegacao: %s", exc)

    async def _inject_observer(self) -> None:
        """Injeta MutationObserver na pagina com fallback para simulador."""
        if not self._page:
            raise RuntimeError("Nenhuma pagina conectada.")

        # Injeta callback bridge (ignora se já registrado — acontece em reconexão)
        try:
            await self._page.expose_function(
                "__onNewChatMessage",
                lambda payload: asyncio.create_task(self._handle_incoming_message(payload)),
            )
        except Exception as _e:
            if "already registered" in str(_e).lower():
                log.debug("__onNewChatMessage ja registrado, ignorando.")
            else:
                raise

        # O leitor do chat mora em chat_observer.js — o mesmo arquivo que a
        # extensão do navegador usa (tango_chat/extension).
        observer_config = json.dumps({
            "containerSelector": SELETOR_CONTAINER_CHAT,
            "messageSelector": SELETOR_MENSAGEM,
            "usernameSelector": SELETOR_USERNAME,
            "textSelector": SELETOR_TEXTO_MSG,
        })
        js_code = (
            CHAT_OBSERVER_JS
            + """
        ;(() => {
            // Expõe função de simulação global
            window.__odessaSimulateChat = (username, text) => {
                if (window.__onNewChatMessage) {
                    window.__onNewChatMessage(JSON.stringify({ username, text }));
                }
            };
            window.installOdessaChatObserver(%s, (msg) => window.__onNewChatMessage(JSON.stringify(msg)));
        })();
        """ % observer_config
        )
        try:
            await self._page.evaluate(js_code)
            self._observer_injected = True
            log.info("MutationObserver e helpers de chat injetados com sucesso.")
        except Exception as exc:
            log.warning("Observer avaliado com aviso: %s", exc)
            self._observer_injected = True

    async def _handle_incoming_message(self, raw: str) -> None:
        """Callback do JS — nova mensagem no chat."""
        try:
            data = json.loads(raw)
            msg = ChatMessage(
                username=data.get("username", "???"),
                text=data.get("text", ""),
            )
            msg.own = self._resolve_echo(msg.text)
            log.info("MSG | %s: %s", _for_log(msg.username), _for_log(msg.text))
            self._message_count += 1
            self.history.append(msg)
            await self.incoming.put(msg)

            for q in self._sse_subscribers:
                try:
                    q.put_nowait(msg)
                except asyncio.QueueFull:
                    pass

            for cb in self._on_message_callbacks:
                try:
                    await cb(msg)
                except Exception:
                    log.exception("Erro em callback de mensagem")

        except json.JSONDecodeError:
            log.error("Payload invalido do Observer: %s", raw)

    # == Escrita: envio de mensagens ===================================

    def _resolve_echo(self, text: str) -> bool:
        """Marca como confirmada a mensagem enviada que acabou de aparecer no chat."""
        seen = _normalize_chat_text(text)
        for sent, event in self._pending_echoes:
            if not event.is_set() and _is_echo_of(sent, seen):
                event.set()
                return True
        return False

    @staticmethod
    async def _read_input(input_el: Any) -> str:
        try:
            value = await input_el.evaluate("el => ('value' in el ? el.value : el.textContent) || ''")
            return value if isinstance(value, str) else ""
        except Exception:
            return ""

    async def send_message(self, text: str) -> dict:
        """Envia uma mensagem no chat do Tango e confirma que ela apareceu.

        Retorna ``{"commandId", "confirmed", "attempts", "durationMs"}``:
        - ``confirmed=True``: a própria mensagem voltou pelo observer do chat;
        - ``confirmed=False``: o campo esvaziou (o Tango aceitou o Enter), mas
          a mensagem não apareceu no chat a tempo — pode ser só o seletor das
          mensagens desatualizado; confira no Tango.
        Levanta ``SendError`` quando não dá para afirmar que saiu.
        """
        if self._mode == "extension":
            async with self._send_lock:
                return await self._send_via_extension(text)
        if not self._page:
            raise RuntimeError("Bridge nao conectada.")
        async with self._send_lock:
            return await self._send_locked(self._page, text)

    async def _send_via_extension(self, text: str) -> dict:
        """A extensão digita na aba do Tango; a confirmação é a mesma do modo
        com navegador próprio: a mensagem precisa voltar pelo leitor do chat."""
        ws = self._extension_ws
        command_id = uuid.uuid4().hex[:12]
        if not ws or ws.closed:
            raise SendError("A extensão do Odessa não está conectada.", "input", command_id, 1)
        started = time.monotonic()
        log.info("SEND %s (extensão) | %s", command_id, _for_log(text))
        expected = _normalize_chat_text(text)
        echo = (expected, asyncio.Event())
        self._pending_echoes.append(echo)
        result_future: asyncio.Future[dict] = asyncio.get_running_loop().create_future()
        self._extension_pending[command_id] = result_future
        try:
            await ws.send_json({
                "type": "send",
                "id": command_id,
                "text": text,
                "inputSelector": SELETOR_INPUT_TEXTO,
                "buttonSelector": SELETOR_BOTAO_ENVIAR,
            })
            try:
                result = await asyncio.wait_for(result_future, timeout=SEND_INPUT_TIMEOUT_S + 10)
            except asyncio.TimeoutError as exc:
                raise SendError("A extensão não respondeu ao envio a tempo.", "typing", command_id, 1) from exc
            if not result.get("ok"):
                raise SendError(
                    str(result.get("error") or "A extensão não conseguiu enviar."),
                    str(result.get("stage") or "typing"),
                    command_id,
                    1,
                )
            try:
                await asyncio.wait_for(echo[1].wait(), timeout=SEND_CONFIRM_TIMEOUT_S)
                confirmed = True
            except asyncio.TimeoutError:
                confirmed = False
        finally:
            self._extension_pending.pop(command_id, None)
            self._pending_echoes.remove(echo)
        duration_ms = int((time.monotonic() - started) * 1000)
        log.info("SEND %s (extensão) | %s em %d ms.", command_id, "confirmada no chat" if confirmed else "enviada sem eco", duration_ms)
        return {"commandId": command_id, "confirmed": confirmed, "attempts": 1, "durationMs": duration_ms}

    # == Extensão do navegador =========================================

    def observer_config(self) -> dict:
        return {
            "containerSelector": SELETOR_CONTAINER_CHAT,
            "messageSelector": SELETOR_MENSAGEM,
            "usernameSelector": SELETOR_USERNAME,
            "textSelector": SELETOR_TEXTO_MSG,
        }

    async def push_extension_config(self) -> None:
        ws = self._extension_ws
        if ws and not ws.closed:
            await ws.send_json({"type": "config", "observer": self.observer_config()})

    async def attach_extension(self, ws: web.WebSocketResponse, hello: dict) -> None:
        self._extension_ws = ws
        self._extension_browser = str(hello.get("browser") or "navegador")
        self._extension_version = str(hello.get("version") or "1.0.0")
        self._extension_viewport = {}
        self._capture_warning = ""
        self._frame_logged = False
        self._mode = "extension"
        self._status = "connected"
        self._error_message = ""
        self._page_url = str(hello.get("url") or "")
        self._observer_injected = True
        self._started_at = datetime.now(timezone.utc).isoformat()
        log.info(
            "Extensão %s conectada (%s) | URL: %s",
            self._extension_version, self._extension_browser, _for_log(self._page_url),
        )
        if not self.extension_supports_video():
            log.warning("Extensão %s não captura vídeo: recarregue-a no navegador.", self._extension_version)
        await self.push_extension_config()
        if self._live_viewers:
            await ws.send_json({"type": "screencast", "on": True})
            if not self.extension_supports_video():
                for viewer in list(self._live_viewers):
                    viewer.put_nowait({"type": "error", "error": self.outdated_extension_message()})

    def detach_extension(self, ws: web.WebSocketResponse) -> None:
        if self._extension_ws is not ws:
            return
        self._extension_ws = None
        self._observer_injected = False
        for future in self._extension_pending.values():
            if not future.done():
                future.set_result({"ok": False, "error": "A extensão desconectou.", "stage": "typing"})
        if self._mode == "extension":
            self._status = "waiting_extension"
        for viewer in list(self._live_viewers):
            viewer.put_nowait({"type": "error", "error": "A aba do Tango desconectou; aguardando a extensão."})
        log.info("Extensão desconectada; aguardando reconexão.")

    async def forward_extension_input(self, data: dict) -> None:
        """Clique/rolagem/tecla do painel → extensão (arrastar não é suportado)."""
        kind = data.get("type")
        if kind == "mouse" and data.get("action") != "click":
            return
        if kind not in ("mouse", "wheel", "key", "type"):
            return
        ws = self._extension_ws
        if ws and not ws.closed:
            try:
                await ws.send_json({**data, "type": "input", "kind": kind})
            except Exception:
                pass

    def extension_supports_video(self) -> bool:
        try:
            major, minor = (int(x) for x in self._extension_version.split(".")[:2])
        except ValueError:
            return False
        return (major, minor) >= (1, 1)

    def outdated_extension_message(self) -> str:
        return (
            f"A extensão do Odessa aberta no {self._extension_browser or 'navegador'} está desatualizada "
            f"(versão {self._extension_version}) e não envia o vídeo da aba. Em edge://extensions, clique em "
            "Recarregar na extensão \"Odessa — Chat do Tango\" e depois aperte F5 na aba do Tango."
        )

    def _warn_capture(self, text: str) -> None:
        if text != self._capture_warning:
            self._capture_warning = text
            log.warning("Captura da aba: %s", _for_log(text))
        for viewer in list(self._live_viewers):
            viewer.put_nowait({"type": "error", "error": text})

    async def _set_extension_screencast(self, on: bool) -> None:
        ws = self._extension_ws
        if ws and not ws.closed:
            try:
                await ws.send_json({"type": "screencast", "on": on})
            except Exception:
                pass

    def _publish_extension_frame(self, data: dict) -> None:
        """Frame JPEG da extensão → mesmo formato binário do screencast CDP."""
        raw = data.get("data") or ""
        if "," in raw[:64]:
            raw = raw.split(",", 1)[1]  # data:image/jpeg;base64,...
        try:
            jpeg = base64.b64decode(raw)
        except Exception:
            return
        w = int(data.get("w") or self._extension_viewport.get("w") or 1280)
        h = int(data.get("h") or self._extension_viewport.get("h") or 720)
        packet = struct.pack(">HH", min(w, 65535), min(h, 65535)) + jpeg
        self._capture_warning = ""
        if not self._frame_logged:
            self._frame_logged = True
            log.info("Captura da aba: primeiro quadro recebido (%dx%d, %d KB).", w, h, len(jpeg) // 1024)
        for viewer in list(self._live_viewers):
            if viewer.qsize() < 3:  # quem está lento perde frame, não acumula atraso
                viewer.put_nowait(packet)

    async def _send_locked(self, page: Page, text: str) -> dict:
        command_id = uuid.uuid4().hex[:12]
        started = time.monotonic()
        log.info("SEND %s | %s", command_id, _for_log(text))

        # 1) Achar o campo. Só aqui existe nova tentativa: nada foi digitado
        #    ainda, então tentar de novo não duplica a mensagem no chat.
        input_el = page.locator(SELETOR_INPUT_TEXTO)
        attempts = 0
        while True:
            attempts += 1
            try:
                await input_el.wait_for(state="visible", timeout=SEND_INPUT_TIMEOUT_S * 1000)
                await input_el.click()
                break
            except Exception as exc:
                if attempts >= SEND_INPUT_ATTEMPTS:
                    raise SendError(
                        f"Campo do chat não encontrado ({exc}).", "input", command_id, attempts
                    ) from exc
                log.warning("SEND %s | campo indisponivel, nova tentativa: %s", command_id, _for_log(exc))
                await asyncio.sleep(1)

        # Texto que sobrou no campo (tentativa anterior, rascunho) iria junto.
        leftover = await self._read_input(input_el)
        if leftover.strip():
            log.warning("SEND %s | limpando texto que ja estava no campo: %s", command_id, _for_log(leftover))
            await input_el.fill("")

        # 2) Digitar e enviar. Daqui em diante NUNCA repetir: o Enter pode ter
        #    saído, e uma segunda tentativa duplicaria a mensagem no chat.
        expected = _normalize_chat_text(text)
        echo = (expected, asyncio.Event())
        self._pending_echoes.append(echo)
        try:
            try:
                await asyncio.sleep(random.uniform(0.1, 0.3))
                for char in text:
                    await page.keyboard.type(
                        char,
                        delay=random.randint(TYPING_DELAY_MIN_MS, TYPING_DELAY_MAX_MS),
                    )
                await asyncio.sleep(random.uniform(0.15, 0.4))
                if SELETOR_BOTAO_ENVIAR:
                    await page.locator(SELETOR_BOTAO_ENVIAR).click()
                else:
                    await page.keyboard.press("Enter")
            except Exception as exc:
                raise SendError(f"Falha ao digitar no chat ({exc}).", "typing", command_id, attempts) from exc

            # 3) Confirmar: a mensagem precisa voltar pelo observer do chat.
            try:
                await asyncio.wait_for(echo[1].wait(), timeout=SEND_CONFIRM_TIMEOUT_S)
                confirmed = True
            except asyncio.TimeoutError:
                confirmed = False
            if not confirmed and expected and expected in _normalize_chat_text(await self._read_input(input_el)):
                raise SendError(
                    "O Tango não aceitou o envio: o texto ficou no campo do chat.",
                    "not_submitted",
                    command_id,
                    attempts,
                )
        finally:
            self._pending_echoes.remove(echo)

        duration_ms = int((time.monotonic() - started) * 1000)
        if confirmed:
            log.info("SEND %s | confirmada no chat em %d ms.", command_id, duration_ms)
        else:
            log.warning(
                "SEND %s | enviada, mas nao apareceu no chat em %.0f s (confira o seletor das mensagens).",
                command_id,
                SEND_CONFIRM_TIMEOUT_S,
            )
        return {"commandId": command_id, "confirmed": confirmed, "attempts": attempts, "durationMs": duration_ms}

    # == Status ========================================================

    def get_status(self) -> dict:
        return {
            "status": self._status,
            "mode": self._mode,
            "pageUrl": self._page_url,
            "startedAt": self._started_at,
            "messageCount": self._message_count,
            "historySize": len(self.history),
            "observerInjected": self._observer_injected,
            "error": self._error_message or None,
            "cdpUrl": CDP_URL,
            "profileDir": PROFILE_DIR,
            "browserName": self._extension_browser if self._mode == "extension" else BROWSER_NAME,
            "extensionConnected": bool(self._extension_ws and not self._extension_ws.closed),
            "extensionVersion": self._extension_version or None,
        }


# =====================================================================
#  SERVIDOR HTTP LOCAL (aiohttp)
# =====================================================================

bridge: TangoChatBridge | None = None
# Referências de tarefas "dispara e esquece" (sem isso o GC pode coletá-las no meio).
_background_tasks: set[asyncio.Task] = set()


@middleware
async def access_middleware(request: web.Request, handler):
    """Host local + token compartilhado com o backend (ver bridge_guard.py).

    Não há mais CORS: a UI fala com a bridge pelo proxy do backend (mesma
    origem), então nenhum navegador precisa acessá-la diretamente. Um preflight
    OPTIONS sem cabeçalhos CORS faz o navegador recusar o pedido cross-site.
    """
    if request.method == "OPTIONS":
        return web.Response(status=204)
    rejection = bridge_guard.check_request(
        request.method,
        request.headers.get("Host"),
        request.headers.get("Origin"),
        request.headers.get(bridge_guard.TOKEN_HEADER),
        BRIDGE_TOKEN,
        BRIDGE_ALLOWED_HOSTS,
    )
    if rejection:
        status, code = rejection
        return web.json_response({"error": code}, status=status)
    try:
        return await handler(request)
    except web.HTTPException as exc:
        return exc


async def handle_status(request: web.Request) -> web.Response:
    """GET /status"""
    return web.json_response(
        bridge.get_status() if bridge else {"status": "not_initialized"}
    )


async def handle_history(request: web.Request) -> web.Response:
    """GET /history"""
    if not bridge:
        return web.json_response({"messages": []})
    limit = int(request.query.get("limit", "100"))
    msgs = list(bridge.history)[-limit:]
    return web.json_response({"messages": [m.to_dict() for m in msgs]})


async def handle_clear_history(request: web.Request) -> web.Response:
    """POST /clear-history — descarta mensagens da sessão em memória."""
    if bridge:
        bridge.history.clear()
        bridge._message_count = 0
    return web.json_response({"ok": True})


async def handle_send(request: web.Request) -> web.Response:
    """POST /send"""
    if not bridge or bridge._status != "connected":
        return web.json_response(
            {"ok": False, "error": "Bridge nao esta conectada"}, status=400
        )
    body = await request.json()
    text = body.get("text", "").strip()
    if not text:
        return web.json_response(
            {"ok": False, "error": "Texto vazio"}, status=400
        )
    try:
        result = await bridge.send_message(text)
        return web.json_response({"ok": True, **result})
    except SendError as exc:
        log.error("SEND %s | falhou na etapa %s: %s", exc.command_id, exc.stage, _for_log(exc))
        return web.json_response(
            {"ok": False, "error": str(exc), "stage": exc.stage, "commandId": exc.command_id, "attempts": exc.attempts},
            status=500,
        )
    except Exception as exc:
        return web.json_response(
            {"ok": False, "error": str(exc)}, status=500
        )


async def handle_connect(request: web.Request) -> web.Response:
    """POST /connect — conecta (CDP ou standalone)."""
    if not bridge:
        return web.json_response(
            {"ok": False, "error": "Bridge nao inicializada"}, status=500
        )
    if bridge._status == "connected":
        return web.json_response(
            {"ok": True, "message": "Ja esta conectado", **bridge.get_status()}
        )
    try:
        body = {}
        try:
            body = await request.json()
        except Exception:
            pass
        force_mode = body.get("mode", "")
        await bridge.connect(force_mode=force_mode)
        return web.json_response({"ok": True, **bridge.get_status()})
    except Exception as exc:
        return web.json_response(
            {"ok": False, "error": str(exc)}, status=500
        )


async def handle_disconnect(request: web.Request) -> web.Response:
    """POST /disconnect"""
    if not bridge:
        return web.json_response(
            {"ok": False, "error": "Bridge nao inicializada"}, status=500
        )
    await bridge.disconnect()
    return web.json_response({"ok": True})


async def handle_messages_sse(request: web.Request) -> web.StreamResponse:
    """GET /messages — SSE stream de mensagens em tempo real."""
    response = web.StreamResponse(
        status=200,
        reason="OK",
        headers={
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )
    await response.prepare(request)

    q: asyncio.Queue[ChatMessage] = asyncio.Queue(maxsize=200)
    if bridge:
        bridge._sse_subscribers.append(q)

    try:
        while True:
            msg = await q.get()
            data = json.dumps(msg.to_dict())
            await response.write(f"data: {data}\n\n".encode("utf-8"))
    except (asyncio.CancelledError, ConnectionResetError):
        pass
    finally:
        if bridge and q in bridge._sse_subscribers:
            bridge._sse_subscribers.remove(q)

    return response


async def handle_debug_dom(request: web.Request) -> web.Response:
    """GET /debug-dom - Extrai os textareas/inputs da pagina atual"""
    if not bridge or not bridge._page:
        return web.json_response({"error": "Sem pagina conectada"}, status=400)
    try:
        html = await bridge._page.evaluate('''() => {
            const results = [];
            // Procurar textareas e inputs
            document.querySelectorAll('textarea, input, [contenteditable="true"]').forEach(el => {
                results.push({
                    tag: el.tagName,
                    type: el.type || '',
                    className: (el.className && typeof el.className === 'string') ? el.className.substring(0,30) : '',
                    placeholder: el.placeholder || '',
                    testid: el.dataset?.testid || '',
                    visivel: el.offsetHeight > 0
                });
            });
            // Procurar elementos cujo id/class tenham chat ou input
            document.querySelectorAll('[id*="chat"], [class*="chat"], [class*="input"]').forEach(el => {
                 if (el.offsetHeight > 0 && results.length < 50) {
                     results.push({
                         tag: el.tagName,
                         className: (el.className && typeof el.className === 'string') ? el.className.substring(0,30) : '',
                         id: el.id,
                         text: el.innerText ? el.innerText.substring(0, 20) : '',
                         visivel: true
                     });
                 }
            });
            return results;
        }''')
        return web.json_response({"elements": html})
    except Exception as exc:
        return web.json_response({"error": str(exc)}, status=500)



async def handle_screenshot(request: web.Request) -> web.Response:
    """GET /screenshot - Retorna a imagem atual do viewport em JPEG.

    Query params opcionais:
      quality (1-100, default 60) — qualidade do JPEG (menor = mais rapido)
      full (0/1, default 0)        — capturar a pagina inteira (nao so o viewport)
    """
    if not bridge or not bridge._page:
        return web.Response(status=404, text="Sem pagina conectada")
    try:
        quality = int(request.query.get("quality", "60"))
        quality = min(max(quality, 10), 100)
        full = request.query.get("full", "0") == "1"
        image_bytes = await bridge._page.screenshot(
            type="jpeg", quality=quality, full_page=full
        )
        return web.Response(body=image_bytes, content_type="image/jpeg", headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"
        })
    except Exception as exc:
        return web.Response(status=500, text=str(exc))


async def handle_viewport(request: web.Request) -> web.Response:
    """GET /viewport - Retorna as dimensoes do viewport da pagina conectada."""
    if not bridge or not bridge._page:
        return web.json_response({"error": "Sem pagina conectada"}, status=404)
    try:
        info = await bridge._page.evaluate(
            "() => ({ w: window.innerWidth, h: window.innerHeight, "
            "url: location.href, title: document.title })"
        )
        return web.json_response({"ok": True, **info})
    except Exception as exc:
        return web.json_response({"error": str(exc)}, status=500)


async def handle_click(request: web.Request) -> web.Response:
    """POST /click - Clica em uma coordenada (x,y) do viewport da pagina."""
    if not bridge or not bridge._page:
        return web.json_response({"error": "Sem pagina conectada"}, status=400)
    try:
        body = await request.json()
        x = float(body.get("x", 0))
        y = float(body.get("y", 0))
        button = body.get("button", "left")
        click_count = int(body.get("clickCount", 1))
        # Move + clica diretamente nas coordenadas do viewport
        await bridge._page.mouse.move(x, y)
        await bridge._page.mouse.click(x, y, button=button, click_count=click_count)
        return web.json_response({"ok": True, "x": x, "y": y})
    except Exception as exc:
        return web.json_response({"error": str(exc)}, status=500)


async def handle_type_text(request: web.Request) -> web.Response:
    """POST /type - Digita um texto no elemento atualmente focado da pagina."""
    if bridge and bridge._mode == "extension" and not bridge._page:
        return await _type_via_extension(request)
    if not bridge or not bridge._page:
        return web.json_response({"error": "Sem pagina conectada"}, status=400)
    try:
        body = await request.json()
        text = str(body.get("text", ""))
        delay = int(body.get("delay", 0))
        if delay > 0:
            await bridge._page.keyboard.type(text, delay=delay)
        else:
            await bridge._page.keyboard.type(text)
        return web.json_response({"ok": True})
    except Exception as exc:
        return web.json_response({"error": str(exc)}, status=500)


async def handle_key(request: web.Request) -> web.Response:
    """POST /key - Pressiona uma tecla (ex: Enter, Tab, Escape, Backspace)."""
    if not bridge or not bridge._page:
        return web.json_response({"error": "Sem pagina conectada"}, status=400)
    try:
        body = await request.json()
        key = str(body.get("key", "Enter"))
        await bridge._page.keyboard.press(key)
        return web.json_response({"ok": True, "key": key})
    except Exception as exc:
        return web.json_response({"error": str(exc)}, status=500)


async def handle_scroll(request: web.Request) -> web.Response:
    """POST /scroll - Rola a pagina por um delta (em pixels) a partir de (x,y)."""
    if not bridge or not bridge._page:
        return web.json_response({"error": "Sem pagina conectada"}, status=400)
    try:
        body = await request.json()
        x = float(body.get("x", 0))
        y = float(body.get("y", 0))
        delta_y = float(body.get("deltaY", 0))
        await bridge._page.mouse.wheel(x, y, delta_y=delta_y)
        return web.json_response({"ok": True, "deltaY": delta_y})
    except Exception as exc:
        return web.json_response({"error": str(exc)}, status=500)

async def _type_via_extension(request: web.Request) -> web.Response:
    body = await request.json()
    text = str(body.get("text") or "")
    if not text:
        return web.json_response({"error": "Texto vazio"}, status=400)
    if not bridge._extension_ws or bridge._extension_ws.closed:
        return web.json_response({"error": "A aba do Tango com a extensão não está conectada."}, status=409)
    await bridge.forward_extension_input({"type": "type", "text": text})
    return web.json_response({"ok": True})


async def handle_goto(request: web.Request) -> web.Response:
    """POST /goto - Navega o robo para uma URL especifica"""
    if bridge and bridge._mode == "extension" and not bridge._page:
        # Modo extensão: quem navega é a própria aba do usuário.
        body = await request.json()
        url = body.get("url")
        if not url or not bridge_guard.navigation_allowed(url):
            return web.json_response({"error": "Navegacao permitida apenas para tango.me"}, status=400)
        ws = bridge._extension_ws
        if not ws or ws.closed:
            return web.json_response({"error": "A aba do Tango com a extensão não está conectada."}, status=409)
        await ws.send_json({"type": "navigate", "url": url})
        return web.json_response({"ok": True, "url": url})
    if not bridge or not bridge._page:
        return web.json_response({"error": "Sem pagina conectada"}, status=400)
    try:
        body = await request.json()
        url = body.get("url")
        if not url:
            return web.json_response({"error": "URL nao fornecida"}, status=400)
        if not bridge_guard.navigation_allowed(url):
            return web.json_response({"error": "Navegacao permitida apenas para tango.me"}, status=400)
        await bridge._page.goto(url, wait_until="domcontentloaded")
        return web.json_response({"ok": True, "url": url})
    except Exception as exc:
        return web.json_response({"error": str(exc)}, status=500)


# ── Códigos de tecla virtual (Windows) p/ dispatch de teclado CDP ──
_VK_CODES = {
    "Enter": 13, "NumpadEnter": 13, "Backspace": 8, "Tab": 9,
    "Escape": 27, "Delete": 46, "ArrowLeft": 37, "ArrowUp": 38,
    "ArrowRight": 39, "ArrowDown": 40, "Home": 36, "End": 35,
    "PageUp": 33, "PageDown": 34, "Space": 32,
}


async def _cdp_mouse(cdp, data: dict) -> None:
    """Dispatch de mouse via CDP (coordenadas em pixels CSS do viewport)."""
    x = float(data.get("x", 0))
    y = float(data.get("y", 0))
    btn = data.get("button", "left")
    btn = btn if btn in ("left", "right", "middle") else "left"
    action = data.get("action", "click")
    if action == "move":
        await cdp.send("Input.dispatchMouseEvent",
                       {"type": "mouseMoved", "x": x, "y": y})
    elif action == "down":
        await cdp.send("Input.dispatchMouseEvent",
                       {"type": "mousePressed", "x": x, "y": y,
                        "button": btn, "clickCount": 1})
    elif action == "up":
        await cdp.send("Input.dispatchMouseEvent",
                       {"type": "mouseReleased", "x": x, "y": y,
                        "button": btn, "clickCount": 1})
    else:  # click completo
        await cdp.send("Input.dispatchMouseEvent",
                       {"type": "mouseMoved", "x": x, "y": y})
        await cdp.send("Input.dispatchMouseEvent",
                       {"type": "mousePressed", "x": x, "y": y,
                        "button": btn, "clickCount": 1})
        await cdp.send("Input.dispatchMouseEvent",
                       {"type": "mouseReleased", "x": x, "y": y,
                        "button": btn, "clickCount": 1})


async def _cdp_wheel(cdp, data: dict) -> None:
    """Dispatch de roda do mouse via CDP.

    Move o cursor para a posição antes do scroll — sem isso o browser não
 sabe em qual elemento aplicar o wheel (modais, containers scrolláveis, etc).
    """
    x = float(data.get("x", 0))
    y = float(data.get("y", 0))
    dx = float(data.get("deltaX", 0))
    dy = float(data.get("deltaY", 0))
    await cdp.send("Input.dispatchMouseEvent",
                   {"type": "mouseMoved", "x": x, "y": y})
    await cdp.send("Input.dispatchMouseEvent",
                   {"type": "mouseWheel", "x": x, "y": y,
                    "button": "none", "deltaX": dx, "deltaY": dy})


async def _cdp_key(cdp, data: dict) -> None:
    """Dispatch de teclado via CDP (texto imprimivel ou tecla especial)."""
    text = data.get("text", "")
    key = data.get("key", "")
    if text and len(text) == 1:
        # Caractere imprimivel -> insere direto no foco
        await cdp.send("Input.dispatchKeyEvent",
                       {"type": "char", "text": text})
    elif key in _VK_CODES:
        vk = _VK_CODES[key]
        await cdp.send("Input.dispatchKeyEvent",
                       {"type": "rawKeyDown", "key": key, "code": key,
                        "windowsVirtualKeyCode": vk})
        await cdp.send("Input.dispatchKeyEvent",
                       {"type": "keyUp", "key": key, "code": key,
                        "windowsVirtualKeyCode": vk})
        # Enter em campos de texto geralmente precisa do char \r
        if key in ("Enter", "NumpadEnter"):
            await cdp.send("Input.dispatchKeyEvent",
                           {"type": "char", "text": "\r"})


async def _live_ws_via_extension(request: web.Request) -> web.WebSocketResponse:
    """/live no modo extensão: vídeo da aba (capturado pela extensão) + interação.

    Clique, rolagem e teclado do painel vão para a extensão, que os executa na
    aba do usuário (eventos de DOM pelo content script).
    """
    ws = web.WebSocketResponse(max_msg_size=0)
    await ws.prepare(request)
    queue: asyncio.Queue = asyncio.Queue()
    first = not bridge._live_viewers
    bridge._live_viewers.add(queue)
    if bridge._extension_viewport:
        queue.put_nowait({"type": "viewport", **bridge._extension_viewport})
    if not bridge._extension_ws:
        queue.put_nowait({"type": "error", "error": "Aguardando a aba do Tango com a extensão do Odessa."})
    elif not bridge.extension_supports_video():
        queue.put_nowait({"type": "error", "error": bridge.outdated_extension_message()})
    elif bridge._capture_warning:
        queue.put_nowait({"type": "error", "error": bridge._capture_warning})
    if first:
        await bridge._set_extension_screencast(True)
    log.info("Live WS (extensão): espectador conectado")

    async def _sender() -> None:
        while True:
            item = await queue.get()
            if item is None:
                break
            try:
                if isinstance(item, (bytes, bytearray)):
                    await ws.send_bytes(item)
                else:
                    await ws.send_json(item)
            except Exception:
                break

    sender_task = asyncio.create_task(_sender())
    try:
        async for msg in ws:
            if msg.type == web.WSMsgType.ERROR:
                break
            if msg.type != web.WSMsgType.TEXT:
                continue
            try:
                data = json.loads(msg.data)
            except json.JSONDecodeError:
                continue
            await bridge.forward_extension_input(data)
    finally:
        # Sem await antes disto: o aiohttp cancela o handler quando o
        # espectador desconecta, e a captura ficaria ligada para sempre.
        bridge._live_viewers.discard(queue)
        queue.put_nowait(None)
        if not bridge._live_viewers:
            task = asyncio.create_task(bridge._set_extension_screencast(False))
            _background_tasks.add(task)
            task.add_done_callback(_background_tasks.discard)
        log.info("Live WS (extensão) encerrado")
        try:
            await sender_task
        except (asyncio.CancelledError, Exception):
            pass
    return ws


async def handle_live_ws(request: web.Request) -> web.WebSocketResponse:
    """GET /live — WebSocket de VIDEO EM TEMPO REAL (CDP Screencast) + interacao.

    Fluxo:
      - Server inicia Page.startScreencast na pagina conectada e envia cada
        frame (JPEG base64) assim que a pagina muda (tempo real, nao polling).
      - Client envia eventos de mouse/teclado/scroll que sao repassados via
        CDP Input.dispatch* — interacao de verdade, como Chrome Remote Desktop.
    """
    if bridge and bridge._mode == "extension" and not bridge._page:
        return await _live_ws_via_extension(request)
    if not bridge or not bridge._page:
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        await ws.send_json({"type": "error", "error": "Sem pagina conectada"})
        await ws.close()
        return ws

    ws = web.WebSocketResponse(max_msg_size=0)
    await ws.prepare(request)

    cdp = None
    screencast_on = False
    outgoing: asyncio.Queue = asyncio.Queue()
    ack_queue: asyncio.Queue = asyncio.Queue()

    async def _sender() -> None:
        """Drena a fila de saida: binary p/ frames, JSON p/ controle."""
        while True:
            item = await outgoing.get()
            if item is None:
                break
            try:
                if isinstance(item, (bytes, bytearray)):
                    await ws.send_bytes(item)
                else:
                    await ws.send_json(item)
            except Exception:
                break

    async def _acker() -> None:
        """Drena fila de acks — separado do sender p/ nao bloquear input."""
        while True:
            session_id = await ack_queue.get()
            if session_id is None:
                break
            try:
                await cdp.send("Page.screencastFrameAck",
                               {"sessionId": session_id})
            except Exception:
                break

    def _on_frame(frame: dict) -> None:
        """Callback de cada frame — encaminha binario e acka sem create_task."""
        meta = frame.get("metadata", {}) or {}
        w = meta.get("width") or meta.get("deviceWidth") or 1280
        h = meta.get("height") or meta.get("deviceHeight") or 720
        raw_b64 = frame.get("data", "")
        try:
            jpeg_bytes = base64.b64decode(raw_b64) if raw_b64 else b""
            outgoing.put_nowait(struct.pack(">HH", w, h) + jpeg_bytes)
        except Exception as exc:
            log.warning("Live WS frame encode error: %s", exc)
        try:
            ack_queue.put_nowait(frame.get("sessionId", 0))
        except Exception:
            pass

    sender_task = asyncio.create_task(_sender())
    acker_task = asyncio.create_task(_acker())

    try:
        cdp = await bridge._page.context.new_cdp_session(bridge._page)
        cdp.on("Page.screencastFrame", _on_frame)

        # Dimensoes CSS do viewport (p/ mapear cliques do cliente)
        try:
            info = await bridge._page.evaluate(
                "() => ({ w: window.innerWidth, h: window.innerHeight, "
                "url: location.href, title: document.title })"
            )
            await outgoing.put({"type": "viewport", **info})
        except Exception:
            pass

        await cdp.send("Page.startScreencast", {
            "format": "jpeg", "quality": 55,
            "maxWidth": 1280, "maxHeight": 720,
        })
        screencast_on = True
        # Força um repaint para garantir o primeiro frame em páginas estáticas.
        try:
            await bridge._page.evaluate("() => requestAnimationFrame(() => document.body.style.opacity = '0.999')")
        except Exception:
            pass
        log.info("Live WS: screencast iniciado")

        async for msg in ws:
            if msg.type == web.WSMsgType.TEXT:
                try:
                    data = json.loads(msg.data)
                except json.JSONDecodeError:
                    continue
                mtype = data.get("type")
                try:
                    if mtype == "mouse":
                        await _cdp_mouse(cdp, data)
                    elif mtype == "wheel":
                        await _cdp_wheel(cdp, data)
                    elif mtype == "key":
                        await _cdp_key(cdp, data)
                except Exception as exc:
                    log.warning("Live WS input error: %s", exc)
            elif msg.type == web.WSMsgType.ERROR:
                log.warning("Live WS erro de transporte")
                break
    except Exception as exc:
        log.exception("Live WS falhou: %s", exc)
    finally:
        if screencast_on and cdp:
            try:
                await cdp.send("Page.stopScreencast")
            except Exception:
                pass
        if cdp:
            try:
                await cdp.detach()
            except Exception:
                pass
        await ack_queue.put(None)
        await acker_task
        await outgoing.put(None)
        await sender_task
        log.info("Live WS encerrado")
    return ws


async def handle_config(request: web.Request) -> web.Response:
    """POST /config — recebe config dinamica do frontend."""
    if not bridge:
        return web.json_response({"error": "Bridge nao inicializada"}, status=500)
    try:
        body = await request.json()
        # Atualiza variaveis globais em runtime
        global CDP_URL, TANGO_ROOM_URL, SELETOR_CONTAINER_CHAT, SELETOR_MENSAGEM
        global SELETOR_USERNAME, SELETOR_TEXTO_MSG, SELETOR_INPUT_TEXTO, SELETOR_BOTAO_ENVIAR
        if "cdpUrl" in body:
            CDP_URL = str(body["cdpUrl"])
        if "roomUrl" in body:
            TANGO_ROOM_URL = str(body["roomUrl"])
        selectors = body.get("selectors", {})
        if selectors.get("containerChat"):
            SELETOR_CONTAINER_CHAT = selectors["containerChat"]
        if selectors.get("mensagem"):
            SELETOR_MENSAGEM = selectors["mensagem"]
        if selectors.get("username"):
            SELETOR_USERNAME = selectors["username"]
        if selectors.get("textoMsg"):
            SELETOR_TEXTO_MSG = selectors["textoMsg"]
        if selectors.get("inputTexto"):
            SELETOR_INPUT_TEXTO = selectors["inputTexto"]
        if "botaoEnviar" in selectors:
            SELETOR_BOTAO_ENVIAR = selectors["botaoEnviar"]
        if bridge._status == "connected" and bridge._page:
            await bridge._inject_observer()
        await bridge.push_extension_config()
        log.info("Config atualizada via API e observer sincronizado")
        return web.json_response({"ok": True})
    except Exception as exc:
        return web.json_response({"error": str(exc)}, status=500)


async def handle_extension_ws(request: web.Request) -> web.WebSocketResponse:
    """GET /extension — WebSocket da extensão do Odessa (aba do Tango do usuário).

    Protocolo (JSON):
      extensão → bridge: hello {url, browser} | message {username, text}
                         | page {url} | send_result {id, ok, error, stage} | ping
      bridge → extensão: config {observer} | send {id, text, inputSelector, buttonSelector} | pong
    O acesso passa pelo proxy do backend, que confere o token de pareamento.
    """
    ws = web.WebSocketResponse(heartbeat=20)
    await ws.prepare(request)
    if not bridge:
        await ws.close(code=1011)
        return ws
    if bridge._page is not None:
        # Já há um navegador próprio conectado; não mistura as duas fontes de chat.
        await ws.send_json({"type": "error", "error": "A bridge já está usando outro navegador. Pare a bridge e use o modo extensão."})
        await ws.close(code=1008)
        return ws
    if bridge._extension_ws and not bridge._extension_ws.closed:
        # Aba nova assume o lugar da antiga (ex.: recarregou a live).
        await bridge._extension_ws.close(code=4000, message=b"substituida")
    try:
        async for msg in ws:
            if msg.type != web.WSMsgType.TEXT:
                continue
            try:
                data = json.loads(msg.data)
            except json.JSONDecodeError:
                continue
            kind = data.get("type")
            if kind == "hello":
                await bridge.attach_extension(ws, data)
            elif bridge._extension_ws is not ws:
                continue
            elif kind == "message":
                await bridge._handle_incoming_message(json.dumps({"username": data.get("username", ""), "text": data.get("text", "")}))
            elif kind == "page":
                bridge._page_url = str(data.get("url") or bridge._page_url)
                if data.get("w") and data.get("h"):
                    bridge._extension_viewport = {
                        "w": data.get("w"), "h": data.get("h"),
                        "url": bridge._page_url, "title": data.get("title") or "",
                    }
                    for viewer in list(bridge._live_viewers):
                        viewer.put_nowait({"type": "viewport", **bridge._extension_viewport})
            elif kind == "frame":
                bridge._publish_extension_frame(data)
            elif kind == "capture_error":
                bridge._warn_capture(str(data.get("error") or "Captura da aba indisponível."))
            elif kind == "send_result":
                future = bridge._extension_pending.get(str(data.get("id")))
                if future and not future.done():
                    future.set_result(data)
            elif kind == "ping":
                await ws.send_json({"type": "pong"})
    finally:
        bridge.detach_extension(ws)
    return ws


async def handle_logs(request: web.Request) -> web.Response:
    """GET /logs — retorna ultimas linhas de log."""
    limit = int(request.query.get("limit", "100"))
    limit = min(max(1, limit), 500)
    lines = list(_log_buffer)[-limit:]
    return web.json_response({"lines": lines, "total": len(_log_buffer)})


def create_app() -> web.Application:
    app = web.Application(middlewares=[access_middleware])
    app.router.add_get("/status", handle_status)
    app.router.add_get("/history", handle_history)
    app.router.add_post("/clear-history", handle_clear_history)
    app.router.add_get("/messages", handle_messages_sse)
    app.router.add_get("/debug-dom", handle_debug_dom)
    app.router.add_get("/screenshot", handle_screenshot)
    app.router.add_get("/viewport", handle_viewport)
    app.router.add_get("/live", handle_live_ws)
    app.router.add_get("/extension", handle_extension_ws)
    app.router.add_get("/logs", handle_logs)
    app.router.add_post("/send", handle_send)
    app.router.add_post("/connect", handle_connect)
    app.router.add_post("/disconnect", handle_disconnect)
    app.router.add_post("/goto", handle_goto)
    app.router.add_post("/config", handle_config)
    app.router.add_post("/click", handle_click)
    app.router.add_post("/type", handle_type_text)
    app.router.add_post("/key", handle_key)
    app.router.add_post("/scroll", handle_scroll)
    app.router.add_post("/start", handle_connect)
    app.router.add_post("/stop", handle_disconnect)
    app.router.add_route("OPTIONS", "/{tail:.*}", lambda r: web.Response(status=204))
    return app


# =====================================================================
#  MAIN
# =====================================================================

async def main() -> None:
    global bridge
    bridge = TangoChatBridge()

    app = create_app()
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, BRIDGE_HOST, SERVER_PORT)
    await site.start()

    log.info("=" * 60)
    log.info("  Tango Chat Bridge -- Servidor HTTP")
    log.info("  http://%s:%d  (token %s)", BRIDGE_HOST, SERVER_PORT, "exigido" if BRIDGE_TOKEN else "NAO configurado -- modo legado")
    log.info("=" * 60)
    log.info("")
    log.info("  Endpoints:")
    log.info("    GET  /status        Estado da bridge")
    log.info("    GET  /messages      SSE stream (tempo real)")
    log.info("    POST /connect       Conectar ao Tango")
    log.info("    POST /disconnect    Desconectar")
    log.info("    POST /send          Enviar mensagem")
    log.info("    GET  /history       Ultimas mensagens")
    log.info("    GET  /screenshot    Captura do viewport (JPEG)")
    log.info("    GET  /viewport      Dimensoes do viewport")
    log.info("    GET  /live          WebSocket video tempo real + interacao")
    log.info("    POST /click         Clicar em (x,y)")
    log.info("    POST /type          Digitar texto no foco")
    log.info("    POST /key           Pressionar tecla")
    log.info("    POST /scroll        Rolar pagina")
    log.info("    POST /goto          Navegar para URL")
    log.info("")
    log.info("  Modos de conexao:")
    log.info("    1. CDP        -> Chrome com --remote-debugging-port=9222")
    log.info("    2. Standalone -> Chromium do Playwright (perfil salvo)")
    log.info("    POST /connect                -> tenta CDP, fallback standalone")
    log.info('    POST /connect {"mode":"cdp"} -> forca CDP')
    log.info('    POST /connect {"mode":"standalone"} -> forca standalone')
    log.info('    POST /connect {"mode":"extension"}  -> aba do Tango do usuario via extensao (GET /extension)')
    log.info("")

    if "--autoconnect" in sys.argv:
        log.info("Flag --autoconnect detectada. Tentando conectar...")
        try:
            await bridge.connect(force_mode=str(_cli_config.get("mode", "")))
        except Exception:
            log.exception("Falha no autoconnect.")

    try:
        while True:
            await asyncio.sleep(3600)
    except KeyboardInterrupt:
        log.info("Interrompido pelo usuario.")
    finally:
        if bridge._status == "connected":
            await bridge.disconnect()
        await runner.cleanup()


if __name__ == "__main__":
    asyncio.run(main())
