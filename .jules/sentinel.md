## 2025-02-12 - Fix Overly Permissive CORS Configuration
**Vulnerability:** The FastAPI backend in `server/main.py` allowed all origins (`allow_origins=["*"]`) while also allowing credentials (`allow_credentials=True`). This is insecure as it permits any site to make authenticated requests.
**Learning:** Found that CORS was globally open, missing environment-specific restrictions. We need to define safe default values for local development and allow overriding via environment variables for production environments.
**Prevention:** Always parse `CORS_ALLOWED_ORIGINS` from environment variables, split into a list, and pass it to `allow_origins`. Never hardcode `["*"]` in production.
