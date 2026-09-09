"""
SSRF guard — transporte httpx que resolve o hostname e bloqueia destinos
internos (IPs privados/loopback/link-local/multicast/unspecified/reserved).

Movido de server/api/v1/endpoints/proxy.py para poder ser reaproveitado por
outros services (ex.: webhook_service) sem importar camada de API.
"""
import asyncio
import ipaddress
import socket

import httpx


class SSRFTransport(httpx.AsyncHTTPTransport):
    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        hostname = request.url.host

        if not hostname:
            return await super().handle_async_request(request)

        # Resolução DNS não-bloqueante; falha "fechada" (fail secure).
        loop = asyncio.get_running_loop()
        try:
            addr_info = await loop.getaddrinfo(hostname, None, type=socket.SOCK_STREAM)
        except socket.gaierror:
            raise httpx.RequestError(f"Could not resolve hostname: {hostname}", request=request)

        resolved_ip = None
        for family, type, proto, canonname, sockaddr in addr_info:
            ip = sockaddr[0]
            try:
                ip_obj = ipaddress.ip_address(ip)
                if (
                    ip_obj.is_private
                    or ip_obj.is_loopback
                    or ip_obj.is_link_local
                    or ip_obj.is_multicast
                    or ip_obj.is_unspecified
                    or ip_obj.is_reserved
                ):
                    raise httpx.RequestError(f"Blocked request to internal IP: {ip}", request=request)
                if not resolved_ip:
                    resolved_ip = ip
            except ValueError:
                pass

        if resolved_ip:
            original_url = request.url
            new_extensions = dict(request.extensions)
            new_extensions["sni_hostname"] = original_url.host

            headers = request.headers.copy()
            if "host" not in headers:
                netloc_str = (
                    original_url.netloc.decode("ascii")
                    if hasattr(original_url.netloc, "decode")
                    else str(original_url.netloc)
                )
                headers["host"] = netloc_str

            new_req = httpx.Request(
                method=request.method,
                url=request.url.copy_with(host=resolved_ip),
                headers=headers,
                stream=request.stream,
                extensions=new_extensions,
            )
            return await super().handle_async_request(new_req)

        raise httpx.RequestError(f"Could not determine safe IP for hostname: {hostname}", request=request)
