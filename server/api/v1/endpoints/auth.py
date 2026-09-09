from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, Response

from server.core import auth as auth_core
from server.core.auth import (
    change_admin_password,
    clear_session_cookie,
    create_session_token,
    require_admin,
    set_session_cookie,
    verify_admin_credentials,
)

router = APIRouter(tags=["auth"])
AUTH_BUILD = "auth-session-2026-09-09"


class LoginRequest(BaseModel):
    email: str | None = None
    password: str | None = None


class ChangePasswordRequest(BaseModel):
    currentPassword: str | None = None
    newPassword: str | None = None


@router.post("/login")
async def login(request: LoginRequest, response: Response):
    clear_session_cookie(response)
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
