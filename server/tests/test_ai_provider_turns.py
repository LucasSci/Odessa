"""Toda IA recebe a mesma conversa em turnos (é o que mantém o jeito dela ao trocar de provedor)."""
from types import SimpleNamespace

from server.services import ai_service as ai_module
from server.services.ai_service import AIService

TURNS = [
    {"role": "user", "content": "carlos: boa noite"},
    {"role": "assistant", "content": "Boa noite. Chegou cedo hoje."},
    {"role": "user", "content": "carlos: vim do trampo"},
]


def test_claude_recebe_os_turnos_e_a_chave_da_tela(monkeypatch):
    sent = {}

    class FakeClient:
        def __init__(self, *a, **k):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def post(self, url, json, headers):
            sent.update(payload=json, headers=headers)
            return SimpleNamespace(status_code=200, raise_for_status=lambda: None, json=lambda: {"content": [{"type": "text", "text": "Imagino o cansaço."}]})

    import httpx

    monkeypatch.setattr(httpx, "Client", FakeClient)
    service = AIService()
    text = service.generate_claude_text("SISTEMA", "ignorado", 0.7, conversation=TURNS, api_key="chave-da-tela")
    assert text == "Imagino o cansaço."
    assert sent["payload"]["messages"] == TURNS
    assert sent["payload"]["system"] == "SISTEMA"
    assert sent["headers"]["x-api-key"] == "chave-da-tela"


def test_openai_recebe_sistema_mais_turnos(monkeypatch):
    sent = {}

    class FakeOpenAI:
        def __init__(self, **kwargs):
            sent["key"] = kwargs.get("api_key")
            self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

        def _create(self, **kwargs):
            sent["messages"] = kwargs["messages"]
            return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="Que dia, hein."))])

    monkeypatch.setattr(ai_module, "OpenAI", FakeOpenAI)
    text = AIService().generate_openai_text("SISTEMA", "ignorado", 0.7, conversation=TURNS, api_key="sk-tela")
    assert text == "Que dia, hein."
    assert sent["messages"] == [{"role": "system", "content": "SISTEMA"}, *TURNS]
    assert sent["key"] == "sk-tela"


def test_gemini_recebe_turnos_como_user_model_e_sem_raciocinio(monkeypatch):
    sent = {}

    class FakeModels:
        def generate_content(self, model, contents, config):
            sent.update(model=model, contents=contents, config=config)
            return SimpleNamespace(text="Descansa um pouco.")

    class FakeGenaiClient:
        def __init__(self, api_key=None):
            sent["key"] = api_key
            self.models = FakeModels()

    monkeypatch.setattr(ai_module.genai, "Client", FakeGenaiClient)
    text = AIService().generate_gemini_text("SISTEMA", "ignorado", 0.7, conversation=TURNS, api_key="AIza-tela")
    assert text == "Descansa um pouco."
    assert [c["role"] for c in sent["contents"]] == ["user", "model", "user"]
    assert sent["contents"][1]["parts"][0]["text"] == "Boa noite. Chegou cedo hoje."
    assert sent["config"]["system_instruction"] == "SISTEMA"
    assert sent["config"]["thinking_config"] == {"thinking_budget": 0}
    assert sent["key"] == "AIza-tela"


def test_roteador_repassa_turnos_e_chave_para_a_ia_escolhida(monkeypatch):
    calls = {}
    service = AIService()

    def fake_gemini(system, user, temperature, **kwargs):
        calls.update(kwargs)
        return "ok"

    monkeypatch.setattr(service, "generate_gemini_text", fake_gemini)
    text, provider = service.generate_ai_text_with_fallback(
        gemini_model="gemini-2.5-flash", system_prompt="S", user_prompt="U", temperature=0.7,
        provider="gemini", conversation=TURNS, provider_key="AIza-tela",
    )
    assert (text, provider) == ("ok", "gemini")
    assert calls["conversation"] == TURNS and calls["api_key"] == "AIza-tela"


def test_qwen3_sem_raciocinio_escondido(monkeypatch):
    sent = {}

    class FakeClient:
        def __init__(self, *a, **k):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def post(self, url, json):
            sent.update(json)
            return SimpleNamespace(status_code=200, raise_for_status=lambda: None, json=lambda: {"message": {"content": "oi"}})

    import httpx

    monkeypatch.setattr(httpx, "Client", FakeClient)
    AIService().generate_ollama_text("S", "U", 0.7, model="qwen3:4b-instruct", conversation=TURNS)
    assert sent["think"] is False
    sent.clear()
    AIService().generate_ollama_text("S", "U", 0.7, model="qwen2.5:3b", conversation=TURNS)
    assert "think" not in sent
