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
from server.api.v1.api import api_router
from server.api.v1.endpoints import auth, obs, webhooks, proxy as proxy_router, agent as agent_router

# Logging configuration
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("odessa")


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
        "desktop": {
            "enabled": os.getenv("ODESSA_DESKTOP") == "1",
            "user_data_dir": user_data_dir,
            "assets_found": (root_dir / "assets").exists(),
            "videos_found": (root_dir / "assets" / "videos").exists(),
        },
    }


def _bridge_port() -> int:
    try:
        from server.services.bridge_manager import load_bridge_config
        return int(load_bridge_config().get("port", 7555))
    except Exception:
        return 7555


_PROXY_DROP_REQUEST_HEADERS = {"host", "content-length", "connection", "transfer-encoding"}
_PROXY_DROP_RESPONSE_HEADERS = {"content-length", "content-encoding", "transfer-encoding", "connection"}


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
    port = _bridge_port()
    url = f"http://127.0.0.1:{port}/{path}"
    body = await request.body()
    client = httpx.AsyncClient(timeout=None)
    req = client.build_request(
        request.method,
        url,
        params=request.query_params,
        headers=[(k, v) for k, v in request.headers.items() if k.lower() not in _PROXY_DROP_REQUEST_HEADERS],
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
    port = _bridge_port()
    await websocket.accept()
    try:
        async with websockets.connect(f"ws://127.0.0.1:{port}/live", max_size=None) as upstream:
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
