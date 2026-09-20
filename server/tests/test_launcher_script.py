import socket
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

LAUNCHER = Path(__file__).resolve().parents[2] / "desktop" / "launcher" / "start-odessa.ps1"

pytestmark = pytest.mark.skipif(sys.platform != "win32", reason="launcher é PowerShell do instalador Windows")


def run_ps(script: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
        capture_output=True,
        text=True,
        timeout=120,
    )


def load_functions(*names: str) -> str:
    """Trecho PowerShell que define só as funções pedidas do launcher (sem rodar o script)."""
    wanted = ", ".join(f"'{name}'" for name in names)
    return textwrap.dedent(
        f"""
        $ErrorActionPreference = 'Stop'
        $tokens = $null; $errors = $null
        $ast = [System.Management.Automation.Language.Parser]::ParseFile('{LAUNCHER}', [ref]$tokens, [ref]$errors)
        if ($errors.Count) {{ throw 'launcher com erro de sintaxe' }}
        $ast.FindAll({{ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and @({wanted}) -contains $n.Name }}, $true) |
            ForEach-Object {{ . ([scriptblock]::Create($_.Extent.Text)) }}
        """
    )


def test_launcher_sem_erro_de_sintaxe_e_com_bom_para_acentos():
    assert LAUNCHER.read_bytes()[:3] == b"\xef\xbb\xbf", "sem BOM o PowerShell 5.1 lê os acentos como ANSI"
    result = run_ps(load_functions("Rotate-Log"))
    assert result.returncode == 0, result.stderr


def test_rotacao_de_log_guarda_cinco_copias(tmp_path):
    log = tmp_path / "odessa.log"
    script = load_functions("Rotate-Log") + textwrap.dedent(
        f"""
        $log = '{log}'
        1..7 | ForEach-Object {{
            Set-Content -Path $log -Value ('x' * 200) -NoNewline
            Set-Content -Path $log -Value ("rodada-$_" + ('x' * 200)) -NoNewline
            Rotate-Log $log 100 5
        }}
        """
    )
    result = run_ps(script)
    assert result.returncode == 0, result.stderr
    names = sorted(p.name for p in tmp_path.iterdir())
    assert names == ["odessa.log.1", "odessa.log.2", "odessa.log.3", "odessa.log.4", "odessa.log.5"]
    assert "rodada-7" in (tmp_path / "odessa.log.1").read_text()


def test_log_pequeno_nao_e_rotacionado(tmp_path):
    log = tmp_path / "odessa.log"
    log.write_text("curto")
    result = run_ps(load_functions("Rotate-Log") + f"Rotate-Log '{log}' 1000 5")
    assert result.returncode == 0, result.stderr
    assert [p.name for p in tmp_path.iterdir()] == ["odessa.log"]


def test_porta_ocupada_e_detectada():
    with socket.socket() as server:
        server.bind(("127.0.0.1", 0))
        server.listen(1)
        port = server.getsockname()[1]
        result = run_ps(load_functions("Test-PortInUse") + f"Test-PortInUse {port}")
    assert result.stdout.strip() == "True", result.stdout + result.stderr


def test_porta_livre_nao_e_ocupada():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    result = run_ps(load_functions("Test-PortInUse") + f"Test-PortInUse {port}")
    assert result.stdout.strip() == "False", result.stdout + result.stderr


def _serve_health(body: bytes):
    import http.server
    import threading

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


@pytest.mark.parametrize(
    "body, expected",
    [
        (b'{"status":"ok","service":"odessa-api"}', "True"),
        (b'{"status":"ok","service":"outro-programa"}', "False"),
        (b"<html>OK</html>", "False"),
    ],
)
def test_assinatura_do_backend_so_aceita_o_odessa(body, expected):
    server = _serve_health(body)
    try:
        port = server.server_address[1]
        script = load_functions("Test-OdessaBackend") + f"$healthUrl = 'http://127.0.0.1:{port}/health'\nTest-OdessaBackend"
        result = run_ps(script)
    finally:
        server.shutdown()
    assert result.stdout.strip() == expected, result.stdout + result.stderr
