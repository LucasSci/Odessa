"""Extensão do Odessa para Edge/Chrome — usa a aba do Tango já logada.

Em vez de abrir um navegador próprio (perfil dedicado, porta de depuração,
login de novo), a extensão roda na aba em que o usuário já está logado e fala
com a bridge por WebSocket, passando por /tango-bridge/extension no backend.

Segurança: o WebSocket só aceita Origin de extensão e exige o token de
pareamento gravado em config.js quando o usuário prepara a pasta da extensão.
Sem ele, qualquer outra extensão/página poderia injetar mensagens falsas no
chat da persona ou pedir envios.
"""
from __future__ import annotations

import asyncio
import hmac
import json
import logging
import os
import secrets
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

from server.config import RUNTIME_DIR
from server.services.bridge_manager import (
    bridge_auth_headers,
    bridge_manager,
    load_bridge_config,
    save_bridge_config,
)

log = logging.getLogger("odessa.browser_extension")

_ROOT = Path(__file__).resolve().parents[2]
EXTENSION_SOURCE_DIR = _ROOT / "tango_chat" / "extension"
CHAT_OBSERVER_SOURCE = _ROOT / "tango_chat" / "chat_observer.js"
EXTENSION_FILES = ("manifest.json", "background.js", "content.js", "popup.html", "popup.js")
EXTENSION_ORIGIN_PREFIXES = ("chrome-extension://", "extension://")
EXTENSION_MODE = "extension"

_PAIR_TOKEN_FILE = "extension.token"
_pair_token_cache: dict[Path, str] = {}


class BridgePaused(RuntimeError):
    """O usuário parou a bridge no Odessa: a extensão não deve religá-la."""


def extension_install_dir() -> Path:
    """Pasta fixa, fora da instalação: o Edge guarda o caminho da extensão
    "sem pacote", e uma atualização do Odessa não pode apagá-la.

    Fica na pasta do usuário, visível: AppData é oculta no seletor de pasta do
    navegador, e processos de apps empacotados (MSIX) têm AppData\\Local
    redirecionada — a pasta "existia" para o Odessa e não para o Edge.
    """
    explicit = os.getenv("ODESSA_EXTENSION_DIR", "").strip()
    if explicit:
        return Path(explicit)
    home = os.getenv("USERPROFILE", "").strip() or str(Path.home())
    return Path(home) / "Odessa-Extensao-Edge" if home else RUNTIME_DIR / "browser-extension"


def get_pairing_token() -> str:
    path = RUNTIME_DIR / _PAIR_TOKEN_FILE
    cached = _pair_token_cache.get(path)
    if cached:
        return cached
    try:
        token = path.read_text(encoding="utf-8").strip()
    except OSError:
        token = ""
    if len(token) < 24:
        token = secrets.token_urlsafe(32)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(token, encoding="utf-8")
    _pair_token_cache[path] = token
    return token


def pairing_token_ok(candidate: Any) -> bool:
    if not isinstance(candidate, str) or not candidate:
        return False
    return hmac.compare_digest(candidate.encode(), get_pairing_token().encode())


def extension_origin_ok(origin: str | None) -> bool:
    return bool(origin) and origin.lower().startswith(EXTENSION_ORIGIN_PREFIXES)


def extension_version() -> str:
    try:
        return str(json.loads((EXTENSION_SOURCE_DIR / "manifest.json").read_text(encoding="utf-8"))["version"])
    except (OSError, ValueError, KeyError):
        return ""


def prepare_extension(backend_port: int) -> dict[str, Any]:
    """Monta a pasta "sem pacote" da extensão com o endereço do backend e o token."""
    target = extension_install_dir()
    target.mkdir(parents=True, exist_ok=True)
    for name in EXTENSION_FILES:
        shutil.copyfile(EXTENSION_SOURCE_DIR / name, target / name)
    shutil.copyfile(CHAT_OBSERVER_SOURCE, target / "chat_observer.js")
    config = {
        "wsUrl": f"ws://127.0.0.1:{int(backend_port)}/tango-bridge/extension",
        "pairToken": get_pairing_token(),
        "preparedAt": datetime.now(timezone.utc).isoformat(),
    }
    (target / "config.js").write_text(
        "// Gerado pelo Odessa (Preparar extensão). Contém o token de pareamento local: não compartilhe.\n"
        f"self.ODESSA_CONFIG = {json.dumps(config, ensure_ascii=False)};\n",
        encoding="utf-8",
    )
    return {"ok": True, "path": str(target), "version": extension_version()}


def extension_info() -> dict[str, Any]:
    target = extension_install_dir()
    return {
        "path": str(target),
        "prepared": (target / "config.js").exists(),
        "version": extension_version(),
    }


async def _bridge_call(port: int, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(f"http://127.0.0.1:{port}{path}", json=body or {}, headers=bridge_auth_headers())
        try:
            return resp.json()
        except ValueError:
            return {}


async def ensure_bridge_for_extension(wait_s: float = 20.0) -> int:
    """Deixa a bridge pronta para a extensão e devolve a porta dela.

    - bridge parada pelo usuário no Odessa → BridgePaused (não religa sozinha);
    - bridge desligada → inicia já em modo extensão;
    - bridge usando navegador próprio → troca para a aba do usuário.
    O modo fica salvo: no próximo início o Odessa não abre outro navegador.
    """
    if bridge_manager.user_stopped:
        raise BridgePaused("A bridge está parada no Odessa. Inicie-a na Central da Live.")
    config = load_bridge_config()
    if config.get("mode") != EXTENSION_MODE:
        config["mode"] = EXTENSION_MODE
        config = save_bridge_config(config)
    port = int(config.get("port", 7555))

    status = await asyncio.to_thread(bridge_manager._probe_bridge, port)
    if status is None and not bridge_manager.is_running:
        result = await bridge_manager.start(mode=EXTENSION_MODE, autoconnect=True, config=config)
        if not result.get("ok"):
            raise RuntimeError(f"Não foi possível iniciar a bridge: {result.get('error')}")
    loop = asyncio.get_running_loop()
    deadline = loop.time() + wait_s
    while status is None:
        if loop.time() > deadline:
            raise RuntimeError("A bridge não respondeu a tempo.")
        await asyncio.sleep(0.5)
        status = await asyncio.to_thread(bridge_manager._probe_bridge, port)

    if status.get("mode") != EXTENSION_MODE:
        if status.get("status") == "connected":
            log.info("Extensão conectou: trocando a bridge do navegador próprio para a aba do usuário.")
            await _bridge_call(port, "/disconnect")
        await _bridge_call(port, "/connect", {"mode": EXTENSION_MODE})
    return port
