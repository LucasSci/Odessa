from pydantic import BaseModel
from fastapi import APIRouter, HTTPException, Request, Response, status

from server.core.auth import (
    ADMIN_PASSWORD,
    ADMIN_PASSWORD_HASH,
    DEFAULT_ADMIN_PASSWORD_HASH,
    SESSION_SECRET,
    clear_session_cookie,
    create_session_token,
    get_current_admin,
    set_session_cookie,
    verify_admin_password,
)


router = APIRouter(tags=["auth"])
AUTH_BUILD = "auth-2026-05-16-default-password-v2"


class LoginRequest(BaseModel):
    password: str


@router.post("/login")
async def login(request: LoginRequest, response: Response):
    if not verify_admin_password(request.password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=f"Invalid password ({AUTH_BUILD})")
    session_token = create_session_token()
    set_session_cookie(response, session_token)
    return {"authenticated": True, "role": "admin", "sessionToken": session_token, "authBuild": AUTH_BUILD}


@router.get("/debug")
async def debug():
    return {
        "authBuild": AUTH_BUILD,
        "defaultPasswordHashEnabled": ADMIN_PASSWORD_HASH == DEFAULT_ADMIN_PASSWORD_HASH or bool(DEFAULT_ADMIN_PASSWORD_HASH),
        "envPasswordConfigured": bool(ADMIN_PASSWORD),
        "envPasswordHashConfigured": bool(ADMIN_PASSWORD_HASH and ADMIN_PASSWORD_HASH != DEFAULT_ADMIN_PASSWORD_HASH),
        "sessionSecretConfigured": bool(SESSION_SECRET),
    }


@router.post("/logout")
async def logout(response: Response):
    clear_session_cookie(response)
    return {"authenticated": False}


@router.get("/me")
async def me(request: Request):
    return get_current_admin(request)
