from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.auth import hash_password, verify_password, create_access_token
from app.database import get_async_db

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str


@router.post("/login", response_model=LoginResponse)
async def login(req: LoginRequest):
    db = await get_async_db()
    try:
        cursor = await db.execute(
            "SELECT id, username, display_name, password_hash FROM users WHERE username = ?",
            (req.username,),
        )
        user = await cursor.fetchone()
        if not user or not verify_password(req.password, user["password_hash"]):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="用户名或密码错误",
            )
        token = create_access_token({"sub": user["id"]})
        return LoginResponse(
            access_token=token,
            user={"id": user["id"], "username": user["username"], "display_name": user["display_name"]},
        )
    finally:
        await db.close()


@router.get("/me")
async def get_me(user: dict = __import__("fastapi").Depends(__import__("app.auth", fromlist=["get_current_user"]).get_current_user)):
    return user


@router.post("/change-password")
async def change_password(
    req: ChangePasswordRequest,
    user: dict = __import__("fastapi").Depends(__import__("app.auth", fromlist=["get_current_user"]).get_current_user),
):
    db = await get_async_db()
    try:
        cursor = await db.execute("SELECT password_hash FROM users WHERE id = ?", (user["id"],))
        row = await cursor.fetchone()
        if not row or not verify_password(req.old_password, row["password_hash"]):
            raise HTTPException(status_code=400, detail="旧密码错误")
        new_hash = hash_password(req.new_password)
        await db.execute("UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (new_hash, user["id"]))
        await db.commit()
        return {"message": "密码修改成功"}
    finally:
        await db.close()
