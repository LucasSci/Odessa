## 2026-05-09 - [CORS Misconfiguration Fix]
**Vulnerability:** Permissive CORS configuration with credentials enabled in FastAPI backend (`allow_origins=["*"]`).
**Learning:** Default settings allowed potentially dangerous cross-origin credentialed requests. Setting wildcard origin combined with `allow_credentials=True` exposes APIs.
**Prevention:** Always scope `allow_origins` appropriately (e.g. by using an `ALLOWED_ORIGINS` environment variable and defining safe fallback localhost origins).
