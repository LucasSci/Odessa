from pydantic import BaseModel
from fastapi import APIRouter, Response

from server.core.auth import clear_session_cookie


router = APIRouter(tags=["auth"])
AUTH_BUILD = "auth-disabled-2026-05-16"


class LoginRequest(BaseModel):
    email: str | None = None
    password: str | None = None


class ChangePasswordRequest(BaseModel):
    currentPassword: str | None = None
    newPassword: str | None = None


@router.post("/login")
async def login(request: LoginRequest, response: Response):
    clear_session_cookie(response)
    return {"authenticated": True, "role": "admin", "sessionToken": "", "authBuild": AUTH_BUILD, "authDisabled": True}


@router.post("/change-password")
async def change_password(request_data: ChangePasswordRequest):
    return {"ok": True, "authDisabled": True, "message": "Login desativado; nao ha senha para alterar."}


@router.get("/debug")
async def debug():
    return {"authBuild": AUTH_BUILD, "enabled": False}


@router.post("/logout")
async def logout(response: Response):
    clear_session_cookie(response)
    return {"authenticated": True, "authDisabled": True}


@router.get("/me")
async def me():
    return {"authenticated": True, "role": "admin", "authDisabled": True}
