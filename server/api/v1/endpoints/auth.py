from pydantic import BaseModel
from fastapi import APIRouter, HTTPException, Request, Response, status

from server.core.auth import (
    clear_session_cookie,
    create_session_token,
    get_current_admin,
    set_session_cookie,
    verify_admin_password,
)


router = APIRouter(tags=["auth"])


class LoginRequest(BaseModel):
    password: str


@router.post("/login")
async def login(request: LoginRequest, response: Response):
    if not verify_admin_password(request.password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid password")
    session_token = create_session_token()
    set_session_cookie(response, session_token)
    return {"authenticated": True, "role": "admin", "sessionToken": session_token}


@router.post("/logout")
async def logout(response: Response):
    clear_session_cookie(response)
    return {"authenticated": False}


@router.get("/me")
async def me(request: Request):
    return get_current_admin(request)
