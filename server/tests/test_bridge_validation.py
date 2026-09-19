import asyncio

import pytest

from server.services import bridge_manager
from server.services.bridge_manager import validate_chrome_target


def test_aceita_url_http_e_porta_valida():
    url, port = validate_chrome_target("  https://tango.me/stream/broadcast  ", "9222")
    assert url == "https://tango.me/stream/broadcast"
    assert port == 9222


@pytest.mark.parametrize("bad_url", [
    "--renderer-cmd-prefix=calc.exe",
    "-x",
    "file:///C:/Windows/System32/calc.exe",
    "javascript:alert(1)",
    "chrome://settings",
    "https://tango.me/ --new-window",
    'https://tango.me/"; calc',
    "https://tango.me/`x`",
    "https://",
    "tango.me/sem-esquema",
    "",
    None,
    123,
])
def test_rejeita_urls_perigosas_ou_invalidas(bad_url):
    with pytest.raises(ValueError):
        validate_chrome_target(bad_url, 9222)


@pytest.mark.parametrize("bad_port", [0, 80, 1023, 65536, -5, "abc", None, "9222; calc"])
def test_rejeita_portas_fora_do_intervalo(bad_port):
    with pytest.raises(ValueError):
        validate_chrome_target("https://tango.me/", bad_port)


def test_launch_nao_dispara_processo_com_url_maliciosa(monkeypatch):
    called = []
    monkeypatch.setattr(bridge_manager, "find_chrome_executable", lambda: "C:/chrome.exe")
    monkeypatch.setattr(bridge_manager.subprocess, "Popen", lambda *a, **k: called.append(a))
    result = asyncio.run(bridge_manager.launch_chrome_for_live(url="--renderer-cmd-prefix=calc.exe", port=9222))
    assert result["ok"] is False
    assert called == []


def test_launch_valido_usa_dois_hifens_antes_da_url(monkeypatch, tmp_path):
    captured = {}
    monkeypatch.setattr(bridge_manager, "find_chrome_executable", lambda: "C:/chrome.exe")
    monkeypatch.setattr(bridge_manager, "RUNTIME_DIR", tmp_path)
    monkeypatch.setattr(bridge_manager.subprocess, "Popen", lambda args, **k: captured.setdefault("args", args))
    result = asyncio.run(bridge_manager.launch_chrome_for_live(url="https://tango.me/x", port=9333))
    assert result["ok"] is True
    args = captured["args"]
    assert args[-2:] == ["--", "https://tango.me/x"]
    assert "--remote-debugging-port=9333" in args


def test_atalho_recusa_url_maliciosa(monkeypatch):
    monkeypatch.setattr(bridge_manager, "find_chrome_executable", lambda: "C:/chrome.exe")
    result = bridge_manager.create_desktop_shortcut(url='https://x.test/" --evil', port=9222)
    assert result["ok"] is False
