import asyncio

import httpx
import pytest

from server.api.v1.endpoints import proxy


def _fake_fetch(body: bytes, content_type: str, extra_headers: dict | None = None):
    async def fetch(url, headers):
        request = httpx.Request("GET", url)
        return httpx.Response(
            200,
            headers={"content-type": content_type, **(extra_headers or {})},
            content=body,
            request=request,
        )

    return fetch


@pytest.fixture(autouse=True)
def _allow_safe_urls(monkeypatch):
    async def safe(url):
        return True

    monkeypatch.setattr(proxy, "_is_safe_url", safe)


def _sandbox_ok(csp: str) -> bool:
    return csp.startswith("sandbox") and "allow-same-origin" not in csp


def test_pagina_html_vai_em_sandbox_e_sem_cors_aberto(client, monkeypatch):
    monkeypatch.setattr(proxy, "_fetch", _fake_fetch(b"<html><head></head><body>oi</body></html>", "text/html"))
    response = client.get("/proxy", params={"url": "https://exemplo.test/"})
    assert response.status_code == 200
    assert _sandbox_ok(response.headers["content-security-policy"])
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers.get("access-control-allow-origin") is None


def test_asset_html_tambem_vai_em_sandbox(client, monkeypatch):
    monkeypatch.setattr(proxy, "_fetch", _fake_fetch(b"<script>fetch('/api/v1/x')</script>", "text/html"))
    response = client.get("/proxy/asset", params={"url": "https://exemplo.test/x.html"})
    assert response.status_code == 200
    assert _sandbox_ok(response.headers["content-security-policy"])


def test_cors_so_ecoa_null_do_iframe_sandboxado(client, monkeypatch):
    monkeypatch.setattr(proxy, "_fetch", _fake_fetch(b"body{}", "text/css"))
    sandboxed = client.get("/proxy/asset", params={"url": "https://exemplo.test/a.css"}, headers={"Origin": "null"})
    assert sandboxed.headers.get("access-control-allow-origin") == "null"
    other = client.get("/proxy/asset", params={"url": "https://exemplo.test/a.css"}, headers={"Origin": "https://evil.test"})
    assert other.headers.get("access-control-allow-origin") is None


def test_nao_repassa_set_cookie_nem_cors_do_site_de_origem(client, monkeypatch):
    monkeypatch.setattr(
        proxy,
        "_fetch",
        _fake_fetch(b"\x89PNG", "image/png", {"set-cookie": "sid=1", "access-control-allow-origin": "*"}),
    )
    response = client.get("/proxy", params={"url": "https://exemplo.test/img.png"})
    assert response.status_code == 200
    assert "set-cookie" not in response.headers
    assert response.headers.get("access-control-allow-origin") is None


def test_limpeza_de_cabecalhos_remove_os_que_ficariam_errados():
    upstream = httpx.Response(
        200,
        headers={"content-encoding": "identity", "content-length": "1", "set-cookie": "a=b", "x-ok": "1"},
        content=b"x",
    )
    cleaned = {k.lower() for k in proxy._clean_response_headers(upstream)}
    assert "x-ok" in cleaned
    assert not cleaned & {"content-encoding", "content-length", "set-cookie"}


def test_resposta_grande_demais_vira_413(client, monkeypatch):
    async def too_big(url, headers):
        raise proxy.PayloadTooLarge()

    monkeypatch.setattr(proxy, "_fetch", too_big)
    assert client.get("/proxy", params={"url": "https://exemplo.test/"}).status_code == 413
    assert client.get("/proxy/asset", params={"url": "https://exemplo.test/x"}).status_code == 413


def test_read_capped_para_ao_passar_do_limite():
    async def chunks(sizes):
        for size in sizes:
            yield b"x" * size

    assert asyncio.run(proxy._read_capped(chunks([3, 3, 3]), 10)) == b"x" * 9
    with pytest.raises(proxy.PayloadTooLarge):
        asyncio.run(proxy._read_capped(chunks([6, 6]), 10))


def test_erro_do_upstream_nao_vaza_detalhes(client, monkeypatch):
    async def boom(url, headers):
        raise httpx.ConnectError("falha em http://10.0.0.5:8080 com segredo")

    monkeypatch.setattr(proxy, "_fetch", boom)
    response = client.get("/proxy", params={"url": "https://exemplo.test/"})
    assert response.status_code == 502
    assert "segredo" not in response.text and "10.0.0.5" not in response.text
