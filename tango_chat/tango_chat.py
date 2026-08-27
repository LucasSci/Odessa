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
import json
import logging
import os
import random
import sys
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Coroutine

from aiohttp import web
from aiohttp.web import middleware

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
PROFILE_DIR: str = os.environ.get(
    "TANGO_PROFILE_DIR",
    str(Path.home() / ".tango_profile"),
)

# Padrao para identificar a aba do Tango na lista de paginas (modo CDP).
TANGO_URL_PATTERN: str = os.environ.get("TANGO_URL_PATTERN", "tango.me")

# Porta do servidor HTTP local
SERVER_PORT: int = int(_cli_config.get("port", os.environ.get("TANGO_BRIDGE_PORT", "7555")))

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

    def to_dict(self) -> dict:
        return {
            "username": self.username,
            "text": self.text,
            "timestamp": self.timestamp,
        }


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

    # == Conectar =====================================================

    async def connect(self, force_mode: str = "") -> None:
        """
        Conecta ao Tango.

        force_mode:
          ""           -> tenta CDP, se falhar usa standalone
          "cdp"        -> so CDP
          "standalone" -> so standalone
        """
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

            # Espera container do chat
            log.info("Esperando container do chat...")
            try:
                await self._page.wait_for_selector(
                    SELETOR_CONTAINER_CHAT, timeout=WAIT_TIMEOUT_S * 1000
                )
                log.info("Container do chat encontrado!")
            except Exception:
                log.warning(
                    "Container do chat nao apareceu em %ds. "
                    "O chat pode nao estar visivel ainda. "
                    "Continuando mesmo assim...",
                    WAIT_TIMEOUT_S,
                )

            # Injeta observer
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
            self._page = await self._find_tango_page()
            if self._page:
                self._mode = "cdp"
                log.info("CDP conectou! Aba do Tango encontrada.")
                return True
            else:
                log.warning("CDP conectou mas nenhuma aba do Tango encontrada.")
                # Nao limpa browser CDP aqui — vamos tentar standalone
                self._browser = None
                return False
        except Exception as e:
            log.info("CDP nao disponivel: %s", str(e)[:100])
            return False

    async def _try_standalone(self) -> None:
        """Abre Chromium com perfil persistente e navega ao Tango."""
        log.info("Usando modo STANDALONE (Chromium do Playwright)")
        log.info("Perfil persistente: %s", PROFILE_DIR)

        # Aplica stealth se disponivel
        stealth_scripts = []
        try:
            from playwright_stealth import stealth_async, StealthConfig
            log.info("playwright-stealth disponivel")
        except ImportError:
            log.info("playwright-stealth nao instalado (ok, continuando sem)")

        self._context = await self._playwright.chromium.launch_persistent_context(
            PROFILE_DIR,
            headless=False,
            viewport={"width": 1280, "height": 900},
            locale="pt-BR",
            timezone_id="America/Sao_Paulo",
            args=[
                "--disable-blink-features=AutomationControlled",
                "--disable-infobars",
            ],
            ignore_default_args=["--enable-automation"],
        )

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

        self._mode = "standalone"
        log.info("Standalone pronto. URL: %s", self._page.url)

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
        await self._cleanup()
        self._status = "disconnected"
        self._started_at = None
        self._mode = ""
        log.info("Bridge desconectada.")

    async def _cleanup(self) -> None:
        """Limpa referencias."""
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

        js_code = f"""
        (() => {{
            if (window.__tangoChatObserverActive) return;
            window.__tangoChatObserverActive = true;

            const containerSelector = `{SELETOR_CONTAINER_CHAT}`;
            const messageSelector   = `{SELETOR_MENSAGEM}`;
            const usernameSelector  = `{SELETOR_USERNAME}`;
            const textSelector      = `{SELETOR_TEXTO_MSG}`;

            // Expõe função de simulação global
            window.__odessaSimulateChat = (username, text) => {{
                if (window.__onNewChatMessage) {{
                    window.__onNewChatMessage(JSON.stringify({{ username, text }}));
                }}
            }};

            const container = document.querySelector(containerSelector);
            if (!container) {{
                console.warn('[OdessaBot] Container nao encontrado imediatamente:', containerSelector);
                return;
            }}

            const seen = new Set();

            function extractMessage(node) {{
                if (!node || !node.querySelector) return null;
                const msgEl = node.matches(messageSelector)
                    ? node
                    : node.querySelector(messageSelector);
                if (!msgEl) return null;

                const usernameEl = msgEl.querySelector(usernameSelector);
                const textEl     = msgEl.querySelector(textSelector);

                const username = usernameEl ? usernameEl.innerText.trim() : '???';
                const text     = textEl     ? textEl.innerText.trim()     : '';
                if (!text) return null;

                const hash = `${{username}}::${{text}}::${{Date.now()}}`;
                return {{ username, text, hash }};
            }}

            const observer = new MutationObserver((mutations) => {{
                for (const mutation of mutations) {{
                    for (const node of mutation.addedNodes) {{
                        if (node.nodeType !== Node.ELEMENT_NODE) continue;
                        const msg = extractMessage(node);
                        if (msg && !seen.has(msg.hash)) {{
                            seen.add(msg.hash);
                            if (seen.size > 2000) {{
                                const keep = [...seen].slice(-1500);
                                seen.clear();
                                keep.forEach(h => seen.add(h));
                            }}
                            window.__onNewChatMessage(JSON.stringify({{
                                username: msg.username,
                                text: msg.text
                            }}));
                        }}
                    }}
                }}
            }});

            observer.observe(container, {{
                childList: true,
                subtree: true
            }});

            console.log('[OdessaBot] MutationObserver ativo');
        }})();
        """
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
            log.info("MSG | %s: %s", msg.username, msg.text)
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

    async def send_message(self, text: str) -> None:
        """Envia uma mensagem no chat do Tango."""
        if not self._page:
            raise RuntimeError("Bridge nao conectada.")

        log.info("SEND | %s", text)

        input_el = self._page.locator(SELETOR_INPUT_TEXTO)
        await input_el.wait_for(state="visible", timeout=WAIT_TIMEOUT_S * 1000)
        await input_el.click()

        await asyncio.sleep(random.uniform(0.1, 0.3))

        for char in text:
            await self._page.keyboard.type(
                char,
                delay=random.randint(TYPING_DELAY_MIN_MS, TYPING_DELAY_MAX_MS),
            )

        await asyncio.sleep(random.uniform(0.15, 0.4))

        if SELETOR_BOTAO_ENVIAR:
            btn = self._page.locator(SELETOR_BOTAO_ENVIAR)
            await btn.click()
        else:
            await self._page.keyboard.press("Enter")

        log.info("SEND | Mensagem enviada.")

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
        }


# =====================================================================
#  SERVIDOR HTTP LOCAL (aiohttp)
# =====================================================================

bridge: TangoChatBridge | None = None


@middleware
async def cors_middleware(request: web.Request, handler):
    """CORS para a UI da Odessa consumir."""
    if request.method == "OPTIONS":
        response = web.Response(status=204)
    else:
        try:
            response = await handler(request)
        except web.HTTPException as exc:
            response = exc
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    return response


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
        await bridge.send_message(text)
        return web.json_response({"ok": True})
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
            "Access-Control-Allow-Origin": "*",
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

async def handle_goto(request: web.Request) -> web.Response:
    """POST /goto - Navega o robo para uma URL especifica"""
    if not bridge or not bridge._page:
        return web.json_response({"error": "Sem pagina conectada"}, status=400)
    try:
        body = await request.json()
        url = body.get("url")
        if not url:
            return web.json_response({"error": "URL nao fornecida"}, status=400)
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
    """Dispatch de roda do mouse via CDP."""
    x = float(data.get("x", 0))
    y = float(data.get("y", 0))
    dx = float(data.get("deltaX", 0))
    dy = float(data.get("deltaY", 0))
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


async def handle_live_ws(request: web.Request) -> web.WebSocketResponse:
    """GET /live — WebSocket de VIDEO EM TEMPO REAL (CDP Screencast) + interacao.

    Fluxo:
      - Server inicia Page.startScreencast na pagina conectada e envia cada
        frame (JPEG base64) assim que a pagina muda (tempo real, nao polling).
      - Client envia eventos de mouse/teclado/scroll que sao repassados via
        CDP Input.dispatch* — interacao de verdade, como Chrome Remote Desktop.
    """
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

    async def _sender() -> None:
        """Drena a fila de saida e envia pelo ws (serializa sends)."""
        while True:
            item = await outgoing.get()
            if item is None:
                break
            try:
                await ws.send_json(item)
            except Exception:
                break

    def _on_frame(frame: dict) -> None:
        """Callback de cada frame do screencast — encaminha e acka."""
        meta = frame.get("metadata", {}) or {}
        w = meta.get("width") or meta.get("deviceWidth") or 1280
        h = meta.get("height") or meta.get("deviceHeight") or 720
        try:
            outgoing.put_nowait(
                {"type": "frame", "data": frame.get("data", ""),
                 "w": w, "h": h}
            )
        except Exception:
            pass
        # Ack obrigatorio para receber o proximo frame
        asyncio.create_task(
            cdp.send("Page.screencastFrameAck",
                     {"sessionId": frame.get("sessionId", 0)})
        )

    sender_task = asyncio.create_task(_sender())

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
            "format": "jpeg", "quality": 60,
            "maxWidth": 1280, "maxHeight": 720,
        })
        screencast_on = True
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
        log.info("Config atualizada via API")
        return web.json_response({"ok": True})
    except Exception as exc:
        return web.json_response({"error": str(exc)}, status=500)


async def handle_logs(request: web.Request) -> web.Response:
    """GET /logs — retorna ultimas linhas de log."""
    limit = int(request.query.get("limit", "100"))
    limit = min(max(1, limit), 500)
    lines = list(_log_buffer)[-limit:]
    return web.json_response({"lines": lines, "total": len(_log_buffer)})


def create_app() -> web.Application:
    app = web.Application(middlewares=[cors_middleware])
    app.router.add_get("/status", handle_status)
    app.router.add_get("/history", handle_history)
    app.router.add_get("/messages", handle_messages_sse)
    app.router.add_get("/debug-dom", handle_debug_dom)
    app.router.add_get("/screenshot", handle_screenshot)
    app.router.add_get("/viewport", handle_viewport)
    app.router.add_get("/live", handle_live_ws)
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
    site = web.TCPSite(runner, "0.0.0.0", SERVER_PORT)
    await site.start()

    log.info("=" * 60)
    log.info("  Tango Chat Bridge -- Servidor HTTP")
    log.info("  http://localhost:%d", SERVER_PORT)
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
    log.info("")

    if "--autoconnect" in sys.argv:
        log.info("Flag --autoconnect detectada. Tentando conectar...")
        try:
            await bridge.connect()
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
