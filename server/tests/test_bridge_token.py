import io
import json

from server import main as app_main
from server.services import bridge_manager


def test_token_e_gerado_persistido_e_reaproveitado(tmp_path, monkeypatch):
    monkeypatch.setattr(bridge_manager, "RUNTIME_DIR", tmp_path)
    monkeypatch.setattr(bridge_manager, "_token_cache", {})
    monkeypatch.delenv("TANGO_BRIDGE_TOKEN", raising=False)

    first = bridge_manager.get_bridge_token()
    assert len(first) >= 32
    assert (tmp_path / "bridge.token").read_text(encoding="utf-8") == first

    # "Reinício do backend": cache limpo, o mesmo token volta do disco — é o que
    # permite adotar uma bridge órfã sem perder o acesso a ela.
    monkeypatch.setattr(bridge_manager, "_token_cache", {})
    assert bridge_manager.get_bridge_token() == first


def test_token_curto_ou_corrompido_e_regenerado(tmp_path, monkeypatch):
    monkeypatch.setattr(bridge_manager, "RUNTIME_DIR", tmp_path)
    monkeypatch.setattr(bridge_manager, "_token_cache", {})
    monkeypatch.delenv("TANGO_BRIDGE_TOKEN", raising=False)
    (tmp_path / "bridge.token").write_text("curto", encoding="utf-8")
    token = bridge_manager.get_bridge_token()
    assert token != "curto" and len(token) >= 32


def test_variavel_de_ambiente_tem_prioridade(tmp_path, monkeypatch):
    monkeypatch.setattr(bridge_manager, "RUNTIME_DIR", tmp_path)
    monkeypatch.setattr(bridge_manager, "_token_cache", {})
    monkeypatch.setenv("TANGO_BRIDGE_TOKEN", "definido-no-compose")
    assert bridge_manager.get_bridge_token() == "definido-no-compose"
    assert not (tmp_path / "bridge.token").exists()


def test_headers_de_autenticacao_levam_o_token(tmp_path, monkeypatch):
    monkeypatch.setattr(bridge_manager, "RUNTIME_DIR", tmp_path)
    monkeypatch.setattr(bridge_manager, "_token_cache", {})
    monkeypatch.delenv("TANGO_BRIDGE_TOKEN", raising=False)
    headers = bridge_manager.bridge_auth_headers()
    assert headers == {"X-Bridge-Token": bridge_manager.get_bridge_token()}


def test_sondagem_da_bridge_envia_o_token(tmp_path, monkeypatch):
    monkeypatch.setattr(bridge_manager, "RUNTIME_DIR", tmp_path)
    monkeypatch.setattr(bridge_manager, "_token_cache", {})
    monkeypatch.delenv("TANGO_BRIDGE_TOKEN", raising=False)
    seen = {}

    def fake_urlopen(req, timeout=None):
        seen["headers"] = dict(req.header_items())
        return io.BytesIO(json.dumps({"status": "ok"}).encode())

    import urllib.request

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    result = bridge_manager.BridgeProcessManager()._probe_bridge(7555)
    assert result == {"status": "ok"}
    assert seen["headers"].get("X-bridge-token") == bridge_manager.get_bridge_token()


def test_proxy_da_bridge_troca_o_contexto_do_navegador_pelo_token():
    incoming = [
        ("host", "localhost:8000"),
        ("origin", "http://localhost:8000"),
        ("referer", "http://localhost:8000/x"),
        ("cookie", "odessa_session=abc"),
        ("authorization", "Bearer segredo"),
        ("x-bridge-token", "tentativa-do-cliente"),
        ("content-type", "application/json"),
        ("accept", "text/event-stream"),
    ]
    forwarded = dict(app_main.bridge_forward_headers(incoming, "token-do-backend"))
    assert forwarded["X-Bridge-Token"] == "token-do-backend"
    lowered = {k.lower() for k in forwarded}
    assert not lowered & {"origin", "referer", "cookie", "authorization", "host"}
    assert forwarded["content-type"] == "application/json"
    assert forwarded["accept"] == "text/event-stream"
    # o token enviado pelo navegador nunca é repassado (só o do backend)
    assert list(forwarded.values()).count("tentativa-do-cliente") == 0
