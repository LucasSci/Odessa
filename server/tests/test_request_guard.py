import pytest

from server.core.request_guard import RequestGuard

DEV_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"]


def guard(hosts="localhost,127.0.0.1,[::1]", origins=DEV_ORIGINS):
    return RequestGuard({h for h in hosts.split(",")}, origins)


@pytest.mark.parametrize("host", ["localhost", "localhost:8000", "127.0.0.1:8000", "[::1]:8000", "LOCALHOST:8000"])
def test_hosts_locais_passam(host):
    assert guard().check("GET", host, None) is None


@pytest.mark.parametrize("host", ["evil.example", "evil.example:8000", "192.168.1.20:8000", "", None, "localhost.evil.test"])
def test_dns_rebinding_e_host_estranho_sao_recusados(host):
    result = guard().check("GET", host, None)
    assert result is not None and result[0] == 400


def test_curl_e_clientes_sem_origin_passam_em_post():
    assert guard().check("POST", "localhost:8000", None) is None


def test_post_do_proprio_app_passa():
    assert guard().check("POST", "localhost:8000", "http://localhost:8000") is None
    assert guard().check("DELETE", "127.0.0.1:8000", "http://127.0.0.1:8000") is None


def test_post_do_vite_de_desenvolvimento_passa_pela_lista():
    assert guard().check("POST", "localhost:8001", "http://localhost:3000") is None


@pytest.mark.parametrize("origin", ["https://evil.example", "http://localhost:9999", "null", "http://localhost.evil.test:8000", "file://"])
def test_post_de_outra_origem_e_recusado(origin):
    result = guard().check("POST", "localhost:8000", origin)
    assert result is not None and result[0] == 403


def test_get_de_outra_origem_nao_e_bloqueado_aqui():
    # Leitura cross-origin já é controlada pelo CORS; a guarda cuida do que muda estado.
    assert guard().check("GET", "localhost:8000", "https://evil.example") is None


def test_asterisco_desliga_a_checagem_de_host():
    assert guard(hosts="*").check("GET", "qualquer.com", None) is None


def test_hosts_extras_por_ambiente(monkeypatch):
    monkeypatch.setenv("ODESSA_ALLOWED_HOSTS", "localhost,meu-pc.local")
    g = RequestGuard.from_env([])
    assert g.check("GET", "meu-pc.local:8000", None) is None
    assert g.check("GET", "127.0.0.1:8000", None)[0] == 400
