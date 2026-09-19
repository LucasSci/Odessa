"""Controle de acesso da bridge do Tango (porta 7555).

A bridge dirige um Chromium LOGADO na conta do streamer (clicar, digitar,
navegar, screenshot). Antes, escutava em 0.0.0.0, sem autenticação e com
`Access-Control-Allow-Origin: *`: qualquer pessoa na rede local, ou qualquer
site aberto no navegador (mesmo em modo `no-cors`, que executa a requisição),
podia controlar a conta.

Agora:
  - só aceita Host local (ou os de TANGO_BRIDGE_ALLOWED_HOSTS);
  - exige o token compartilhado com o backend (cabeçalho X-Bridge-Token),
    comparado em tempo constante;
  - sem token configurado (execução avulsa, legado), recusa POSTs que venham de
    navegador (cabeçalho Origin) — os proxies do backend nunca repassam Origin;
  - /goto só navega para tango.me.

Módulo sem dependências (só a biblioteca padrão) para poder ser testado sem
Playwright/aiohttp.
"""

import hmac
from typing import Iterable, Optional, Tuple
from urllib.parse import urlparse

TOKEN_HEADER = "X-Bridge-Token"
DEFAULT_ALLOWED_HOSTS = ("127.0.0.1", "localhost", "[::1]", "::1")
MUTATING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
NAVIGATION_HOSTS = ("tango.me",)

Rejection = Tuple[int, str]


def _hostname(host_header: str) -> str:
    host = (host_header or "").strip().lower()
    if host.startswith("["):
        end = host.find("]")
        return host[: end + 1] if end != -1 else host
    return host.rsplit(":", 1)[0] if ":" in host else host


def parse_hosts(raw: str) -> Tuple[str, ...]:
    extra = tuple(item.strip().lower() for item in (raw or "").split(",") if item.strip())
    return DEFAULT_ALLOWED_HOSTS + extra


def check_request(
    method: str,
    host_header: Optional[str],
    origin: Optional[str],
    token_header: Optional[str],
    expected_token: str,
    allowed_hosts: Iterable[str] = DEFAULT_ALLOWED_HOSTS,
) -> Optional[Rejection]:
    """None se a requisição pode seguir; senão (status, mensagem)."""
    hosts = {h.lower() for h in allowed_hosts}
    if "*" not in hosts and (not host_header or _hostname(host_header) not in hosts):
        return 400, "host_not_allowed"

    if expected_token:
        if not token_header or not hmac.compare_digest(token_header.encode(), expected_token.encode()):
            return 401, "invalid_or_missing_token"
        return None

    # Sem token configurado: modo legado. Navegadores sempre mandam Origin em
    # POST cross-site, então recusar isso barra o CSRF sem quebrar scripts/curl.
    if method.upper() in MUTATING_METHODS and origin:
        return 403, "origin_not_allowed"
    return None


def navigation_allowed(url: object) -> bool:
    """True só para http(s) em tango.me (ou subdomínio)."""
    if not isinstance(url, str) or any(ch.isspace() for ch in url.strip()):
        return False
    parsed = urlparse(url.strip())
    host = (parsed.hostname or "").lower()
    if parsed.scheme not in ("http", "https") or not host:
        return False
    return any(host == allowed or host.endswith("." + allowed) for allowed in NAVIGATION_HOSTS)
