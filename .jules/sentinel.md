## 2024-05-14 - CORS Configuration Restrictions
**Vulnerability:** Overly permissive CORS configuration with `allow_origins=["*"]` along with `allow_credentials=True`.
**Learning:** Permitting wildcard origins while allowing credentials enables any malicious site to perform authenticated Cross-Site Request Forgery (CSRF) style attacks. The fix parses `CORS_ALLOWED_ORIGINS` to form a restricted list, preventing unintended access.
**Prevention:** Avoid wildcard origins in environments where credentials or sensitive data are handled. Always read authorized origins explicitly from configuration.
