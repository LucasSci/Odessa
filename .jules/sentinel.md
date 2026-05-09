## 2026-05-09 - [CORS Misconfiguration Fix]
**Vulnerability:** Permissive CORS configuration with credentials enabled in FastAPI backend (`allow_origins=["*"]`).
**Learning:** Default settings allowed potentially dangerous cross-origin credentialed requests. Setting wildcard origin combined with `allow_credentials=True` exposes APIs.
**Prevention:** Always scope `allow_origins` appropriately (e.g. by using an `ALLOWED_ORIGINS` environment variable and defining safe fallback localhost origins).
## 2026-05-09 - [Missing dependency]
**Vulnerability:** FastAPI endpoints receiving form data throw exceptions when `python-multipart` is missing.
**Learning:** Certain FastAPI functionality fails securely, but the missing dependency crashes the endpoint processing completely.
**Prevention:** Ensure `python-multipart` is included in `requirements.txt` for all projects capturing forms.
