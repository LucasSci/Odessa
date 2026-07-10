"""
Web proxy endpoint — strips X-Frame-Options / CSP so pages can be
embedded inside the CaptureStudio iframe.

GET  /proxy?url=https://example.com          → proxies the HTML page
GET  /proxy/asset?url=https://...&base=...   → proxies CSS/JS/image assets

All responses have X-Frame-Options and Content-Security-Policy removed
so the iframe can render them without being blocked.
"""

import logging
import re
import socket
import ipaddress
import asyncio
from urllib.parse import urljoin, urlparse, quote

import httpx
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, Response

logger = logging.getLogger("odessa.proxy")

router = APIRouter()

# Headers we never forward to the upstream site
_DROP_REQUEST_HEADERS = {
    "host",
    "connection",
    "transfer-encoding",
    "te",
    "trailers",
    "upgrade",
    "proxy-authorization",
    "proxy-authenticate",
}

# Response headers that block iframe embedding — strip them all
_DROP_RESPONSE_HEADERS = {
    "x-frame-options",
    "content-security-policy",
    "content-security-policy-report-only",
    "x-content-type-options",
    "transfer-encoding",
    "connection",
    "keep-alive",
}

PROXY_TIMEOUT = 25.0
MAX_BODY_BYTES = 15 * 1024 * 1024  # 15 MB limit

# Full Chrome UA to pass Cloudflare and bot detection
CHROME_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)


def _proxy_base_url(request: Request) -> str:
    """Return the base URL of this FastAPI server (e.g. http://localhost:8000)."""
    return str(request.base_url).rstrip("/")


def _asset_proxy_url(server_base: str, asset_url: str) -> str:
    """Return a /proxy/asset URL that will proxy the given absolute asset URL."""
    return f"{server_base}/proxy/asset?url={quote(asset_url, safe='')}"


def _rewrite_html(html: str, page_url: str, server_base: str) -> str:
    """
    Rewrite a fetched HTML page so that:
    1. <meta http-equiv="X-Frame-Options"> and CSP meta tags are removed.
    2. Existing <base> tags are replaced (or one is injected) to point at
       the upstream origin so JS-driven relative paths still work.
    3. Every src= / href= / action= / data-src= on ANY tag that carries a
       relative or root-relative path is rewritten through /proxy/asset.
    4. url() inside inline <style> blocks is also rewritten.
    """
    parsed = urlparse(page_url)
    origin = f"{parsed.scheme}://{parsed.netloc}"

    # ── 1. Remove blocking meta tags ──
    html = re.sub(
        r'<meta[^>]+http-equiv=["\']?x-frame-options["\']?[^>]*>',
        "",
        html,
        flags=re.IGNORECASE,
    )
    html = re.sub(
        r'<meta[^>]+http-equiv=["\']?content-security-policy["\']?[^>]*>',
        "",
        html,
        flags=re.IGNORECASE,
    )

    # ── 2. Remove existing <base> tags (we'll re-add at the end) ──
    html = re.sub(r"<base[^>]*>", "", html, flags=re.IGNORECASE)

    # ── helpers ──
    def make_absolute(rel: str) -> str:
        """Convert any relative/root-relative URL to absolute."""
        if not rel or rel.startswith(("data:", "javascript:", "#", "mailto:", "blob:")):
            return rel
        if rel.startswith("//"):
            return f"{parsed.scheme}:{rel}"
        if rel.startswith("/"):
            return f"{origin}{rel}"
        if rel.startswith(("http://", "https://")):
            return rel
        return urljoin(page_url, rel)

    def proxy_asset_url(rel: str) -> str:
        abs_url = make_absolute(rel)
        if not abs_url or abs_url.startswith(("data:", "javascript:", "#", "mailto:", "blob:")):
            return rel
        return _asset_proxy_url(server_base, abs_url)

    # ── 3. Rewrite src/href/action/data-src on ALL tags ──
    # This is intentionally broad: we match any tag that has one of these
    # attributes, not just a known whitelist, because SPAs dynamically create
    # many different tags.
    def rewrite_attr(m: re.Match) -> str:
        before = m.group(1)      # everything before the URL value
        quote_char = m.group(2)  # " or '
        url_val = m.group(3)     # the raw URL
        after = m.group(4)       # everything after the closing quote

        if not url_val or url_val.startswith(("data:", "javascript:", "#", "mailto:", "blob:")):
            return m.group(0)

        new_url = proxy_asset_url(url_val)
        return f"{before}{quote_char}{new_url}{quote_char}{after}"

    # Broad regex: match src="…" / href="…" / action="…" / data-src="…"
    # anywhere inside an HTML tag.
    html = re.sub(
        r'(\s(?:src|href|action|data-src)\s*=\s*)(["\'])((?:(?!\2).)*)\2(\s*/?>|\s)',
        rewrite_attr,
        html,
        flags=re.IGNORECASE,
    )

    # ── 4. Rewrite url() inside inline <style> blocks and style attributes ──
    def rewrite_css_url(m: re.Match) -> str:
        inner = m.group(1).strip().strip("'\"")
        if not inner or inner.startswith(("data:", "javascript:", "blob:")):
            return m.group(0)
        return f"url('{proxy_asset_url(inner)}')"

    def rewrite_style_block(m: re.Match) -> str:
        return m.group(1) + re.sub(r"url\(([^)]+)\)", rewrite_css_url, m.group(2), flags=re.IGNORECASE) + m.group(3)

    html = re.sub(r"(<style[^>]*>)(.*?)(</style>)", rewrite_style_block, html, flags=re.IGNORECASE | re.DOTALL)

    def rewrite_style_attr(m: re.Match) -> str:
        before = m.group(1)  # e.g. ' style='
        quote = m.group(2)   # e.g. '"'
        content = m.group(3) # e.g. 'background: url(...)'
        new_content = re.sub(r"url\(([^)]+)\)", rewrite_css_url, content, flags=re.IGNORECASE)
        return f"{before}{quote}{new_content}{quote}"

    html = re.sub(r'(\sstyle\s*=\s*)(["\'])((?:(?!\2).)*)\2', rewrite_style_attr, html, flags=re.IGNORECASE)

    # ── 5. Inject <base> pointing to the upstream origin ──
    # This is done LAST so the broad attr regex above doesn't also rewrite it.
    # The <base> ensures that any JS-driven relative fetches (e.g. fetch("/api/..."))
    # hit the upstream site, not localhost.
    injected_script = f"""
    <script>
    (function() {{
        const proxyBase = "{server_base}/proxy/asset?url=";
        function rewriteUrl(url) {{
            try {{
                const parsed = new URL(url, document.baseURI);
                if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && !parsed.href.includes('/proxy/asset')) {{
                    return proxyBase + encodeURIComponent(parsed.href);
                }}
            }} catch(e) {{}}
            return url;
        }}
        const originalFetch = window.fetch;
        window.fetch = async function(resource, init) {{
            try {{
                if (resource instanceof Request) {{
                    const newUrl = rewriteUrl(resource.url);
                    resource = new Request(newUrl, init || resource);
                }} else {{
                    resource = rewriteUrl(resource);
                }}
            }} catch(e) {{}}
            return originalFetch.call(this, resource, init);
        }};
        const originalOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function(method, url, ...rest) {{
            try {{ url = rewriteUrl(url); }} catch(e) {{}}
            return originalOpen.call(this, method, url, ...rest);
        }};
    }})();
    </script>
    """

    base_tag = f'<base href="{origin}/">\n{injected_script}'
    if "<head" in html.lower():
        html = re.sub(
            r"(<head[^>]*>)",
            rf"\1{base_tag}",
            html,
            count=1,
            flags=re.IGNORECASE,
        )

    return html


def _rewrite_css(css: str, css_url: str, server_base: str) -> str:
    """Rewrite url() references inside a CSS file through the asset proxy."""
    parsed = urlparse(css_url)
    origin = f"{parsed.scheme}://{parsed.netloc}"

    def rewrite_css_url(m: re.Match) -> str:
        inner = m.group(1).strip().strip("'\"")
        if not inner or inner.startswith(("data:", "javascript:", "blob:")):
            return m.group(0)
        if inner.startswith("/"):
            abs_url = f"{origin}{inner}"
        elif inner.startswith(("http://", "https://")):
            abs_url = inner
        else:
            abs_url = urljoin(css_url, inner)
        return f"url('{_asset_proxy_url(server_base, abs_url)}')"

    return re.sub(r"url\(([^)]+)\)", rewrite_css_url, css, flags=re.IGNORECASE)


def _rewrite_js(js: str, js_url: str, server_base: str) -> str:
    """
    Light rewrite for JS files: replace root-relative fetch/import paths.
    Only touches obvious string literals like "/path/..." to avoid breaking
    code logic.  This is best-effort and won't catch everything.
    """
    parsed = urlparse(js_url)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    # We don't rewrite JS broadly to avoid breaking code.
    # The <base> tag handles most cases.
    return js



async def block_private_ips(request: httpx.Request):
    host = request.url.host
    loop = asyncio.get_running_loop()
    try:
        addr_info = await loop.getaddrinfo(host, request.url.port or 80, proto=socket.IPPROTO_TCP)
        for addr in addr_info:
            ip_str = addr[4][0]
            ip_obj = ipaddress.ip_address(ip_str)
            if ip_obj.is_private or ip_obj.is_loopback or ip_obj.is_link_local or ip_obj.is_multicast or ip_obj.is_unspecified:
                raise httpx.RequestError(f"Access to private IP {ip_str} is not allowed", request=request)
    except socket.gaierror as e:
        raise httpx.RequestError(f"DNS resolution failed: {e}", request=request)



async def _fetch(url: str, headers: dict) -> httpx.Response:
    async with httpx.AsyncClient(
        follow_redirects=True,
        timeout=PROXY_TIMEOUT,
        verify=False,  # noqa: S501 — proxy needs to reach any site
        event_hooks={'request': [block_private_ips]}
    ) as client:

        return await client.get(url, headers=headers)


def _clean_response_headers(resp: httpx.Response) -> dict:
    return {
        k: v
        for k, v in resp.headers.items()
        if k.lower() not in _DROP_RESPONSE_HEADERS
    }


@router.get("", response_class=HTMLResponse, summary="Proxy a web page for iframe embedding")
async def proxy_page(
    request: Request,
    url: str = Query(..., description="Full URL of the page to proxy"),
) -> HTMLResponse:
    """
    Fetch a remote HTML page, strip X-Frame-Options / CSP headers and
    rewrite resource URLs so the page renders correctly inside an iframe.
    """
    if not url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="url must start with http:// or https://")

    logger.info("[proxy] Fetching page: %s", url)

    forward_headers = {
        "user-agent": request.headers.get("user-agent", CHROME_UA),
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": request.headers.get("accept-language", "pt-BR,pt;q=0.9,en;q=0.8"),
        "accept-encoding": "gzip, deflate",
        "sec-fetch-dest": "document",
        "sec-fetch-mode": "navigate",
        "sec-fetch-site": "none",
        "sec-fetch-user": "?1",
        "upgrade-insecure-requests": "1",
    }

    try:
        resp = await _fetch(url, forward_headers)
    except httpx.RequestError as exc:
        logger.error("[proxy] Request failed: %s", exc)
        raise HTTPException(status_code=502, detail=f"Proxy request failed: {exc}") from exc

    content_type = resp.headers.get("content-type", "text/html")

    if resp.status_code >= 400:
        logger.warning("[proxy] Upstream returned %s for %s", resp.status_code, url)
        raise HTTPException(status_code=resp.status_code, detail="Upstream error")

    server_base = _proxy_base_url(request)

    if "text/html" in content_type:
        html = resp.text
        html = _rewrite_html(html, str(resp.url), server_base)
        return HTMLResponse(
            content=html,
            status_code=200,
            headers={
                "Content-Type": "text/html; charset=utf-8",
                "Cache-Control": "no-store",
                "Access-Control-Allow-Origin": "*",
            },
        )

    # Non-HTML — pass through with CORS
    clean_headers = _clean_response_headers(resp)
    clean_headers["Access-Control-Allow-Origin"] = "*"
    return Response(
        content=resp.content,
        status_code=200,
        headers=clean_headers,
        media_type=content_type,
    )


@router.get("/asset", summary="Proxy a static asset (CSS, JS, image…)")
async def proxy_asset(
    request: Request,
    url: str = Query(..., description="Absolute URL of the asset to proxy"),
    base: str = Query("", description="Optional base URL for resolving relative CSS urls"),
) -> Response:
    """
    Proxy a static asset referenced by a proxied HTML page.
    Rewrites CSS url() references through the same proxy.
    """
    if not url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="url must be absolute")

    forward_headers = {
        "user-agent": CHROME_UA,
        "accept": "*/*",
        "referer": base or url,
        "accept-encoding": "gzip, deflate",
    }

    try:
        resp = await _fetch(url, forward_headers)
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    if resp.status_code >= 400:
        raise HTTPException(status_code=resp.status_code, detail="Asset not found")

    content_type = resp.headers.get("content-type", "application/octet-stream")
    server_base = _proxy_base_url(request)

    response_headers = {
        "Cache-Control": "public, max-age=3600",
        "Access-Control-Allow-Origin": "*",
    }

    # Rewrite CSS url() references so fonts/images inside CSS also proxy correctly
    if "text/css" in content_type:
        css = _rewrite_css(resp.text, str(resp.url), server_base)
        return Response(
            content=css.encode("utf-8"),
            status_code=200,
            media_type="text/css",
            headers=response_headers,
        )

    # Pass everything else through raw
    return Response(
        content=resp.content,
        status_code=200,
        media_type=content_type,
        headers=response_headers,
    )
