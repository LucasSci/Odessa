"""
tango_profile.py — Configuração limpa do perfil "Tango Profile" no OBS.

O conserto manual era: abrir o OBS, apagar o perfil, importar o .zip do Tango
de novo e colar a chave. Na prática isso deixava perfis duplicados com o mesmo
nome (pastas "TangoProfile (7)", "TangoProfile2"…), telas diferentes do modelo
e uma chave que **vence a cada 30 dias** (a chave do Tango é um token com data).

A versão anterior fazia tudo pelo WebSocket do OBS, mas trocar de perfil ali é
assíncrono e falhava ("not ready", "já existe", tempo esgotado). Esta escreve
o perfil direto nos arquivos do OBS, com o OBS fechado:

  1. Recusa se a live estiver no ar.
  2. Fecha o OBS normalmente (como clicar no X) e espera ele sair.
  3. Copia os perfis do Tango para um backup e apaga todos (inclusive duplicados).
  4. Escreve um único "Tango Profile" com o modelo (ou o .zip enviado) e a chave.
  5. Marca o perfil como ativo e abre o OBS de novo (se ele estava aberto).

A chave vem, nesta ordem: colada na tela → do .zip → a do perfil atual, se não
estiver vencida. O Odessa nunca grava a chave fora da pasta do perfil (onde o
próprio OBS a guarda), nunca a registra em log e nunca a devolve nas respostas.
As cenas não mudam: coleção de cenas e perfil são coisas separadas no OBS.
"""
from __future__ import annotations

import base64
import configparser
import io
import json
import logging
import os
import shutil
import subprocess
import time
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from server.core.persona_manager import DATA_DIR

logger = logging.getLogger("odessa.tango_profile")

PROFILE_NAME = "Tango Profile"
PROFILE_DIR_NAME = "Tango_Profile"
TEMPLATE_DIR = DATA_DIR / "obs" / "tango_profile"
BACKUP_DIR_NAME = "odessa-backup-perfis"
KEEP_BACKUPS = 5
EXPIRING_SOON_DAYS = 7  # uma semana de aviso: a chave do Tango dura 30 dias
ZIP_MAX_BYTES = 2 * 1024 * 1024
# Parâmetros que precisam bater com o modelo do Tango (o resto é preferência).
CHECKED_PARAMS = [
    ("Output", "Mode"),
    ("Video", "BaseCX"),
    ("Video", "BaseCY"),
    ("Video", "OutputCX"),
    ("Video", "OutputCY"),
    ("Video", "FPSCommon"),
]


class ProfileError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


# ── Arquivos do OBS ─────────────────────────────────────────────────────────


def obs_config_root() -> Path:
    """%APPDATA%\\obs-studio"""
    return Path(os.environ.get("APPDATA", str(Path.home() / "AppData" / "Roaming"))) / "obs-studio"


def _read_ini(path: Path) -> configparser.ConfigParser:
    parser = configparser.ConfigParser(interpolation=None, strict=False)
    parser.optionxform = str  # o OBS diferencia maiúsculas nas chaves
    try:
        parser.read(path, encoding="utf-8-sig")
    except configparser.Error:
        pass
    return parser


def _ini_text(parser: configparser.ConfigParser) -> str:
    """Grava no formato do OBS (Chave=Valor, sem espaços)."""
    lines: List[str] = []
    for section in parser.sections():
        lines.append(f"[{section}]")
        lines.extend(f"{key}={value}" for key, value in parser.items(section))
        lines.append("")
    return "\n".join(lines)


def _read_service(folder: Path) -> Dict[str, Any]:
    try:
        return json.loads((folder / "service.json").read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        return {}


def key_expiry(key: str) -> Optional[datetime]:
    """Data de validade da chave do Tango (é um token JWT); None se não tiver."""
    parts = (key or "").split(".")
    if len(parts) != 3:
        return None
    try:
        payload = json.loads(base64.urlsafe_b64decode(parts[1] + "=" * (-len(parts[1]) % 4)))
        return datetime.fromtimestamp(int(payload["exp"]), tz=timezone.utc)
    except (ValueError, KeyError, TypeError):
        return None


def describe_key(key: str, now: Optional[datetime] = None) -> Dict[str, Any]:
    """Estado da chave sem a chave."""
    now = now or datetime.now(timezone.utc)
    if not key:
        return {"present": False, "expiresAt": None, "daysLeft": None, "expired": False, "expiringSoon": False}
    exp = key_expiry(key)
    if exp is None:
        return {"present": True, "expiresAt": None, "daysLeft": None, "expired": False, "expiringSoon": False}
    days = (exp - now).total_seconds() / 86400
    return {
        "present": True,
        "expiresAt": exp.isoformat(),
        "daysLeft": round(days, 1),
        "expired": days <= 0,
        "expiringSoon": 0 < days <= EXPIRING_SOON_DAYS,
    }


def _is_tango_profile(folder: Path) -> bool:
    name = _read_ini(folder / "basic.ini").get("General", "Name", fallback="")
    server = str((_read_service(folder).get("settings") or {}).get("server") or "")
    return name == PROFILE_NAME or "tango.me" in server.lower()


def _active_profile(root: Path) -> Dict[str, str]:
    for name in ("user.ini", "global.ini"):
        parser = _read_ini(root / name)
        if parser.has_option("Basic", "ProfileDir") or parser.has_option("Basic", "Profile"):
            return {
                "name": parser.get("Basic", "Profile", fallback=""),
                "folder": parser.get("Basic", "ProfileDir", fallback=""),
                "file": name,
            }
    return {"name": "", "folder": "", "file": ""}


def load_template(template_dir: Path = TEMPLATE_DIR) -> Dict[str, Any]:
    basic = _read_ini(template_dir / "basic.ini")
    service = json.loads((template_dir / "service.json").read_text(encoding="utf-8"))
    encoder = json.loads((template_dir / "streamEncoder.json").read_text(encoding="utf-8"))
    return {"basic": basic, "service": service, "encoder": encoder}


def template_from_zip(data: bytes) -> Dict[str, Any]:
    """Modelo a partir do .zip exportado pelo Tango (só os 3 arquivos conhecidos)."""
    if len(data) > ZIP_MAX_BYTES:
        raise ProfileError(400, "O .zip do perfil é grande demais (o do Tango tem poucos KB).")
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise ProfileError(400, "Esse arquivo não é um .zip de perfil do OBS.") from exc
    # Só pelo nome do arquivo (ignora pastas): nada é extraído para o disco.
    files = {Path(info.filename).name: info for info in archive.infolist() if not info.is_dir()}
    if "basic.ini" not in files:
        raise ProfileError(400, "O .zip não tem o basic.ini de um perfil do OBS.")

    def read(name: str) -> Optional[str]:
        info = files.get(name)
        if info is None or info.file_size > 256 * 1024:
            return None
        return archive.read(info).decode("utf-8-sig")

    basic = configparser.ConfigParser(interpolation=None, strict=False)
    basic.optionxform = str
    basic.read_string(read("basic.ini") or "")
    service = json.loads(read("service.json") or "{}")
    encoder = json.loads(read("streamEncoder.json") or "{}")
    if not encoder:
        encoder = load_template()["encoder"]
    return {"basic": basic, "service": service, "encoder": encoder}


# ── Diagnóstico ─────────────────────────────────────────────────────────────


def status(root: Optional[Path] = None, *, obs_running: Optional[bool] = None, template_dir: Path = TEMPLATE_DIR) -> Dict[str, Any]:
    root = root or obs_config_root()
    profiles_dir = root / "basic" / "profiles"
    template = load_template(template_dir)["basic"]
    active = _active_profile(root)
    found: List[Dict[str, Any]] = []
    if profiles_dir.exists():
        for folder in sorted(p for p in profiles_dir.iterdir() if (p / "basic.ini").exists()):
            if not _is_tango_profile(folder):
                continue
            basic = _read_ini(folder / "basic.ini")
            settings = _read_service(folder).get("settings") or {}
            differences = [
                f"{section}.{key}: {basic.get(section, key, fallback='—')} (modelo {template.get(section, key)})"
                for section, key in CHECKED_PARAMS
                if template.has_option(section, key) and basic.get(section, key, fallback=None) != template.get(section, key)
            ]
            found.append(
                {
                    "name": basic.get("General", "Name", fallback=folder.name),
                    "folder": folder.name,
                    "active": folder.name == active["folder"],
                    "canvas": f"{basic.get('Video', 'BaseCX', fallback='?')}×{basic.get('Video', 'BaseCY', fallback='?')}",
                    "differences": differences,
                    "key": describe_key(str(settings.get("key") or "")),
                }
            )

    problems: List[str] = []
    if not found:
        problems.append("Não há perfil do Tango no OBS.")
    if len(found) > 1:
        problems.append(f"{len(found)} perfis do Tango (pastas {', '.join(p['folder'] for p in found)}): o OBS pode usar o errado.")
    current = next((p for p in found if p["active"]), None)
    if found and current is None:
        problems.append("O perfil ativo no OBS não é o do Tango.")
    for profile in found:
        tag = f"Perfil na pasta {profile['folder']}"
        if profile["differences"]:
            problems.append(f"{tag} diferente do modelo do Tango: {'; '.join(profile['differences'])}.")
        key = profile["key"]
        if not key["present"]:
            problems.append(f"{tag} sem chave de transmissão.")
        elif key["expired"]:
            problems.append(f"{tag}: a chave do Tango venceu. Gere uma nova no Tango.")
        elif key["expiringSoon"]:
            problems.append(f"{tag}: a chave do Tango vence em {key['daysLeft']:.0f} dia(s).")
    return {
        "ok": not problems,
        "obsRunning": obs_running,
        "activeProfile": active["name"],
        "profiles": found,
        "problems": problems,
    }


# ── Processo do OBS ─────────────────────────────────────────────────────────


def _obs_processes() -> List[Dict[str, Any]]:
    """[{pid, path}] do obs64.exe em execução (Windows)."""
    try:
        out = subprocess.run(
            [
                "powershell", "-NoProfile", "-Command",
                "Get-CimInstance Win32_Process -Filter \"Name='obs64.exe'\" | ForEach-Object { \"$($_.ProcessId)|$($_.ExecutablePath)\" }",
            ],
            capture_output=True, text=True, timeout=20,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return []
    procs = []
    for line in out.splitlines():
        pid, _, path = line.strip().partition("|")
        if pid.isdigit():
            procs.append({"pid": int(pid), "path": path})
    return procs


def obs_executable(running: Optional[List[Dict[str, Any]]] = None) -> Optional[Path]:
    for proc in running or []:
        if proc.get("path"):
            return Path(proc["path"])
    try:
        import winreg

        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\OBS Studio") as key:
            install = Path(winreg.QueryValue(key, None))
            candidate = install / "bin" / "64bit" / "obs64.exe"
            if candidate.exists():
                return candidate
    except OSError:
        pass
    default = Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "obs-studio" / "bin" / "64bit" / "obs64.exe"
    return default if default.exists() else None


def close_obs(timeout_s: float = 25.0) -> bool:
    """Pede para o OBS fechar como no X (sem matar) e espera."""
    subprocess.run(
        ["taskkill", "/IM", "obs64.exe"],
        capture_output=True, timeout=15,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        if not _obs_processes():
            return True
        time.sleep(1)
    return False


def start_obs(executable: Path) -> None:
    # O OBS precisa abrir com a pasta dele como diretório atual (procura os
    # arquivos de idioma a partir dela).
    subprocess.Popen(
        [str(executable)],
        cwd=str(executable.parent),
        creationflags=getattr(subprocess, "DETACHED_PROCESS", 0) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0),
        close_fds=True,
    )


# ── Configuração limpa ──────────────────────────────────────────────────────


def _set_active_profile(root: Path, name: str, folder: str) -> None:
    """Edita só as linhas Profile/ProfileDir de [Basic], preservando o resto."""
    target = next((root / f for f in ("user.ini", "global.ini") if (root / f).exists()), root / "user.ini")
    text = target.read_text(encoding="utf-8-sig") if target.exists() else ""
    lines = text.splitlines()
    out: List[str] = []
    in_basic = False
    done = {"Profile": False, "ProfileDir": False}

    def flush_missing() -> None:
        for key, value in (("Profile", name), ("ProfileDir", folder)):
            if not done[key]:
                out.append(f"{key}={value}")
                done[key] = True

    for line in lines:
        stripped = line.strip()
        if stripped.startswith("[") and stripped.endswith("]"):
            if in_basic:
                flush_missing()
            in_basic = stripped == "[Basic]"
        elif in_basic and "=" in stripped:
            key = stripped.split("=", 1)[0]
            if key in done:
                out.append(f"{key}={name if key == 'Profile' else folder}")
                done[key] = True
                continue
        out.append(line)
    if in_basic:
        flush_missing()
    if not done["Profile"]:
        out.extend(["", "[Basic]", f"Profile={name}", f"ProfileDir={folder}"])
    target.write_text("\n".join(out) + "\n", encoding="utf-8")


def _prune_backups(backup_root: Path) -> None:
    runs = sorted((p for p in backup_root.iterdir() if p.is_dir()), key=lambda p: p.name)
    for old in runs[:-KEEP_BACKUPS]:
        shutil.rmtree(old, ignore_errors=True)


def write_clean_profile(root: Path, template: Dict[str, Any], key: str) -> Dict[str, Any]:
    """Com o OBS fechado: backup + remove os perfis do Tango + escreve um só, ativo."""
    profiles_dir = root / "basic" / "profiles"
    profiles_dir.mkdir(parents=True, exist_ok=True)
    old = [p for p in profiles_dir.iterdir() if (p / "basic.ini").exists() and _is_tango_profile(p)]

    backup = None
    if old:
        backup = root / "basic" / BACKUP_DIR_NAME / datetime.now().strftime("%Y%m%d-%H%M%S")
        backup.mkdir(parents=True, exist_ok=True)
        for folder in old:
            shutil.copytree(folder, backup / folder.name)
        for folder in old:
            shutil.rmtree(folder)
        _prune_backups(backup.parent)

    target = profiles_dir / PROFILE_DIR_NAME
    target.mkdir(parents=True, exist_ok=True)
    basic: configparser.ConfigParser = template["basic"]
    basic.remove_section("Panels")  # posição dos painéis é da máquina de quem exportou
    if not basic.has_section("General"):
        basic.add_section("General")
    basic.set("General", "Name", PROFILE_NAME)
    (target / "basic.ini").write_text(_ini_text(basic), encoding="utf-8")

    service = dict(template["service"] or {})
    settings = dict(service.get("settings") or {})
    settings.setdefault("server", "rtmps://ingest.rtmp.tango.me/")
    settings["key"] = key
    service["type"] = service.get("type") or "rtmp_custom"
    service["settings"] = settings
    (target / "service.json").write_text(json.dumps(service, indent=4), encoding="utf-8")
    (target / "streamEncoder.json").write_text(json.dumps(template["encoder"]), encoding="utf-8")

    _set_active_profile(root, PROFILE_NAME, PROFILE_DIR_NAME)
    return {"removed": [p.name for p in old], "backup": str(backup) if backup else None, "folder": target.name}


async def clean_setup(
    obs,
    stream_key: Optional[str] = None,
    zip_bytes: Optional[bytes] = None,
    *,
    root: Optional[Path] = None,
    template_dir: Path = TEMPLATE_DIR,
    processes: Callable[[], List[Dict[str, Any]]] = _obs_processes,
    closer: Callable[[], bool] = close_obs,
    starter: Callable[[Path], None] = start_obs,
) -> Dict[str, Any]:
    import asyncio

    root = root or obs_config_root()
    running = await asyncio.to_thread(processes)

    # 1. Live no ar: nunca mexe. Com o OBS aberto, só segue se der para conferir.
    if running:
        try:
            transmission = await obs.get_transmission_status()
        except Exception as exc:  # noqa: BLE001
            raise ProfileError(
                409,
                "O OBS está aberto, mas não consegui confirmar que a live está parada (WebSocket do OBS). "
                "Feche o OBS e tente de novo.",
            ) from exc
        if transmission.get("streamActive") or transmission.get("virtualCameraActive"):
            raise ProfileError(409, "A live está no ar (ou a câmera virtual ligada). Pare antes da configuração limpa.")

    # 2. Modelo e chave (antes de fechar o OBS: um erro aqui não derruba nada).
    template = template_from_zip(zip_bytes) if zip_bytes else load_template(template_dir)
    zip_key = str((template["service"].get("settings") or {}).get("key") or "").strip() if zip_bytes else ""
    pasted = (stream_key or "").strip()
    current_key = ""
    current = status(root, template_dir=template_dir)
    active_profile = next((p for p in current["profiles"] if p["active"]), None) or (current["profiles"] or [None])[0]
    if active_profile:
        current_key = str((_read_service(root / "basic" / "profiles" / active_profile["folder"]).get("settings") or {}).get("key") or "").strip()

    if pasted:
        key, source = pasted, "colada"
    elif zip_key:
        key, source = zip_key, "zip"
    elif current_key:
        key, source = current_key, "perfil atual"
    else:
        raise ProfileError(400, "Não achei a chave do Tango. Cole a chave de transmissão do Tango e tente de novo.")
    info = describe_key(key)
    if info["expired"]:
        when = datetime.fromisoformat(info["expiresAt"]).astimezone().strftime("%d/%m %H:%M")
        raise ProfileError(
            400,
            f"A chave {'colada' if source == 'colada' else 'do ' + source} venceu em {when}. Gere uma nova no Tango e cole aqui.",
        )

    # 3. Fecha o OBS (como no X), escreve e abre de novo.
    executable = obs_executable(running)
    if running:
        try:
            await obs.disconnect()
        except Exception:  # noqa: BLE001
            pass
        if not await asyncio.to_thread(closer):
            raise ProfileError(409, "O OBS não fechou (talvez esteja pedindo confirmação). Feche o OBS e tente de novo.")

    result = await asyncio.to_thread(write_clean_profile, root, template, key)

    restarted = False
    if running and executable:
        await asyncio.to_thread(starter, executable)
        restarted = True

    basic = template["basic"]
    width = int(basic.get("Video", "BaseCX", fallback="720"))
    height = int(basic.get("Video", "BaseCY", fallback="1280"))
    # O "Preparar OBS" passa a usar a tela do perfil do Tango.
    obs.canvas_width, obs.canvas_height = width, height
    obs._save_settings()

    logger.info(
        "[perfil Tango] configuração limpa: %d perfil(is) antigo(s) removido(s), chave %s, OBS %s",
        len(result["removed"]), source, "reaberto" if restarted else "estava fechado",
    )
    return {
        "ok": True,
        "profile": PROFILE_NAME,
        "folder": result["folder"],
        "removed": result["removed"],
        "backup": result["backup"],
        "keySource": source,
        "key": info,
        "obsRestarted": restarted,
        "obsWasRunning": bool(running),
        "canvas": {"width": width, "height": height},
    }
