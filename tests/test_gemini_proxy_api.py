def test_gemini_recusa_modelo_invalido_sem_chamar_o_google(client, monkeypatch):
    import server.api.v1.endpoints.ai as ai

    class Boom:
        def __init__(self, *a, **k):
            raise AssertionError("não deveria abrir conexão")

    monkeypatch.setattr(ai.httpx, "AsyncClient", Boom)
    response = client.post(
        "/api/v1/ai/gemini",
        json={"key": "k", "model": "../../v1/admin", "payload": {"contents": []}},
    )
    assert response.status_code == 400


def test_gemini_envia_a_chave_no_header_e_nao_na_url(client, monkeypatch):
    import server.api.v1.endpoints.ai as ai

    seen = {}

    class FakeResponse:
        text = "{}"

        def json(self):
            return {"ok": True}

    class FakeClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, json=None, headers=None):
            seen["url"] = url
            seen["headers"] = headers
            return FakeResponse()

    monkeypatch.setattr(ai.httpx, "AsyncClient", FakeClient)
    monkeypatch.setattr(ai, "_gemini_rate_limiter", ai.RateLimiter(limit=100, window_s=60))
    response = client.post(
        "/api/v1/ai/gemini",
        json={"key": "SEGREDO", "model": "gemini-2.5-flash", "payload": {"contents": []}},
    )
    assert response.status_code == 200
    assert "SEGREDO" not in seen["url"] and "key=" not in seen["url"]
    assert seen["headers"]["x-goog-api-key"] == "SEGREDO"


def test_gemini_nao_devolve_a_excecao_ao_cliente(client, monkeypatch):
    import server.api.v1.endpoints.ai as ai

    class FailClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, *a, **k):
            raise RuntimeError("falha com key=SEGREDO na url")

    monkeypatch.setattr(ai.httpx, "AsyncClient", FailClient)
    monkeypatch.setattr(ai, "_gemini_rate_limiter", ai.RateLimiter(limit=100, window_s=60))
    response = client.post(
        "/api/v1/ai/gemini",
        json={"key": "SEGREDO", "model": "gemini-2.5-flash", "payload": {"contents": []}},
    )
    assert response.status_code == 502
    assert "SEGREDO" not in response.text


def test_gemini_aplica_limite_de_chamadas(client, monkeypatch):
    import server.api.v1.endpoints.ai as ai

    monkeypatch.setattr(ai, "_gemini_rate_limiter", ai.RateLimiter(limit=0, window_s=60))
    response = client.post(
        "/api/v1/ai/gemini",
        json={"key": "k", "model": "gemini-2.5-flash", "payload": {"contents": []}},
    )
    assert response.status_code == 429
