"""Motor da IA local do Odessa (llama.cpp na GPU integrada), sem subir o motor de verdade."""
import json
from pathlib import Path

import pytest

from server.services import ai_service as ai_module
from server.services import local_engine as le


def make_ollama_store(root: Path) -> Path:
    blob = root / "blobs" / "sha256-abc"
    blob.parent.mkdir(parents=True)
    blob.write_bytes(b"GGUF....")
    manifest = root / "manifests" / "registry.ollama.ai" / "library" / "qwen3" / "4b-instruct"
    manifest.parent.mkdir(parents=True)
    manifest.write_text(json.dumps({"layers": [
        {"mediaType": "application/vnd.ollama.image.template", "digest": "sha256:tpl"},
        {"mediaType": "application/vnd.ollama.image.model", "digest": "sha256:abc"},
    ]}), encoding="utf-8")
    return blob


def test_acha_o_arquivo_do_modelo_pelo_manifest_do_ollama(tmp_path):
    blob = make_ollama_store(tmp_path)
    assert le.resolve_model("qwen3:4b-instruct", tmp_path) == blob
    assert le.resolve_model("qwen3:outro", tmp_path) is None
    assert le.resolve_model("", tmp_path) is None


def test_motor_do_ollama_ganha_o_backend_vulkan_da_subpasta(tmp_path, monkeypatch):
    lib = tmp_path / "Programs" / "Ollama" / "lib" / "ollama"
    (lib / "vulkan").mkdir(parents=True)
    (lib / "llama-server.exe").write_bytes(b"")
    (lib / "vulkan" / "ggml-vulkan.dll").write_bytes(b"")
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    monkeypatch.delenv("ODESSA_LLAMA_SERVER", raising=False)
    monkeypatch.setattr(le, "_install_root", lambda: tmp_path / "sem-motor-proprio")
    # O conftest troca find_engine por "sem motor"; aqui vale a função de verdade.
    found = le.real_find_engine()
    assert found["exe"] == lib / "llama-server.exe"
    assert found["env"]["GGML_BACKEND_PATH"] == str(lib / "vulkan" / "ggml-vulkan.dll")


class FakeResponse:
    def __init__(self, text):
        self.text = text

    def raise_for_status(self):
        return None

    def json(self):
        return {"choices": [{"message": {"content": self.text}}]}


def test_resposta_vai_pelo_motor_quando_ele_existe(monkeypatch):
    sent = {}

    class Client:
        def post(self, url, json=None, headers=None):
            sent.update(url=url, body=json, headers=headers)
            return FakeResponse("Malbec, my usual.")

    monkeypatch.setattr(le, "engine_mode", lambda: "gpu")
    monkeypatch.setattr(le.local_engine, "ensure", lambda model: {"url": "http://127.0.0.1:9", "token": "t"})
    monkeypatch.setattr(ai_module, "_ollama_client", lambda: Client())
    text = ai_module.AIService().generate_ollama_text("sistema", "oi", 0.7, model="qwen3:4b-instruct")
    assert text == "Malbec, my usual."
    assert sent["url"].endswith("/v1/chat/completions") and sent["headers"]["Authorization"] == "Bearer t"
    assert sent["body"]["chat_template_kwargs"] == {"enable_thinking": False}
    assert sent["body"]["messages"][0] == {"role": "system", "content": "sistema"}


def test_motor_falhou_cai_no_ollama(monkeypatch):
    calls = []

    class Client:
        def post(self, url, json=None, headers=None):
            calls.append(url)
            if "/v1/chat/completions" in url:
                raise RuntimeError("motor caiu")
            return type("R", (), {"status_code": 200, "raise_for_status": lambda s: None, "json": lambda s: {"message": {"content": "do ollama"}}})()

    monkeypatch.setattr(le, "engine_mode", lambda: "gpu")
    monkeypatch.setattr(le.local_engine, "ensure", lambda model: {"url": "http://127.0.0.1:9", "token": "t"})
    monkeypatch.setattr(ai_module, "_ollama_client", lambda: Client())
    assert ai_module.AIService().generate_ollama_text("s", "u", 0.7, model="qwen3:4b-instruct") == "do ollama"
    assert calls[0].endswith("/v1/chat/completions") and calls[1].endswith("/api/chat")


def test_url_personalizada_nao_usa_o_motor(monkeypatch):
    monkeypatch.setattr(le, "engine_mode", lambda: "gpu")
    monkeypatch.setattr(le.local_engine, "ensure", lambda model: pytest.fail("não devia usar o motor"))

    class Client:
        def post(self, url, json=None, headers=None):
            return type("R", (), {"status_code": 200, "raise_for_status": lambda s: None, "json": lambda s: {"message": {"content": "lm studio"}}})()

    monkeypatch.setattr(ai_module, "_ollama_client", lambda: Client())
    out = ai_module.AIService().generate_ollama_text("s", "u", 0.7, model="m", base_url="http://127.0.0.1:1234")
    assert out == "lm studio"


def test_escolha_ollama_fica_gravada(tmp_path, monkeypatch):
    import server.config as cfg

    monkeypatch.setattr(cfg, "RUNTIME_DIR", tmp_path)
    monkeypatch.setattr(le, "find_engine", lambda: {"exe": Path("x"), "env": {}})
    assert le.engine_mode() == "gpu"
    le.set_engine_mode("ollama")
    assert le.engine_mode() == "ollama"
    le.set_engine_mode("auto")
    assert le.engine_mode() == "gpu"


def test_descarrega_o_motor_ocioso():
    engine = le.LocalEngine()

    class Proc:
        stopped = False

        def poll(self):
            return 0 if self.stopped else None

        def terminate(self):
            self.stopped = True

        def wait(self, timeout=None):
            return 0

    proc = Proc()
    engine._proc, engine._last_used = proc, 0.0
    assert engine.unload_if_idle(idle_s=1) is True and proc.stopped


def test_aquecer_le_a_parte_fixa_no_motor(monkeypatch):
    sent = {}

    class Client:
        def post(self, url, json=None, headers=None):
            sent.update(url=url, body=json)
            return FakeResponse("")

    monkeypatch.setattr(le, "engine_mode", lambda: "gpu")
    monkeypatch.setattr(le.local_engine, "ensure", lambda model: {"url": "http://127.0.0.1:9", "token": "t"})
    monkeypatch.setattr(ai_module, "_ollama_client", lambda: Client())
    assert ai_module.AIService().warm_local_engine("persona + estilo", "qwen3:4b-instruct") is True
    assert sent["body"]["max_tokens"] == 1 and sent["body"]["messages"][0]["content"] == "persona + estilo"


def test_motor_le_menos_texto_por_resposta():
    system = "Persona.\n\nEstilo.\n\n[NOW] x.\n\n[YOUR LAST LINES ON THIS LIVE] Don't repeat:\n- a\n- b\n\n[LANGUAGE] English."
    turns = [{"role": "assistant" if i % 2 else "user", "content": f"m{i}"} for i in range(20)]
    out = ai_module._lean_for_engine([{"role": "system", "content": system}, *turns])
    assert "LAST LINES" not in out[0]["content"] and "[NOW] x." in out[0]["content"] and "[LANGUAGE]" in out[0]["content"]
    assert len(out) - 1 <= ai_module.ENGINE_MAX_TURNS and out[1]["role"] == "user" and out[-1]["content"] == "m19"
