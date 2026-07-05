1. **Fix SSRF Vulnerability in Proxy Endpoint**
   - In `server/api/v1/endpoints/proxy.py`, the `_fetch` function uses `httpx.AsyncClient` to request user-provided URLs without checking if the resolved IP is internal (e.g., `127.0.0.1`, `169.254.169.254`).
   - I will implement an async request hook `_ssrf_hook(request: httpx.Request)` that uses `asyncio.get_running_loop().getaddrinfo()` to resolve the hostname to an IP address.
   - The hook will block private, loopback, link-local, and multicast IP addresses using the `ipaddress` module.
   - It will mutate `request.url` to connect directly to the resolved IP to prevent DNS rebinding (TOCTOU), while preserving the original hostname in the `Host` header.
   - Add this hook to the `httpx.AsyncClient` via `event_hooks={'request': [_ssrf_hook]}` in `_fetch`.
2. **Test Changes**
   - Run `PYTHONPATH=. python -m pytest server/tests/` to verify tests pass and no functionality is broken.
   - Run `pnpm lint` or equivalent formatting/linting scripts if needed on the modified file.
3. **Pre-commit Checks**
   - Complete pre-commit steps to ensure proper testing, verification, review, and reflection are done.
4. **Submit PR**
   - Submit a PR with the Sentinel security format describing the SSRF mitigation.
