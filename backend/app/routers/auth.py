import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.auth import (
    get_current_user,
    hash_password,
    verify_password,
    create_access_token,
)
from app.config import settings
from app.database import get_async_db

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


class RegisterRequest(BaseModel):
    username: str
    password: str
    display_name: str = ""


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str


class ProfileUpdate(BaseModel):
    display_name: Optional[str] = None


@router.post("/login", response_model=LoginResponse)
async def login(req: LoginRequest):
    db = await get_async_db()
    try:
        cursor = await db.execute(
            "SELECT id, username, display_name, password_hash, role, is_active FROM users WHERE username = ?",
            (req.username,),
        )
        user = await cursor.fetchone()
        if not user or not verify_password(req.password, user["password_hash"]):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="用户名或密码错误",
            )
        if not user["is_active"]:
            raise HTTPException(status_code=403, detail="账户已停用")
        token = create_access_token({"sub": str(user["id"])})
        return LoginResponse(
            access_token=token,
            user={
                "id": user["id"],
                "username": user["username"],
                "display_name": user["display_name"],
                "role": user["role"],
            },
        )
    finally:
        await db.close()


@router.post("/register")
async def register(req: RegisterRequest):
    if not settings.ALLOW_REGISTRATION:
        raise HTTPException(status_code=403, detail="暂不开放注册")
    if len(req.password) < 8:
        raise HTTPException(status_code=400, detail="密码长度至少8位")
    if not re.match(r"^[a-zA-Z0-9_]{3,20}$", req.username):
        raise HTTPException(
            status_code=400, detail="用户名须为3-20位字母、数字或下划线"
        )

    db = await get_async_db()
    try:
        cursor = await db.execute(
            "SELECT id FROM users WHERE username = ?", (req.username,)
        )
        if await cursor.fetchone():
            raise HTTPException(status_code=409, detail="用户名已存在")

        pw_hash = hash_password(req.password)
        display = req.display_name or req.username
        cursor = await db.execute(
            "INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, 'user')",
            (req.username, pw_hash, display),
        )
        await db.commit()
        user_id = cursor.lastrowid
        token = create_access_token({"sub": str(user_id)})
        return {
            "access_token": token,
            "token_type": "bearer",
            "user": {
                "id": user_id,
                "username": req.username,
                "display_name": display,
                "role": "user",
            },
        }
    finally:
        await db.close()


@router.get("/registration-status")
async def registration_status():
    """Check if registration is open (public endpoint)"""
    return {"allow_registration": settings.ALLOW_REGISTRATION}


@router.get("/me")
async def get_me(user: dict = Depends(get_current_user)):
    return user


@router.post("/refresh")
async def refresh_token(user: dict = Depends(get_current_user)):
    token = create_access_token({"sub": str(user["id"])})
    return {"access_token": token, "token_type": "bearer"}


@router.post("/change-password")
async def change_password(
    req: ChangePasswordRequest,
    user: dict = Depends(get_current_user),
):
    db = await get_async_db()
    try:
        cursor = await db.execute(
            "SELECT password_hash FROM users WHERE id = ?", (user["id"],)
        )
        row = await cursor.fetchone()
        if not row or not verify_password(req.old_password, row["password_hash"]):
            raise HTTPException(status_code=400, detail="旧密码错误")
        new_hash = hash_password(req.new_password)
        await db.execute(
            "UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (new_hash, user["id"]),
        )
        await db.commit()
        return {"message": "密码修改成功"}
    finally:
        await db.close()


@router.patch("/profile")
async def update_profile(
    req: ProfileUpdate,
    user: dict = Depends(get_current_user),
):
    db = await get_async_db()
    try:
        if req.display_name is not None:
            await db.execute(
                "UPDATE users SET display_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (req.display_name, user["id"]),
            )
            await db.commit()
        return {"message": "已更新"}
    finally:
        await db.close()
