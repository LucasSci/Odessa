from pathlib import Path

import pytest

from server.services import ai_service as ai_module
from server.services.ai_errors import AIUnavailableError


def _service_sem_provedores():
    service = ai_module.AIService()
    service.openai_client = None
    service.gemini_client = None
    service.anthropic_api_key = None
    return service


def _ollama_fora_do_ar(monkeypatch, service):
    def boom(*args, **kwargs):
        raise RuntimeError("connection refused em 127.0.0.1:11434")

    monkeypatch.setattr(service, "generate_ollama_text", boom)


def test_todos_os_provedores_falhando_levanta_erro_com_motivo(monkeypatch):
    monkeypatch.setattr("server.config.ENABLE_LOCAL_FALLBACK", False)
    service = _service_sem_provedores()
    _ollama_fora_do_ar(monkeypatch, service)

    with pytest.raises(AIUnavailableError) as info:
        service.generate_ai_text_with_fallback(
            gemini_model="x", system_prompt="s", user_prompt="u", temperature=0.5, provider="ollama"
        )

    assert any("Ollama" in item and "connection refused" in item for item in info.value.errors)


def test_sem_nenhum_provedor_configurado_explica_no_erro(monkeypatch):
    monkeypatch.setattr("server.config.ENABLE_LOCAL_FALLBACK", False)
    service = _service_sem_provedores()

    with pytest.raises(AIUnavailableError) as info:
        service.generate_ai_text_with_fallback(
            gemini_model="x", system_prompt="s", user_prompt="u", temperature=0.5, provider="gemini"
        )

    assert info.value.errors and "configurado" in info.value.errors[0]


def test_fala_pronta_so_com_fallback_ligado_de_proposito(monkeypatch):
    monkeypatch.setattr("server.config.ENABLE_LOCAL_FALLBACK", True)
    service = _service_sem_provedores()
    _ollama_fora_do_ar(monkeypatch, service)

    text, provider = service.generate_ai_text_with_fallback(
        gemini_model="x", system_prompt="s", user_prompt="u", temperature=0.5, provider="ollama"
    )

    assert provider == "local_fallback" and text


def test_fallback_vem_desligado_por_padrao():
    # Le o default do codigo (o .env do dev pode ligar de proposito).
    source = (Path(__file__).resolve().parents[1] / "server" / "config.py").read_text(encoding="utf-8")
    assert 'getenv("ENABLE_LOCAL_FALLBACK", "false")' in source
    example = (Path(__file__).resolve().parents[1] / ".env.example").read_text(encoding="utf-8")
    assert "ENABLE_LOCAL_FALLBACK=false" in example


def test_endpoint_respond_devolve_503_com_detalhes(client, monkeypatch):
    monkeypatch.setattr("server.config.ENABLE_LOCAL_FALLBACK", False)
    service = _service_sem_provedores()
    _ollama_fora_do_ar(monkeypatch, service)
    monkeypatch.setattr("server.api.v1.endpoints.ai.get_ai_service", lambda: service)

    response = client.post(
        "/api/v1/ai/respond",
        json={"chat_context": "c", "persona_prompt": "p", "user_prompt": "oi", "provider": "ollama"},
    )

    assert response.status_code == 503
    detail = response.json()["detail"]
    assert detail["code"] == "ai_unavailable"
    assert any("Ollama" in item for item in detail["errors"])


def test_erros_longos_sao_truncados():
    error = AIUnavailableError(["x" * 5000])
    assert len(error.errors[0]) == 300
