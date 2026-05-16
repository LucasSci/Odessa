from pydantic import BaseModel
from fastapi import APIRouter, HTTPException, Request, Response, status

from server.core.auth import (
    ADMIN_EMAIL,
    ADMIN_PASSWORD_HASH,
    SESSION_SECRET,
    clear_session_cookie,
    create_session_token,
    get_current_admin,
    set_session_cookie,
    verify_admin_credentials,
    change_admin_password,
)


router = APIRouter(tags=["auth"])
AUTH_BUILD = "auth-2026-05-16-email-password-v3"


class LoginRequest(BaseModel):
    email: str
    password: str


class ChangePasswordRequest(BaseModel):
    currentPassword: str
    newPassword: str


@router.post("/login")
async def login(request: LoginRequest, response: Response):
    if not verify_admin_credentials(request.email, request.password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Email ou senha invalidos")
    session_token = create_session_token()
    set_session_cookie(response, session_token)
    return {"authenticated": True, "role": "admin", "sessionToken": session_token, "authBuild": AUTH_BUILD}


@router.post("/change-password")
async def change_password(request_data: ChangePasswordRequest, request: Request):
    get_current_admin(request)
    try:
        change_admin_password(request_data.currentPassword, request_data.newPassword)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc))
    return {"ok": True}


@router.get("/debug")
async def debug():
    return {
        "authBuild": AUTH_BUILD,
        "adminEmail": ADMIN_EMAIL,
        "envEmailConfigured": bool(ADMIN_EMAIL),
        "envPasswordHashConfigured": bool(ADMIN_PASSWORD_HASH),
        "sessionSecretConfigured": bool(SESSION_SECRET),
    }


@router.post("/logout")
async def logout(response: Response):
    clear_session_cookie(response)
    return {"authenticated": False}


@router.get("/me")
async def me(request: Request):
    return get_current_admin(request)
