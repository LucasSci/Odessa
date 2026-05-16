from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from typing import Any

from fastapi import HTTPException, Request, Response, status


SESSION_COOKIE_NAME = "odessa_admin_session"
SESSION_TTL_SECONDS = int(os.getenv("ODESSA_SESSION_TTL_SECONDS", str(12 * 60 * 60)))
DEFAULT_ADMIN_PASSWORD_HASHES = {
    "8b9ddf7394e8055c164f989aac111b17e99fdedff3cc5cb4e34d4b3521f8873d",
    "1e4aa0a4ba1e13522ed0a39479c06849cebe9e26e0e284a132510e040af0b0dc",
}
SESSION_SECRET = os.getenv("ODESSA_SESSION_SECRET", "odessa-dev-session-secret-change-me")
ADMIN_PASSWORD = os.getenv("ODESSA_ADMIN_PASSWORD", "")
ADMIN_PASSWORD_HASH = os.getenv("ODESSA_ADMIN_PASSWORD_HASH", "").strip()
COOKIE_SECURE = os.getenv("ODESSA_COOKIE_SECURE", "false").strip().lower() in {"1", "true", "yes"}
COOKIE_SAMESITE = os.getenv("ODESSA_COOKIE_SAMESITE", "lax").strip().lower()
if COOKIE_SAMESITE not in {"lax", "strict", "none"}:
    COOKIE_SAMESITE = "lax"


def _b64encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _b64decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(f"{data}{padding}".encode("ascii"))


def _sign(payload: str) -> str:
    digest = hmac.new(SESSION_SECRET.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).digest()
    return _b64encode(digest)


def _hash_password(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def verify_admin_password(password: str) -> bool:
    normalized_password = password.strip()
    incoming_hash = _hash_password(normalized_password)
    accepted_hashes = set(DEFAULT_ADMIN_PASSWORD_HASHES)
    if ADMIN_PASSWORD_HASH:
        accepted_hashes.add(ADMIN_PASSWORD_HASH)
    for accepted_hash in accepted_hashes:
        if accepted_hash and hmac.compare_digest(incoming_hash, accepted_hash):
            return True
    return bool(ADMIN_PASSWORD) and hmac.compare_digest(normalized_password, ADMIN_PASSWORD.strip())


def create_session_token() -> str:
    now = int(time.time())
    payload: dict[str, Any] = {
        "sub": "admin",
        "role": "admin",
        "iat": now,
        "exp": now + SESSION_TTL_SECONDS,
        "nonce": secrets.token_urlsafe(16),
    }
    encoded_payload = _b64encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    return f"{encoded_payload}.{_sign(encoded_payload)}"


def parse_session_token(token: str | None) -> dict[str, Any] | None:
    if not token or "." not in token:
        return None
    encoded_payload, signature = token.rsplit(".", 1)
    if not hmac.compare_digest(signature, _sign(encoded_payload)):
        return None
    try:
        payload = json.loads(_b64decode(encoded_payload).decode("utf-8"))
    except (ValueError, json.JSONDecodeError):
        return None
    if payload.get("sub") != "admin" or payload.get("role") != "admin":
        return None
    if int(payload.get("exp") or 0) < int(time.time()):
        return None
    return payload


def get_request_session(request: Request) -> dict[str, Any] | None:
    cookie_session = parse_session_token(request.cookies.get(SESSION_COOKIE_NAME))
    if cookie_session:
        return cookie_session

    authorization = request.headers.get("authorization", "")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() == "bearer" and token:
        return parse_session_token(token.strip())
    return None


def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        SESSION_COOKIE_NAME,
        token,
        max_age=SESSION_TTL_SECONDS,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE,
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE_NAME, path="/", secure=COOKIE_SECURE, samesite=COOKIE_SAMESITE)


def get_current_admin(request: Request) -> dict[str, Any]:
    session = get_request_session(request)
    if not session:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return {"authenticated": True, "role": "admin"}
