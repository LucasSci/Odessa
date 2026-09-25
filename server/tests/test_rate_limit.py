from server.core.rate_limit import KeyedRateLimiter, RateLimiter


def test_retry_after_conta_ate_a_janela_liberar():
    now = [100.0]
    limiter = RateLimiter(limit=2, window_s=60.0, clock=lambda: now[0])
    assert limiter.retry_after() == 0
    assert limiter.allow() and limiter.allow()
    assert not limiter.allow()
    now[0] = 130.0
    assert limiter.retry_after() == 30
    now[0] = 160.0
    assert limiter.allow()


def test_limite_por_chave_e_independente():
    now = [0.0]
    limiter = KeyedRateLimiter(limit=1, window_s=60.0, clock=lambda: now[0])
    assert limiter.allow("1.1.1.1")
    assert not limiter.allow("1.1.1.1")
    assert limiter.allow("2.2.2.2")
    assert limiter.retry_after("1.1.1.1") == 60
    assert limiter.retry_after("9.9.9.9") == 0


def test_teto_de_chaves_descarta_a_mais_antiga():
    limiter = KeyedRateLimiter(limit=1, window_s=60.0, max_keys=2, clock=lambda: 0.0)
    assert limiter.allow("a")
    assert limiter.allow("b")
    assert limiter.allow("c")  # "a" é descartada para caber "c"
    assert limiter.allow("a")  # "a" recomeça do zero
