import os

from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, Request, Response

from server.core import auth as auth_core
from server.core.auth import (
    change_admin_password,
    clear_session_cookie,
    create_session_token,
    require_admin,
    set_session_cookie,
    verify_admin_credentials,
)
from server.core.rate_limit import KeyedRateLimiter

router = APIRouter(tags=["auth"])
AUTH_BUILD = "auth-session-2026-09-09"

# Contra força bruta de senha: tentativas de login por IP por minuto.
_login_limiter = KeyedRateLimiter(
    limit=int(os.getenv("ODESSA_RATE_LIMIT_LOGIN_PER_MIN", "10")),
    window_s=60.0,
)


class LoginRequest(BaseModel):
    email: str | None = None
    password: str | None = None


class ChangePasswordRequest(BaseModel):
    currentPassword: str | None = None
    newPassword: str | None = None


@router.post("/login")
async def login(request: LoginRequest, response: Response, http_request: Request):
    clear_session_cookie(response)
    client_ip = http_request.client.host if http_request.client else "unknown"
    if not auth_core.AUTH_DISABLED and not _login_limiter.allow(client_ip):
        retry_after = _login_limiter.retry_after(client_ip)
        raise HTTPException(
            status_code=429,
            detail="Muitas tentativas de login. Aguarde um instante.",
            headers={"Retry-After": str(retry_after)},
        )
    if auth_core.AUTH_DISABLED:
        # Modo dev (ODESSA_AUTH_DISABLED=1): login sempre abre a sessão.
        return {
            "authenticated": True,
            "role": "admin",
            "sessionToken": "",
            "authBuild": AUTH_BUILD,
            "authDisabled": True,
        }

    if not verify_admin_credentials(request.email or "", request.password or ""):
        raise HTTPException(status_code=401, detail="Credenciais inválidas")

    token = create_session_token()
    set_session_cookie(response, token)
    return {
        "authenticated": True,
        "role": "admin",
        "sessionToken": token,
        "authBuild": AUTH_BUILD,
        "authDisabled": False,
    }


@router.post("/change-password")
async def change_password(
    request_data: ChangePasswordRequest,
    session: dict = Depends(require_admin),
):
    if auth_core.AUTH_DISABLED:
        return {
            "ok": True,
            "authDisabled": True,
            "message": "Login desativado neste ambiente; não há senha para alterar.",
        }
    try:
        change_admin_password(request_data.currentPassword or "", request_data.newPassword or "")
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "authDisabled": False, "message": "Senha alterada."}


@router.get("/debug")
async def debug():
    return {"authBuild": AUTH_BUILD, "enabled": not auth_core.AUTH_DISABLED}


@router.post("/logout")
async def logout(response: Response):
    clear_session_cookie(response)
    return {"authenticated": False, "authDisabled": auth_core.AUTH_DISABLED}


@router.get("/me")
async def me(session: dict = Depends(require_admin)):
    return {
        "authenticated": True,
        "role": "admin",
        "authDisabled": auth_core.AUTH_DISABLED,
    }
