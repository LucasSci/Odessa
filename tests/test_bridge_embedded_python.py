"""A bridge precisa subir no Python embutido do instalador.

O python312._pth do runtime embutido NÃO põe a pasta do script no sys.path
(ao contrário do Python comum). Sem tratar isso, `import bridge_guard` falhava
e a bridge morria no início só na versão instalada — o modo extensão ficava
"aguardando" para sempre. `python -I` reproduz o mesmo sys.path restrito.
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_tango_chat_importa_sem_a_pasta_do_script_no_sys_path(tmp_path):
    script = ROOT / "tango_chat" / "tango_chat.py"
    code = (
        "import importlib.util, sys\n"
        f"spec = importlib.util.spec_from_file_location('tango_chat_embedded', r'{script}')\n"
        "mod = importlib.util.module_from_spec(spec)\n"
        "sys.modules[spec.name] = mod\n"
        "spec.loader.exec_module(mod)\n"
        "print('ok', mod.bridge_guard.__name__)\n"
    )
    result = subprocess.run(
        [sys.executable, "-I", "-c", code],
        cwd=tmp_path,  # longe do repositório: nada de import "por acaso" pela pasta atual
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stderr[-2000:]
    assert "ok bridge_guard" in result.stdout
