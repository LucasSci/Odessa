import pytest


@pytest.fixture(autouse=True)
def _fresh_local_ai():
    """O cliente do Ollama e o modelo lembrado do chat são globais: cada teste começa do zero."""
    try:
        from server.services import local_engine
        from server.services.ai_service import reset_local_ai_state
    except ImportError:
        # Job dos scripts do instalador: roda só com o pytest, sem o backend.
        yield
        return

    reset_local_ai_state()
    # Nos testes nunca sobe o motor de verdade (llama-server na GPU) nem lê o
    # ai_engine.json da máquina: quem testa o motor liga explicitamente.
    original = local_engine.find_engine
    local_engine.real_find_engine = original
    local_engine.find_engine = lambda: None
    yield
    local_engine.find_engine = original
    local_engine.local_engine.stop()
    reset_local_ai_state()
