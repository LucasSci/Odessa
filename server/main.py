import asyncio
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
import httpx
import websockets
from fastapi import FastAPI, HTTPException, Request, WebSocket
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from server.config import GEMINI_API_KEY, OPENAI_API_KEY  # noqa: F401 (mantido p/ compat de import)
from server.core import auth as auth_core
from server.core.atomic_json import recovery_events
from server.core.observability import init_sentry
from server.core.request_guard import RequestGuard
from server.api.v1.api import api_router
from server.api.v1.endpoints import auth, obs, webhooks, proxy as proxy_router, agent as agent_router

# Logging configuration
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("odessa")

# Antes de criar o app: a integração FastAPI do Sentry se registra no init.
init_sentry()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Auto-inicia a bridge do Tango (captura de chat + tela) quando o backend
    # sobe, usando a config persistida. Evita que o usuário precise iniciar a
    # bridge manualmente a cada execução. Desative com ODESSA_AUTOSTART_BRIDGE=0
    # (ex.: deploy na nuvem, onde não há Chromium/desktop).
    logger.info("Odessa Backend v1.1.0 starting up...")
    logger.info("Modular API mounted at /api/v1")
    logger.info("Odessa Backend is ready.")

    # Mantém o Ollama aquecido em segundo plano (ver ollama_keepalive_loop) —
    # evita o cold-start de 15-35s na primeira resposta depois de um tempo
    # sem mensagens no chat.
    keepalive_task = None
    try:
        from server.services.ai_service import ollama_keepalive_loop
        keepalive_task = asyncio.create_task(ollama_keepalive_loop())
    except Exception as exc:
        logger.warning("Erro ao iniciar keep-alive do Ollama: %s", exc)

    if os.getenv("ODESSA_AUTOSTART_BRIDGE", "0") == "1":
        try:
            from server.services.bridge_manager import bridge_manager, load_bridge_config
            if not bridge_manager.is_running:
                cfg = load_bridge_config()
                result = await bridge_manager.start(
                    autoconnect=cfg.get("autoconnect", True),
                    config=cfg,
                )
                if result.get("ok"):
                    logger.info("Bridge do Tango auto-iniciada (pid=%s)", result.get("pid"))
                else:
                    logger.warning("Falha ao auto-iniciar bridge: %s", result.get("error"))
        except Exception as exc:
            logger.warning("Erro ao auto-iniciar bridge: %s", exc)

    yield

    # Shutdown: encerra a bridge do Tango para não deixar processo órfão.
    try:
        from server.services.bridge_manager import bridge_manager
        if bridge_manager.is_running:
            await bridge_manager.stop()
            logger.info("Bridge do Tango encerrada no shutdown.")
    except Exception as exc:
        logger.warning("Erro ao encerrar bridge no shutdown: %s", exc)

    if keepalive_task is not None:
        keepalive_task.cancel()


app = FastAPI(
    title="Odessa API",
    description="Professional backend for the Odessa AI Streamer Persona",
    version="1.1.0",
    lifespan=lifespan,
)

# CORS Configuration
allowed_origins = [
    origin.strip()
    for origin in os.getenv("ODESSA_ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Rotas públicas (não exigem sessão): login/health/estáticos e mídia para
# elementos <video> (que não enviam Authorization header; em same-origin o
# cookie de sessão cobre quando há login).
_PUBLIC_PATH_PREFIXES = (
    "/auth/",
    "/api/auth/",
    "/api/v1/video/play/",
    "/api/v1/video/available",
    "/api/v1/video-gen/video/",
    "/assets/",
    "/docs",
    "/redoc",
    "/openapi.json",
)
_PUBLIC_PATHS_EXACT = {"", "/", "/favicon.ico", "/index.html", "/health", "/api/health"}


@app.middleware("http")
async def require_admin_session(request: Request, call_next):
    # Modo dev (opt-in): ODESSA_AUTH_DISABLED=1 libera tudo.
    if auth_core.AUTH_DISABLED:
        return await call_next(request)
    path = request.url.path
    if path in _PUBLIC_PATHS_EXACT or any(path.startswith(p) for p in _PUBLIC_PATH_PREFIXES):
        return await call_next(request)
    # Persona asset images (GET) — served to <img> tags without auth headers.
    # Pattern: /api/v1/personas/{id}/assets/{category}/{image_id}
    if (
        request.method == "GET"
        and "/assets/" in path
        and path.startswith("/api/v1/personas/")
    ):
        return await call_next(request)
    try:
        auth_core.require_admin(request)
    except HTTPException as exc:
        from fastapi.responses import JSONResponse
        return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)
    return await call_next(request)

_request_guard = RequestGuard.from_env(allowed_origins)


# Registrado DEPOIS do middleware de sessão: o Starlette executa o último
# registrado primeiro, então o Host/Origin é checado antes de qualquer outra coisa.
@app.middleware("http")
async def guard_host_and_origin(request: Request, call_next):
    rejection = _request_guard.check(
        request.method,
        request.headers.get("host"),
        request.headers.get("origin"),
    )
    if rejection:
        status_code, detail = rejection
        return JSONResponse({"detail": detail}, status_code=status_code)
    return await call_next(request)

# Include Modular API Routers
# Auth is mounted at both /auth (local dev) and /api/auth (cloud/preview mode,
# matching the Hostinger api/auth/*.js layout the frontend's cloud-mode URL
# builder expects). Without /api/auth the preview's POST /api/auth/login hits the
# SPA catch-all (GET-only) and returns 405, breaking login.
app.include_router(auth.router, prefix="/auth")
app.include_router(auth.router, prefix="/api/auth")
app.include_router(api_router, prefix="/api/v1")
app.include_router(api_router, prefix="/api")
app.include_router(obs.router, prefix="/obs")
app.include_router(agent_router.router, prefix="/api")
app.include_router(webhooks.router, prefix="/webhooks")
# Proxy mounted at /proxy — strips X-Frame-Options/CSP for iframe embedding
app.include_router(proxy_router.router, prefix="/proxy")

# Health check — available at /health (local dev) and /api/health (cloud/preview
# mode, matching the Hostinger layout). The frontend's cloud-mode URL builder
# rewrites /health to /api/health.
@app.get("/health")
@app.get("/api/health")
async def health_check():
    root_dir = Path(__file__).resolve().parents[1]
    user_data_dir = os.getenv("ODESSA_USER_DATA_DIR")
    return {
        "status": "ok",
        "version": "1.1.0",
        "service": "odessa-api",
        # Arquivos de dados que estavam corrompidos e foram isolados/restaurados
        # (ver atomic_json). Vazio = tudo íntegro.
        "dataRecovery": recovery_events(),
        "desktop": {
            "enabled": os.getenv("ODESSA_DESKTOP") == "1",
            "user_data_dir": user_data_dir,
            "assets_found": (root_dir / "assets").exists(),
            "videos_found": (root_dir / "assets" / "videos").exists(),
        },
    }


# Dependências externas (Ollama, chaves de IA) com o que fazer para consertar.
# Exige sessão (não está em _PUBLIC_PATHS_EXACT): é para a UI já logada.
@app.get("/health/deps")
@app.get("/api/health/deps")
async def health_deps():
    import shutil

    from server import config as server_config
    from server.api.v1.endpoints.ai import _check_ollama
    from server.services.deps_health import build_deps_report

    return build_deps_report(
        provider=server_config.AI_PROVIDER,
        ollama=await _check_ollama(),
        ollama_installed=shutil.which("ollama") is not None,
        keys={
            "gemini": bool(server_config.GEMINI_API_KEY),
            "openai": bool(server_config.OPENAI_API_KEY),
            "claude": bool(server_config.ANTHROPIC_API_KEY),
        },
    )


def _bridge_port() -> int:
    try:
        from server.services.bridge_manager import load_bridge_config
        return int(load_bridge_config().get("port", 7555))
    except Exception:
        return 7555


_PROXY_DROP_REQUEST_HEADERS = {"host", "content-length", "connection", "transfer-encoding"}
_PROXY_DROP_RESPONSE_HEADERS = {"content-length", "content-encoding", "transfer-encoding", "connection"}

# Chamada servidor→bridge: não repassa o que identifica o NAVEGADOR (a bridge
# trata Origin como sinal de CSRF; cookie/authorization são do Odessa, não dela)
# e adiciona o token que só o backend conhece.
_BRIDGE_DROP_REQUEST_HEADERS = _PROXY_DROP_REQUEST_HEADERS | {
    "origin", "referer", "cookie", "authorization", "x-bridge-token",
}


def bridge_forward_headers(request_headers, token: str) -> list[tuple[str, str]]:
    from server.services.bridge_manager import BRIDGE_TOKEN_HEADER

    forwarded = [(k, v) for k, v in request_headers if k.lower() not in _BRIDGE_DROP_REQUEST_HEADERS]
    forwarded.append((BRIDGE_TOKEN_HEADER, token))
    return forwarded


# O frontend fala com a bridge do Tango (tango_chat.py) atraves do caminho
# relativo BRIDGE_URL='/tango-bridge' (ver src/core/tangoChatSession.tsx),
# assumindo que existe um proxy reverso aqui para a porta real da bridge
# (7555 por padrao). Em desenvolvimento isso vem do proxy do servidor de dev
# do Vite (vite.config.ts) -- mas essa e uma feature SO do dev server, nunca
# fez parte do build de producao (dist/). O instalador desktop sempre serviu
# o build de producao, entao esse proxy NUNCA existiu ali: toda chamada
# (conectar, enviar mensagem, e principalmente o stream SSE de /messages)
# caia no catch-all do SPA abaixo (devolvia o proprio index.html) e falhava
# silenciosamente. Por isso o diagnostico da bridge sempre reportava
# "acoplado" (ele fala direto com o backend Python, sem passar por aqui) mas
# o chat ao vivo nunca aparecia na tela -- um "falso positivo" real.
@app.api_route("/tango-bridge/{path:path}", methods=["GET", "POST"], include_in_schema=False)
async def proxy_tango_bridge(path: str, request: Request):
    from server.services.bridge_manager import get_bridge_token

    port = _bridge_port()
    url = f"http://127.0.0.1:{port}/{path}"
    body = await request.body()
    client = httpx.AsyncClient(timeout=None)
    req = client.build_request(
        request.method,
        url,
        params=request.query_params,
        headers=bridge_forward_headers(request.headers.items(), get_bridge_token()),
        content=body,
    )
    try:
        upstream = await client.send(req, stream=True)
    except httpx.ConnectError:
        await client.aclose()
        return JSONResponse({"error": "bridge_unreachable"}, status_code=502)

    async def _stream():
        try:
            async for chunk in upstream.aiter_raw():
                yield chunk
        finally:
            await upstream.aclose()
            await client.aclose()

    headers = {k: v for k, v in upstream.headers.items() if k.lower() not in _PROXY_DROP_RESPONSE_HEADERS}
    return StreamingResponse(
        _stream(),
        status_code=upstream.status_code,
        headers=headers,
        media_type=upstream.headers.get("content-type"),
    )


@app.websocket("/tango-bridge/live")
async def proxy_tango_bridge_live(websocket: WebSocket):
    """Mesmo proxy acima, mas para o WebSocket de screencast (ver
    LiveVisionMonitor.tsx) -- tambem inexistente em producao sem isso."""
    from server.services.bridge_manager import BRIDGE_TOKEN_HEADER, get_bridge_token

    # O middleware HTTP não cobre WebSocket: sem esta checagem, qualquer site
    # aberto no navegador poderia abrir ws://localhost:8000/tango-bridge/live e
    # dirigir o Chromium logado (clique/teclado/navegação) pela bridge.
    host = websocket.headers.get("host")
    origin = websocket.headers.get("origin")
    if not _request_guard.host_ok(host) or not _request_guard.origin_ok(origin, host):
        await websocket.close(code=1008)
        return

    port = _bridge_port()
    await websocket.accept()
    try:
        async with websockets.connect(
            f"ws://127.0.0.1:{port}/live",
            max_size=None,
            additional_headers={BRIDGE_TOKEN_HEADER: get_bridge_token()},
        ) as upstream:
            async def client_to_upstream():
                while True:
                    msg = await websocket.receive()
                    if msg["type"] == "websocket.disconnect":
                        break
                    if msg.get("text") is not None:
                        await upstream.send(msg["text"])
                    elif msg.get("bytes") is not None:
                        await upstream.send(msg["bytes"])

            async def upstream_to_client():
                async for message in upstream:
                    if isinstance(message, bytes):
                        await websocket.send_bytes(message)
                    else:
                        await websocket.send_text(message)

            done, pending = await asyncio.wait(
                [asyncio.create_task(client_to_upstream()), asyncio.create_task(upstream_to_client())],
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in pending:
                task.cancel()
    except Exception:
        pass
    finally:
        try:
            await websocket.close()
        except Exception:
            pass


@app.websocket("/tango-bridge/extension")
async def proxy_tango_bridge_extension(websocket: WebSocket):
    """Extensão do Odessa (aba do Tango já logada no Edge/Chrome do usuário) ↔ bridge.

    Só aceita Origin de extensão + token de pareamento no primeiro quadro
    (hello). Deixa a bridge pronta em modo extensão (ver browser_extension.py)
    e repassa os quadros nos dois sentidos.
    """
    import json

    from server.services.bridge_manager import BRIDGE_TOKEN_HEADER, get_bridge_token
    from server.services.browser_extension import (
        BridgePaused,
        ensure_bridge_for_extension,
        extension_origin_ok,
        pairing_token_ok,
    )

    if not _request_guard.host_ok(websocket.headers.get("host")) or not extension_origin_ok(websocket.headers.get("origin")):
        await websocket.close(code=1008)
        return
    await websocket.accept()
    try:
        hello = json.loads(await asyncio.wait_for(websocket.receive_text(), timeout=10))
    except Exception:
        await websocket.close(code=1008)
        return
    if not isinstance(hello, dict) or hello.get("type") != "hello" or not pairing_token_ok(hello.pop("pairToken", None)):
        await websocket.close(code=4001, reason="pairing")
        return

    try:
        port = await ensure_bridge_for_extension()
    except BridgePaused as exc:
        await websocket.close(code=4002, reason=str(exc)[:120])
        return
    except Exception as exc:
        logger.warning("Extensão: bridge indisponível: %s", exc)
        await websocket.send_text(json.dumps({"type": "error", "error": str(exc)}))
        await websocket.close(code=1011)
        return

    close_code = 1000
    try:
        async with websockets.connect(
            f"ws://127.0.0.1:{port}/extension",
            additional_headers={BRIDGE_TOKEN_HEADER: get_bridge_token()},
        ) as upstream:
            await upstream.send(json.dumps(hello))

            async def client_to_upstream():
                while True:
                    msg = await websocket.receive()
                    if msg["type"] == "websocket.disconnect":
                        break
                    if msg.get("text") is not None:
                        await upstream.send(msg["text"])

            async def upstream_to_client():
                async for message in upstream:
                    await websocket.send_text(message if isinstance(message, str) else message.decode("utf-8", "replace"))

            done, pending = await asyncio.wait(
                [asyncio.create_task(client_to_upstream()), asyncio.create_task(upstream_to_client())],
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in pending:
                task.cancel()
            # 4000 = outra aba assumiu: a extensão não deve reconectar esta.
            if upstream.close_code and 4000 <= upstream.close_code < 5000:
                close_code = upstream.close_code
    except Exception as exc:
        logger.info("Extensão: conexão com a bridge encerrada: %s", exc)
        close_code = 1011
    finally:
        try:
            await websocket.close(code=close_code)
        except Exception:
            pass


dist_dir = Path(__file__).resolve().parents[1] / "dist"
if dist_dir.exists():
    app.mount("/assets", StaticFiles(directory=dist_dir / "assets"), name="web-assets")

    # index.html nunca pode ser cacheado pelo navegador: e ele quem referencia
    # o bundle JS/CSS com hash do build atual (ex.: index-HGUFp36R.js). Sem
    # este header, o navegador pode continuar servindo um index.html antigo
    # do proprio cache (mesmo fechando e reabrindo a aba, sem um hard-refresh)
    # e a pagina roda o codigo de uma versao anterior indefinidamente, mesmo
    # apos deploys/atualizacoes -- foi exatamente isso que fez uma correcao
    # parecer "nao aplicada" para o usuario. Os arquivos dentro de /assets/ sao
    # o oposto: tem hash no nome, entao podem (e devem) ser cacheados para sempre.
    _NO_CACHE_HEADERS = {"Cache-Control": "no-cache, no-store, must-revalidate"}

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_web_app(full_path: str):
        target = dist_dir / full_path
        if (
            full_path
            and full_path != "index.html"
            and target.is_file()
            and target.resolve().is_relative_to(dist_dir.resolve())
        ):
            return FileResponse(target)
        return FileResponse(dist_dir / "index.html", headers=_NO_CACHE_HEADERS)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
