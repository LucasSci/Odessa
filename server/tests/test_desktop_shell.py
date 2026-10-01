"""O programa desktop (desktop/shell, Electron) herdou o que o launcher PowerShell
fazia: rotação de log, porta ocupada, assinatura do servidor e supervisor de
quedas. Os testes ficam em JS (node:test); aqui eles rodam junto da suíte."""
import shutil
import subprocess
from pathlib import Path

import pytest

SHELL = Path(__file__).resolve().parents[2] / "desktop" / "shell"


@pytest.mark.skipif(shutil.which("node") is None, reason="Node não instalado")
def test_programa_desktop():
    result = subprocess.run(
        ["node", "--test", "backend-utils.test.js"],
        cwd=SHELL, capture_output=True, text=True, timeout=120,
    )
    assert result.returncode == 0, result.stdout + result.stderr
