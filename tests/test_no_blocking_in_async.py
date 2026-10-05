"""Nada que bloqueia por segundos pode rodar dentro do event loop.

Numa live simulada (docs/PLANO-OTIMIZACAO.md) o servidor ficou parado 96% do
tempo: cada mensagem do chat entrava em `/automation/ingest` (async) e acabava
pedindo um prompt de vídeo à IA local de forma síncrona. Enquanto o Ollama
escrevia, palco, overlay do OBS e chat paravam juntos.
"""
import ast
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

SERVER = Path(__file__).resolve().parents[1] / "server"

# Chamadas que levam segundos (IA, HTTP síncrono, espera). Dentro de `async def`
# só passando a função para asyncio.to_thread (sem chamar).
BLOCKING_CALLS = {
    "generate_ai_text_with_fallback",
    "generate_ollama_text",
    "generate_mistral_text",
    "generate_claude_text",
    "generate_openai_text",
    "generate_gemini_text",
    "generate_kokoro_wav",
    "auto_generate",
}
BLOCKING_QUALIFIED = {("httpx", "Client"), ("time", "sleep"), ("requests", "get"), ("requests", "post"), ("subprocess", "run")}


def _blocking_calls_in(func: ast.AsyncFunctionDef) -> list[str]:
    found: list[str] = []

    def visit(node: ast.AST) -> None:
        for child in ast.iter_child_nodes(node):
            # Funções aninhadas são callbacks (ex.: passadas ao to_thread): não rodam no loop aqui.
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
                continue
            if isinstance(child, ast.Call):
                target = child.func
                if isinstance(target, ast.Attribute):
                    if target.attr in BLOCKING_CALLS:
                        found.append(f"{target.attr}()")
                    if isinstance(target.value, ast.Name) and (target.value.id, target.attr) in BLOCKING_QUALIFIED:
                        found.append(f"{target.value.id}.{target.attr}()")
                elif isinstance(target, ast.Name) and target.id in BLOCKING_CALLS:
                    found.append(f"{target.id}()")
            visit(child)

    visit(func)
    return found


def test_nenhuma_rota_async_chama_ia_ou_io_bloqueante_direto():
    problems = []
    for path in sorted(SERVER.rglob("*.py")):
        if "tests" in path.parts:
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.AsyncFunctionDef):
                for call in _blocking_calls_in(node):
                    problems.append(f"{path.relative_to(SERVER.parent)}:{node.lineno} {node.name} chama {call}")
    assert not problems, "Use asyncio.to_thread (ou uma rota def) para:\n" + "\n".join(problems)


def test_chat_continua_rapido_com_geracao_automatica_e_ia_lenta(monkeypatch):
    """O cenário exato da trava: IA lenta + geração automática ligada + chat entrando."""
    import server.main as main
    from server.services.ai_service import ai_service
    from server.services.video_gen import video_gen_service as vgs
    from server.services.video_gen.prompt_service import prompt_service

    calls = []

    def slow_llm(**kwargs):
        calls.append(kwargs.get("priority"))
        time.sleep(2)
        return "ela sorri e acena para o chat", "ollama"

    monkeypatch.setattr(ai_service, "generate_ai_text_with_fallback", slow_llm)
    auto_on = {"value": False}
    monkeypatch.setattr(prompt_service, "should_auto_generate", lambda _pid=None: auto_on["value"])
    monkeypatch.setattr(vgs.video_gen_service, "_last_generation_at", 0.0)
    monkeypatch.setattr(vgs.video_gen_service, "enqueue", lambda *a, **k: {"ok": True})

    with TestClient(main.app) as client:
        # Aquecimento: o 1º pedido paga imports e caches (~1 s no Windows), não a IA.
        client.post("/api/v1/automation/ingest", json={"text": "aquecimento: oi", "source": "teste", "kind": "chat"})
        auto_on["value"] = True
        times = []
        for i in range(3):
            start = time.monotonic()
            response = client.post("/api/v1/automation/ingest", json={"text": f"espectador_{i}: oi linda", "source": "teste", "kind": "chat"})
            times.append(time.monotonic() - start)
            assert response.status_code == 200
        thread = vgs.video_gen_service._auto_thread
        if thread is not None:
            thread.join(timeout=5)

    assert max(times) < 1.0, f"mensagem do chat esperou a IA: {times}"
    assert calls == ["background"], "uma geração só, em segundo plano e com prioridade de fundo"


def test_fila_da_ia_local_da_a_vez_ao_chat():
    """Com a IA ocupada, o chat passa na frente do que é de fundo."""
    import threading

    from server.services.ai_service import LocalAiBusy, LocalAiGate

    gate = LocalAiGate()
    order = []
    started = threading.Event()

    def first():
        with gate.slot("background"):
            started.set()
            time.sleep(0.3)
        order.append("primeiro (fundo)")

    def later(priority, label, delay):
        time.sleep(delay)
        with gate.slot(priority):
            order.append(label)

    threads = [
        threading.Thread(target=first),
        threading.Thread(target=later, args=("background", "fundo", 0.05)),
        threading.Thread(target=later, args=("chat", "chat", 0.1)),
    ]
    threads[0].start()
    started.wait(1)
    for t in threads[1:]:
        t.start()
    for t in threads:
        t.join(3)
    assert order == ["primeiro (fundo)", "chat", "fundo"]

    with gate.slot("chat"):
        with pytest.raises(LocalAiBusy):
            with gate.slot("chat", max_wait_s=0.05):
                pass
