import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "desktop" / "verify-stage.ps1"

pytestmark = pytest.mark.skipif(sys.platform != "win32", reason="verify-stage.ps1 é PowerShell do instalador Windows")


def run(stage: Path):
    return subprocess.run(
        ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(SCRIPT), "-StageDir", str(stage)],
        capture_output=True,
        text=True,
        timeout=120,
    )


def make_clean_stage(tmp_path: Path) -> Path:
    stage = tmp_path / "stage"
    (stage / "server" / "data").mkdir(parents=True)
    (stage / "server" / "data" / "personas.json").write_text('{"personas": []}', encoding="utf-8")
    (stage / "server" / "main.py").write_text("print('ok')\n", encoding="utf-8")
    (stage / "tango_chat").mkdir()
    (stage / "tango_chat" / "tango_chat.py").write_text("x = 1\n", encoding="utf-8")
    (stage / "launcher").mkdir()
    (stage / "launcher" / "start.ps1").write_text("Write-Host ok\n", encoding="utf-8")
    return stage


def test_stage_limpo_passa(tmp_path):
    result = run(make_clean_stage(tmp_path))
    assert result.returncode == 0, result.stdout + result.stderr
    assert "verificado" in result.stdout.lower()


@pytest.mark.parametrize("relative", [
    "server/data/logs/execution.jsonl",
    "server/data/personas.json.bak",
    "server/data/persona_x.json.corrupt-20260101-000000",
    "server/runtime/state.json",
    "server/tests/test_algo.py",
    "server/.env",
    "server/.env.production",
    "server/data/app.db",
    "tango_chat/debug.log",
    "launcher/chave.pem",
])
def test_itens_proibidos_falham_o_build(tmp_path, relative):
    stage = make_clean_stage(tmp_path)
    target = stage / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("conteudo", encoding="utf-8")
    result = run(stage)
    assert result.returncode != 0
    assert "NAO devem ir no instalador" in result.stdout or "verify-stage falhou" in (result.stdout + result.stderr)


def test_env_example_e_permitido(tmp_path):
    stage = make_clean_stage(tmp_path)
    (stage / "server" / ".env.example").write_text("CHAVE=\n", encoding="utf-8")
    assert run(stage).returncode == 0


@pytest.mark.parametrize("secret", [
    'GEMINI = "AIza' + "A" * 35 + '"',
    "token = 'sk-" + "a" * 30 + "'",
    "-----BEGIN PRIVATE KEY-----",
    'API_TOKEN = "' + "Ab1" * 12 + '"',
    "ghp_" + "a" * 36,
])
def test_segredo_em_texto_falha_sem_imprimir_o_valor(tmp_path, secret):
    stage = make_clean_stage(tmp_path)
    (stage / "server" / "config_local.py").write_text(secret + "\n", encoding="utf-8")
    result = run(stage)
    assert result.returncode != 0
    output = result.stdout + result.stderr
    assert "possivel segredo" in output
    assert "AIza" not in output.replace("chave Google", "") or "AAAA" not in output  # o valor não é impresso
    assert "a" * 30 not in output


def test_palavras_parecidas_nao_geram_falso_positivo(tmp_path):
    stage = make_clean_stage(tmp_path)
    (stage / "server" / "notas.py").write_text(
        "# risk-management-and-task-scheduling-strategy is fine; disk-usage-report\n"
        "api_key = os.environ['GEMINI_API_KEY']\n",
        encoding="utf-8",
    )
    assert run(stage).returncode == 0


def test_pasta_inexistente_falha(tmp_path):
    assert run(tmp_path / "nao-existe").returncode != 0
