import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tango_chat"))

import bridge_guard as bg  # noqa: E402

TOKEN = "segredo-de-teste-123"


def check(method="GET", host="127.0.0.1:7555", origin=None, token=TOKEN, expected=TOKEN):
    return bg.check_request(method, host, origin, token, expected)


@pytest.mark.parametrize("host", ["127.0.0.1:7555", "localhost:7555", "[::1]:7555", "LOCALHOST"])
def test_hosts_locais_passam_com_token(host):
    assert check(host=host) is None


@pytest.mark.parametrize("host", ["192.168.0.10:7555", "evil.example", "", None, "localhost.evil.test"])
def test_host_estranho_e_recusado_mesmo_com_token_certo(host):
    result = check(host=host)
    assert result is not None and result[0] == 400


@pytest.mark.parametrize("token", [None, "", "errado", TOKEN + "x", TOKEN[:-1]])
def test_token_ausente_ou_errado_e_401(token):
    result = check(token=token)
    assert result is not None and result[0] == 401


def test_token_valido_libera_leitura_e_acao():
    assert check(method="GET") is None
    assert check(method="POST") is None


def test_origin_de_navegador_nao_libera_sem_o_token():
    assert check(method="POST", origin="https://evil.example", token=None)[0] == 401


def test_sem_token_configurado_barra_post_de_navegador_mas_nao_de_script():
    legado = dict(expected="", token=None)
    assert check(method="POST", origin="https://evil.example", **legado)[0] == 403
    assert check(method="POST", origin=None, **legado) is None
    assert check(method="GET", origin="https://evil.example", **legado) is None


def test_hosts_extras_por_configuracao():
    hosts = bg.parse_hosts("meu-pc.local, outro.lan")
    assert bg.check_request("GET", "meu-pc.local:7555", None, TOKEN, TOKEN, hosts) is None
    assert bg.check_request("GET", "desconhecido:7555", None, TOKEN, TOKEN, hosts)[0] == 400


@pytest.mark.parametrize("url", [
    "https://tango.me/stream/broadcast",
    "http://tango.me/x",
    "https://www.tango.me/live",
    "https://TANGO.ME/",
])
def test_navegacao_permitida_so_em_tango_me(url):
    assert bg.navigation_allowed(url)


@pytest.mark.parametrize("url", [
    "https://evil.example/",
    "https://tango.me.evil.example/",
    "https://eviltango.me/",
    "file:///C:/Windows/System32/config",
    "javascript:alert(1)",
    "chrome://settings",
    "https://tango.me/ x",
    "",
    None,
    123,
])
def test_navegacao_recusada_para_o_resto(url):
    assert not bg.navigation_allowed(url)
