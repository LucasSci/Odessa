## 2026-05-09 - [CORS Misconfiguration Fix]
**Vulnerability:** Permissive CORS configuration with credentials enabled in FastAPI backend (`allow_origins=["*"]`).
**Learning:** Default settings allowed potentially dangerous cross-origin credentialed requests. Setting wildcard origin combined with `allow_credentials=True` exposes APIs.
**Prevention:** Always scope `allow_origins` appropriately (e.g. by using an `ALLOWED_ORIGINS` environment variable and defining safe fallback localhost origins).
## 2026-05-09 - [Missing dependency]
**Vulnerability:** FastAPI endpoints receiving form data throw exceptions when `python-multipart` is missing.
**Learning:** Certain FastAPI functionality fails securely, but the missing dependency crashes the endpoint processing completely.
**Prevention:** Ensure `python-multipart` is included in `requirements.txt` for all projects capturing forms.
## 2026-05-09 - [Logic Flaw / Incorrect Fallback Priority]
**Vulnerability:** A logic flaw caused exact matches to be bypassed, routing users arbitrarily to general fallbacks and default behaviors before checking specific authorizations/inputs.
**Learning:** Checking generic group memberships (like broad "scenario sequences") before checking exact data map resolutions can lead to authorization bypasses or incorrect business logic handling.
**Prevention:** Always evaluate specific overrides and explicit constraints before falling back to generalized scenarios.
