
## 2024-05-20 - [Fix insecure CORS configuration]
**Vulnerability:** CORS wildcard `allow_origins=["*"]` used with `allow_credentials=True` allows credentialed requests from any origin, which is a major security risk (it could allow CSRF attacks reading sensitive data).
**Learning:** `allow_origins=["*"]` must not be combined with `allow_credentials=True`.
**Prevention:** In `server/config.py`, restrict `CORS_ALLOWED_ORIGINS` to a comma-separated list of safe URLs from `.env`, defaulting to local frontend URLs (`http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173`). In `server/main.py`, use the parsed list for `allow_origins`.
