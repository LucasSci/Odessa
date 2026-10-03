"""Contexto SSL compartilhado para os clientes HTTP do servidor.

Cada `httpx.Client`/`AsyncClient` novo monta um contexto SSL, e no Windows isso
lê o repositório de certificados do sistema. O proxy da bridge e a checagem do
Ollama criavam um cliente por pedido: numa live simulada, `ssl.create_default_context`
foi a função mais quente do servidor. Montando o contexto uma vez, criar um
cliente fica barato (as chamadas locais nem usam TLS; as de nuvem continuam
verificando o certificado normalmente).
"""
from __future__ import annotations

import ssl
import threading

_lock = threading.Lock()
_context: ssl.SSLContext | None = None


def shared_ssl_context() -> ssl.SSLContext:
    global _context
    with _lock:
        if _context is None:
            import httpx

            _context = httpx.create_ssl_context()
        return _context
