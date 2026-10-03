import pytest


@pytest.fixture(autouse=True)
def _fresh_local_ai():
    """O cliente do Ollama e o modelo lembrado do chat são globais: cada teste começa do zero."""
    from server.services.ai_service import reset_local_ai_state

    reset_local_ai_state()
    yield
    reset_local_ai_state()
