from server.core.observability import init_sentry


def test_sem_dsn_nao_inicializa():
    calls = []
    assert init_sentry({}, sdk_init=lambda **kw: calls.append(kw)) is False
    assert calls == []


def test_com_dsn_inicializa_sem_pii():
    calls = []
    active = init_sentry(
        {"SENTRY_DSN": " https://k@o1.ingest.sentry.io/1 ", "SENTRY_ENVIRONMENT": "staging"},
        sdk_init=lambda **kw: calls.append(kw),
    )
    assert active is True
    assert calls[0]["dsn"] == "https://k@o1.ingest.sentry.io/1"
    assert calls[0]["environment"] == "staging"
    assert calls[0]["send_default_pii"] is False
    assert calls[0]["max_request_body_size"] == "never"
    assert calls[0]["traces_sample_rate"] == 0.0


def test_taxa_de_tracing_invalida_vira_zero():
    calls = []
    init_sentry({"SENTRY_DSN": "x", "SENTRY_TRACES_SAMPLE_RATE": "3"}, sdk_init=lambda **kw: calls.append(kw))
    init_sentry({"SENTRY_DSN": "x", "SENTRY_TRACES_SAMPLE_RATE": "abc"}, sdk_init=lambda **kw: calls.append(kw))
    init_sentry({"SENTRY_DSN": "x", "SENTRY_TRACES_SAMPLE_RATE": "0.25"}, sdk_init=lambda **kw: calls.append(kw))
    assert [c["traces_sample_rate"] for c in calls] == [0.0, 0.0, 0.25]
