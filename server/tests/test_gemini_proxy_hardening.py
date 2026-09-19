import pytest

from server.api.v1.endpoints.ai import GEMINI_MODEL_RE, RateLimiter


@pytest.mark.parametrize("model", ["gemini-2.5-flash", "gemini-1.5-pro", "gemini-2.0-flash-lite", "models.x_y-1"])
def test_modelos_validos(model):
    assert GEMINI_MODEL_RE.fullmatch(model)


@pytest.mark.parametrize("model", [
    "../../v1/admin",
    "gemini-2.5-flash:generateContent?key=x",
    "gemini flash",
    "gemini/2.5",
    "",
    "a" * 65,
    "-flag",
])
def test_modelos_invalidos(model):
    assert not GEMINI_MODEL_RE.fullmatch(model)


def test_rate_limiter_bloqueia_acima_do_limite_e_libera_apos_a_janela():
    now = [0.0]
    limiter = RateLimiter(limit=3, window_s=10.0, clock=lambda: now[0])
    assert [limiter.allow() for _ in range(4)] == [True, True, True, False]
    now[0] = 9.9
    assert limiter.allow() is False
    now[0] = 10.0
    assert limiter.allow() is True
