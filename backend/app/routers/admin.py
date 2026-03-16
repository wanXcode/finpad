from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import require_admin, hash_password
from app.database import get_async_db

router = APIRouter(prefix="/api/admin", tags=["admin"])


class UserUpdate(BaseModel):
    role: Optional[str] = None
    is_active: Optional[bool] = None
    new_password: Optional[str] = None
    display_name: Optional[str] = None


@router.get("/users")
async def list_users(admin: dict = Depends(require_admin)):
    db = await get_async_db()
    try:
        cursor = await db.execute("""
            SELECT u.id, u.username, u.display_name, u.role, u.is_active, u.created_at,
                   COUNT(t.id) as tx_count
            FROM users u LEFT JOIN transactions t ON u.id = t.user_id
            GROUP BY u.id ORDER BY u.created_at DESC
        """)
        users = []
        for row in await cursor.fetchall():
            users.append({
                "id": row["id"],
                "username": row["username"],
                "display_name": row["display_name"],
                "role": row["role"],
                "is_active": bool(row["is_active"]),
                "created_at": row["created_at"],
                "tx_count": row["tx_count"],
            })
        return {"items": users, "total": len(users)}
    finally:
        await db.close()


@router.patch("/users/{user_id}")
async def update_user(
    user_id: int,
    data: UserUpdate,
    admin: dict = Depends(require_admin),
):
    # Prevent admin from demoting themselves
    if user_id == admin["id"] and data.role and data.role != "admin":
        raise HTTPException(400, "不能降级自己的管理员权限")
    if user_id == admin["id"] and data.is_active is False:
        raise HTTPException(400, "不能停用自己的账户")

    db = await get_async_db()
    try:
        updates = []
        params = []
        if data.role is not None:
            if data.role not in ("admin", "user"):
                raise HTTPException(400, "角色只能是 admin 或 user")
            updates.append("role = ?")
            params.append(data.role)
        if data.is_active is not None:
            updates.append("is_active = ?")
            params.append(int(data.is_active))
        if data.new_password is not None:
            if len(data.new_password) < 8:
                raise HTTPException(400, "密码长度至少8位")
            updates.append("password_hash = ?")
            params.append(hash_password(data.new_password))
        if data.display_name is not None:
            updates.append("display_name = ?")
            params.append(data.display_name)

        if not updates:
            return {"message": "nothing to update"}

        updates.append("updated_at = CURRENT_TIMESTAMP")
        params.append(user_id)

        result = await db.execute(
            f"UPDATE users SET {', '.join(updates)} WHERE id = ?", params
        )
        await db.commit()

        if result.rowcount == 0:
            raise HTTPException(404, "用户不存在")

        return {"message": "已更新"}
    finally:
        await db.close()
