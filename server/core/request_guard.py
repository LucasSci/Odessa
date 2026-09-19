"""Guarda de Host/Origin contra DNS rebinding e CSRF.

O CORS só impede que uma página LEIA a resposta; um POST cross-site simples
ainda chega ao servidor e executa. Com a autenticação desligada (modo do app
instalado), qualquer site aberto no navegador do usuário poderia disparar
ações em http://localhost:8000. E num ataque de DNS rebinding o navegador
manda o Host do atacante para o nosso IP local.

  - Host: só nomes locais (ou os de ODESSA_ALLOWED_HOSTS; "*" desliga a checagem).
  - Origin: em POST/PUT/PATCH/DELETE, se o navegador enviou Origin, ele precisa
    ser da lista de origens permitidas ou a MESMA origem do Host. Clientes que
    não são navegadores (curl, testes, o próprio backend) não enviam Origin e
    passam. Origin "null" (iframe sandboxado, file://) é recusada.
"""

import os
from typing import Iterable, Optional, Tuple
from urllib.parse import urlparse

DEFAULT_ALLOWED_HOSTS = "localhost,127.0.0.1,[::1],::1"
MUTATING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}

Rejection = Tuple[int, str]


def _split(value: str) -> set[str]:
    return {item.strip().lower() for item in value.split(",") if item.strip()}


def _hostname(host_header: str) -> str:
    """Nome do host sem porta (aceita IPv6 entre colchetes)."""
    host = (host_header or "").strip().lower()
    if host.startswith("["):
        end = host.find("]")
        return host[: end + 1] if end != -1 else host
    return host.rsplit(":", 1)[0] if ":" in host else host


class RequestGuard:
    def __init__(self, allowed_hosts: Iterable[str], allowed_origins: Iterable[str]):
        self.allowed_hosts = {h.lower() for h in allowed_hosts}
        self.allowed_origins = {o.rstrip("/").lower() for o in allowed_origins}

    @classmethod
    def from_env(cls, allowed_origins: Iterable[str]) -> "RequestGuard":
        hosts = _split(os.getenv("ODESSA_ALLOWED_HOSTS", DEFAULT_ALLOWED_HOSTS))
        return cls(hosts, allowed_origins)

    def host_ok(self, host_header: Optional[str]) -> bool:
        if "*" in self.allowed_hosts:
            return True
        if not host_header:
            return False
        return _hostname(host_header) in self.allowed_hosts

    def origin_ok(self, origin: Optional[str], host_header: Optional[str]) -> bool:
        if not origin:
            return True  # não é um navegador (ou é uma requisição same-origin sem cabeçalho)
        normalized = origin.rstrip("/").lower()
        if normalized in self.allowed_origins:
            return True
        parsed = urlparse(normalized)
        if parsed.scheme in ("http", "https") and parsed.netloc and host_header:
            return parsed.netloc == host_header.strip().lower()
        return False

    def check(self, method: str, host_header: Optional[str], origin: Optional[str]) -> Optional[Rejection]:
        """None se pode seguir; senão (status, mensagem)."""
        if not self.host_ok(host_header):
            return 400, "Host não permitido. Para acessar por outro nome/IP defina ODESSA_ALLOWED_HOSTS."
        if method.upper() in MUTATING_METHODS and not self.origin_ok(origin, host_header):
            return 403, "Origem não permitida para esta operação."
        return None
