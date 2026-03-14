from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from app.auth import get_current_user
from app.database import get_async_db

router = APIRouter(prefix="/api/accounts", tags=["accounts"])


class AccountCreate(BaseModel):
    name: str
    platform: str
    account_type: str  # checking/savings/credit/ewallet
    balance: float = 0
    currency: str = "CNY"


class AccountUpdate(BaseModel):
    name: Optional[str] = None
    balance: Optional[float] = None
    account_type: Optional[str] = None


@router.get("")
async def list_accounts(user: dict = Depends(get_current_user)):
    db = await get_async_db()
    try:
        cursor = await db.execute(
            "SELECT * FROM accounts WHERE user_id = ? ORDER BY platform, name", (user["id"],)
        )
        return {"items": [dict(r) for r in await cursor.fetchall()]}
    finally:
        await db.close()


@router.post("")
async def create_account(req: AccountCreate, user: dict = Depends(get_current_user)):
    db = await get_async_db()
    try:
        cursor = await db.execute(
            "INSERT INTO accounts (user_id, name, platform, account_type, balance, currency) VALUES (?, ?, ?, ?, ?, ?)",
            (user["id"], req.name, req.platform, req.account_type, req.balance, req.currency),
        )
        await db.commit()
        return {"id": cursor.lastrowid, "message": "账户创建成功"}
    finally:
        await db.close()


@router.patch("/{account_id}")
async def update_account(account_id: int, req: AccountUpdate, user: dict = Depends(get_current_user)):
    db = await get_async_db()
    try:
        updates = []
        params = []
        for field, value in req.model_dump(exclude_none=True).items():
            updates.append(f"{field} = ?")
            params.append(value)
        if not updates:
            raise HTTPException(status_code=400, detail="没有要更新的字段")
        params.extend([account_id, user["id"]])
        await db.execute(f"UPDATE accounts SET {', '.join(updates)} WHERE id = ? AND user_id = ?", params)
        await db.commit()
        return {"message": "更新成功"}
    finally:
        await db.close()


@router.delete("/{account_id}")
async def delete_account(account_id: int, user: dict = Depends(get_current_user)):
    db = await get_async_db()
    try:
        cursor = await db.execute("DELETE FROM accounts WHERE id = ? AND user_id = ?", (account_id, user["id"]))
        await db.commit()
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="账户不存在")
        return {"message": "删除成功"}
    finally:
        await db.close()
