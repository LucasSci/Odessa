"""
browser_discovery.py — navegadores baseados em Chromium instalados na máquina.

A bridge do Tango fala CDP, então serve qualquer navegador Chromium: Edge,
Chrome, Brave, Opera, Vivaldi. Firefox não fala CDP e fica de fora.

Ordem do "Automático": navegador padrão do sistema (se for Chromium) → Edge
(vem com todo Windows 10/11) → Chrome → os demais. O usuário pode fixar um
navegador nas configurações da bridge (`browser` no bridge config).
"""
from __future__ import annotations

import os
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

AUTO = "auto"


@dataclass(frozen=True)
class BrowserSpec:
    id: str
    name: str
    exe: str  # nome do executável em App Paths
    paths: tuple[str, ...]  # caminhos conhecidos (com variáveis de ambiente)
    prog_ids: tuple[str, ...]  # ProgId de "navegador padrão"
    playwright_channel: str | None  # channel do Playwright, quando existe


SPECS: tuple[BrowserSpec, ...] = (
    BrowserSpec(
        "edge", "Microsoft Edge", "msedge.exe",
        (r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe", r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"),
        ("MSEdgeHTM",), "msedge",
    ),
    BrowserSpec(
        "chrome", "Google Chrome", "chrome.exe",
        (r"%ProgramFiles%\Google\Chrome\Application\chrome.exe", r"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe",
         r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
        ("ChromeHTML",), "chrome",
    ),
    BrowserSpec(
        "brave", "Brave", "brave.exe",
        (r"%ProgramFiles%\BraveSoftware\Brave-Browser\Application\brave.exe", r"%LOCALAPPDATA%\BraveSoftware\Brave-Browser\Application\brave.exe"),
        ("BraveHTML",), None,
    ),
    BrowserSpec(
        "opera", "Opera", "opera.exe",
        (r"%LOCALAPPDATA%\Programs\Opera\opera.exe",),
        ("OperaStable",), None,
    ),
    BrowserSpec(
        "vivaldi", "Vivaldi", "vivaldi.exe",
        (r"%LOCALAPPDATA%\Vivaldi\Application\vivaldi.exe", r"%ProgramFiles%\Vivaldi\Application\vivaldi.exe"),
        ("VivaldiHTM",), None,
    ),
)

AUTO_ORDER = ("edge", "chrome", "brave", "vivaldi", "opera")


@dataclass
class BrowserInfo:
    id: str
    name: str
    path: str
    isDefault: bool
    playwrightChannel: str | None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _app_path(exe: str) -> str | None:
    """Caminho registrado em HKLM/HKCU\\...\\App Paths\\<exe> (Windows)."""
    if sys.platform != "win32":
        return None
    import winreg

    key = rf"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\{exe}"
    for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
        try:
            with winreg.OpenKey(hive, key) as handle:
                value, _ = winreg.QueryValueEx(handle, "")
                if value and Path(value).exists():
                    return str(value)
        except OSError:
            continue
    return None


def default_prog_id() -> str | None:
    """ProgId do navegador padrão para https (ex.: MSEdgeHTM, ChromeHTML)."""
    if sys.platform != "win32":
        return None
    import winreg

    key = r"Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice"
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key) as handle:
            value, _ = winreg.QueryValueEx(handle, "ProgId")
            return str(value)
    except OSError:
        return None


def _find_path(spec: BrowserSpec) -> str | None:
    found = _app_path(spec.exe)
    if found:
        return found
    for raw in spec.paths:
        candidate = os.path.expandvars(raw)
        if "%" not in candidate and Path(candidate).exists():
            return candidate
    return None


def list_browsers() -> list[BrowserInfo]:
    """Navegadores Chromium instalados, na ordem da lista de suporte."""
    prog_id = default_prog_id() or ""
    browsers = []
    for spec in SPECS:
        path = _find_path(spec)
        if not path:
            continue
        browsers.append(BrowserInfo(
            id=spec.id,
            name=spec.name,
            path=path,
            isDefault=any(prog_id.startswith(p) for p in spec.prog_ids),
            playwrightChannel=spec.playwright_channel,
        ))
    return browsers


def resolve_browser(preference: str | None) -> BrowserInfo | None:
    """Escolhe o navegador: o fixado pelo usuário, senão o "Automático"."""
    browsers = list_browsers()
    by_id = {b.id: b for b in browsers}
    wanted = (preference or AUTO).strip().lower()
    if wanted != AUTO and wanted in by_id:
        return by_id[wanted]
    default = next((b for b in browsers if b.isDefault), None)
    if default:
        return default
    for browser_id in AUTO_ORDER:
        if browser_id in by_id:
            return by_id[browser_id]
    return None


def browsers_payload(preference: str | None) -> dict[str, Any]:
    browsers = list_browsers()
    chosen = resolve_browser(preference)
    return {
        "preference": (preference or AUTO),
        "resolved": chosen.to_dict() if chosen else None,
        "browsers": [b.to_dict() for b in browsers],
    }
