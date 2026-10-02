"""
tango_profile.py — Recria o perfil "Tango Profile" do OBS com um clique.

Às vezes o perfil do Tango quebra e o conserto manual era: abrir o OBS, copiar
a chave de transmissão, apagar o perfil, importar o perfil exportado de novo e
colar a chave. Aqui isso é feito pelo WebSocket do OBS:

  1. Recusa se a live estiver no ar (trocar de perfil derrubaria a transmissão).
  2. Guarda a chave atual do Tango (ou usa a que o operador colou) — só em memória.
  3. Apaga o perfil quebrado e cria um novo com o mesmo nome.
  4. Aplica o modelo (server/data/obs/tango_profile/): basic.ini parâmetro a
     parâmetro, servidor RTMPS do Tango + a chave, e o streamEncoder.json
     (keyframe de 1 s, sem B-frames).
  5. Troca de perfil e volta, para o OBS recarregar tudo do disco.

A chave nunca é gravada pelo Odessa, nunca vai para log nem volta na resposta.
As cenas não mudam: perfil e coleção de cenas são coisas separadas no OBS.
"""
from __future__ import annotations

import configparser
import json
import logging
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

from server.core.persona_manager import DATA_DIR

logger = logging.getLogger("odessa.tango_profile")

PROFILE_NAME = "Tango Profile"
TEMP_PROFILE = "Odessa (temporário)"
TEMPLATE_DIR = DATA_DIR / "obs" / "tango_profile"
# Não são do perfil em si (nome é o próprio perfil; Panels é da máquina).
SKIP = {("General", "Name")}


class ProfileError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


def load_template(template_dir: Path = TEMPLATE_DIR) -> Dict[str, Any]:
    parser = configparser.ConfigParser(interpolation=None)
    parser.optionxform = str  # o OBS diferencia maiúsculas nas chaves
    parser.read(template_dir / "basic.ini", encoding="utf-8")
    params: List[Dict[str, str]] = [
        {"parameterCategory": section, "parameterName": key, "parameterValue": value}
        for section in parser.sections()
        for key, value in parser.items(section)
        if (section, key) not in SKIP and section != "Panels"
    ]
    service = json.loads((template_dir / "service.json").read_text(encoding="utf-8"))
    encoder = json.loads((template_dir / "streamEncoder.json").read_text(encoding="utf-8"))
    video = dict(parser.items("Video")) if parser.has_section("Video") else {}
    return {"params": params, "service": service, "encoder": encoder, "video": video}


def obs_profiles_root() -> Path:
    """Pasta de perfis do OBS instalado (%APPDATA%\\obs-studio\\basic\\profiles)."""
    return Path(os.environ.get("APPDATA", str(Path.home() / "AppData" / "Roaming"))) / "obs-studio" / "basic" / "profiles"


def find_profile_dir(name: str, root: Optional[Path] = None) -> Optional[Path]:
    """Pasta do perfil pelo [General] Name do basic.ini (o nome da pasta é sanitizado pelo OBS)."""
    root = root or obs_profiles_root()
    if not root.exists():
        return None
    for ini in root.glob("*/basic.ini"):
        parser = configparser.ConfigParser(interpolation=None, strict=False)
        try:
            parser.read(ini, encoding="utf-8-sig")
        except configparser.Error:
            continue
        if parser.get("General", "Name", fallback="") == name:
            return ini.parent
    return None


def _key_from_profile_file(profiles_root: Optional[Path]) -> str:
    """Chave guardada no service.json do perfil do Tango (quando ele não é o perfil ativo)."""
    folder = find_profile_dir(PROFILE_NAME, profiles_root)
    if not folder or not (folder / "service.json").exists():
        return ""
    try:
        settings = json.loads((folder / "service.json").read_text(encoding="utf-8-sig")).get("settings") or {}
    except (OSError, ValueError):
        return ""  # perfil quebrado: o arquivo pode estar corrompido
    if "tango" not in str(settings.get("server") or "").lower():
        return ""
    return str(settings.get("key") or "").strip()


async def _current_tango_key(obs, profiles_root: Optional[Path] = None) -> str:
    """Chave do Tango: a do perfil ativo, se for o do Tango; senão, a do arquivo do perfil."""
    try:
        data = await obs._call("GetStreamServiceSettings")
        settings = data.get("streamServiceSettings") or {}
        if "tango" in str(settings.get("server") or "").lower() and str(settings.get("key") or "").strip():
            return str(settings["key"]).strip()
    except Exception:  # noqa: BLE001 — perfil quebrado pode nem responder
        pass
    return _key_from_profile_file(profiles_root)


READY_TRIES = 40
PROFILE_TIMEOUT_S = 90
READY_DELAY_S = 0.25


async def _call_when_ready(obs, request: str, data: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Trocar de perfil é assíncrono no OBS: enquanto ele recarrega, pedidos de
    perfil voltam "not ready" (código 207). Espera e tenta de novo."""
    import asyncio

    for attempt in range(READY_TRIES):
        try:
            # Trocar/criar perfil reinicia vídeo e fontes do OBS: no PC da live
            # passava dos 15 s padrão do WebSocket.
            return await obs._call(request, data, timeout=PROFILE_TIMEOUT_S)
        except RuntimeError as exc:
            busy = "not ready" in str(exc).lower() or "code=207" in str(exc)
            just_removed = request == "CreateProfile" and "code=601" in str(exc)
            if not (busy or just_removed):
                raise
            if attempt == READY_TRIES - 1:
                raise
            await asyncio.sleep(READY_DELAY_S)
    return {}


async def _wait_current(obs, name: str) -> None:
    """Espera o OBS terminar de trocar para o perfil `name`."""
    import asyncio

    for _ in range(READY_TRIES):
        listing = await _call_when_ready(obs, "GetProfileList")
        if listing.get("currentProfileName") == name:
            return
        await asyncio.sleep(READY_DELAY_S)
    raise ProfileError(504, f"O OBS não terminou de trocar para o perfil {name}.")


async def _wait_removed(obs, name: str) -> None:
    """Visto no OBS 32: logo depois de RemoveProfile, criar outro com o mesmo
    nome volta "já existe" (601). Espera o perfil sumir da lista."""
    import asyncio

    for _ in range(READY_TRIES):
        listing = await _call_when_ready(obs, "GetProfileList")
        if name not in (listing.get("profiles") or []):
            return
        await asyncio.sleep(READY_DELAY_S)
    raise ProfileError(504, f"O OBS não terminou de apagar o perfil {name}.")


async def rebuild(obs, stream_key: Optional[str] = None, *, profiles_root: Optional[Path] = None, template_dir: Path = TEMPLATE_DIR) -> Dict[str, Any]:
    status = await obs.get_transmission_status()
    if status.get("streamActive") or status.get("virtualCameraActive"):
        raise ProfileError(409, "O OBS está transmitindo (ou com a câmera virtual ligada). Pare antes de recriar o perfil.")

    template = load_template(template_dir)
    key = (stream_key or "").strip()
    reused = False
    if not key:
        key = await _current_tango_key(obs, profiles_root)
        reused = bool(key)
    if not key:
        raise ProfileError(400, "Não achei a chave do Tango no OBS. Cole a chave de transmissão do Tango e tente de novo.")

    listing = await _call_when_ready(obs, "GetProfileList")
    names: List[str] = list(listing.get("profiles") or [])
    temp_created = False

    async def switch_to_other() -> str:
        nonlocal temp_created
        other = next((n for n in names if n != PROFILE_NAME), None)
        if other:
            await _call_when_ready(obs, "SetCurrentProfile", {"profileName": other})
        else:
            await _call_when_ready(obs, "CreateProfile", {"profileName": TEMP_PROFILE})  # já vira o atual
            names.append(TEMP_PROFILE)
            temp_created = True
            other = TEMP_PROFILE
        await _wait_current(obs, other)
        return other

    # 1. Tira o perfil quebrado (não dá para apagar o perfil em uso).
    if PROFILE_NAME in names:
        if listing.get("currentProfileName") == PROFILE_NAME:
            await switch_to_other()
        await _call_when_ready(obs, "RemoveProfile", {"profileName": PROFILE_NAME})
        await _wait_removed(obs, PROFILE_NAME)
        names.remove(PROFILE_NAME)

    # 2. Perfil novo com o modelo.
    await _call_when_ready(obs, "CreateProfile", {"profileName": PROFILE_NAME})
    await _wait_current(obs, PROFILE_NAME)
    for param in template["params"]:
        await _call_when_ready(obs, "SetProfileParameter", param)
    service = template["service"]
    await _call_when_ready(
        obs,
        "SetStreamServiceSettings",
        {
            "streamServiceType": service.get("type") or "rtmp_custom",
            "streamServiceSettings": {**(service.get("settings") or {}), "key": key},
        },
    )
    profile_dir = find_profile_dir(PROFILE_NAME, profiles_root)
    if profile_dir:
        (profile_dir / "streamEncoder.json").write_text(json.dumps(template["encoder"]), encoding="utf-8")
    else:
        logger.warning("[perfil Tango] pasta do perfil não encontrada: streamEncoder.json não aplicado")

    # 3. Sai e volta: o OBS recarrega saída, vídeo e encoder do disco.
    await switch_to_other()
    await _call_when_ready(obs, "SetCurrentProfile", {"profileName": PROFILE_NAME})
    await _wait_current(obs, PROFILE_NAME)
    if temp_created:
        await _call_when_ready(obs, "RemoveProfile", {"profileName": TEMP_PROFILE})

    # 4. O "Preparar OBS" passa a usar a tela do perfil do Tango (não força 1080x1920).
    video = template["video"]
    width = int(video.get("BaseCX") or 720)
    height = int(video.get("BaseCY") or 1280)
    obs.canvas_width, obs.canvas_height = width, height
    obs._save_settings()

    logger.info("[perfil Tango] perfil recriado (chave %s)", "reaproveitada do OBS" if reused else "colada pelo operador")
    return {
        "ok": True,
        "profile": PROFILE_NAME,
        "keyReused": reused,
        "encoderApplied": bool(profile_dir),
        "canvas": {"width": width, "height": height},
    }
