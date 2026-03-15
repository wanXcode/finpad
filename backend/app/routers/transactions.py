from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import BaseModel
from typing import Optional
from app.auth import get_current_user
from app.database import get_async_db

router = APIRouter(prefix="/api/transactions", tags=["transactions"])


class TransactionUpdate(BaseModel):
    category: Optional[str] = None
    note: Optional[str] = None
    direction: Optional[str] = None


class TransactionCreate(BaseModel):
    tx_time: str
    platform: str = ""
    account: str = ""
    direction: str = "支出"
    amount: float = 0
    category: str = "其他"
    counterparty: str = ""
    note: str = ""


@router.get("")
async def list_transactions(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    platform: Optional[str] = None,
    direction: Optional[str] = None,
    category: Optional[str] = None,
    search: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    min_amount: Optional[float] = None,
    max_amount: Optional[float] = None,
    amount_min: Optional[float] = None,
    amount_max: Optional[float] = None,
    user: dict = Depends(get_current_user),
):
    db = await get_async_db()
    try:
        conditions = ["user_id = ?"]
        params = [user["id"]]

        if platform:
            conditions.append("platform = ?")
            params.append(platform)
        if direction:
            conditions.append("direction = ?")
            params.append(direction)
        if category:
            conditions.append("category = ?")
            params.append(category)
        if search:
            conditions.append("(counterparty LIKE ? OR note LIKE ?)")
            params.extend([f"%{search}%", f"%{search}%"])
        effective_start = start_date or date_from
        effective_end = end_date or date_to
        effective_min = min_amount if min_amount is not None else amount_min
        effective_max = max_amount if max_amount is not None else amount_max
        if effective_start:
            conditions.append("tx_time >= ?")
            params.append(effective_start)
        if effective_end:
            conditions.append("tx_time <= ?")
            params.append(effective_end + " 23:59:59" if len(effective_end) == 10 else effective_end)
        if effective_min is not None:
            conditions.append("amount >= ?")
            params.append(effective_min)
        if effective_max is not None:
            conditions.append("amount <= ?")
            params.append(effective_max)

        where = " AND ".join(conditions)

        # Count
        cursor = await db.execute(f"SELECT COUNT(*) as cnt FROM transactions WHERE {where}", params)
        total = (await cursor.fetchone())["cnt"]

        # Data
        offset = (page - 1) * page_size
        cursor = await db.execute(
            f"""SELECT id, tx_id, tx_time, platform, account, direction, amount,
                       category, original_category, counterparty, note, source, created_at
                FROM transactions WHERE {where}
                ORDER BY tx_time DESC LIMIT ? OFFSET ?""",
            params + [page_size, offset],
        )
        rows = [dict(r) for r in await cursor.fetchall()]

        return {
            "items": rows,
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": (total + page_size - 1) // page_size,
        }
    finally:
        await db.close()


@router.post("")
async def create_transaction(req: TransactionCreate, user: dict = Depends(get_current_user)):
    import hashlib
    from datetime import datetime
    db = await get_async_db()
    try:
        tx_id = f"manual_{hashlib.sha1(f'{req.tx_time}|{req.amount}|{req.counterparty}|{datetime.utcnow().isoformat()}'.encode()).hexdigest()[:16]}"
        cursor = await db.execute(
            """INSERT INTO transactions
               (user_id, tx_id, tx_time, platform, account, direction, amount, category, original_category, counterparty, note, source)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual')""",
            (user["id"], tx_id, req.tx_time, req.platform, req.account, req.direction,
             req.amount, req.category, req.category, req.counterparty, req.note),
        )
        await db.commit()
        return {"id": cursor.lastrowid, "tx_id": tx_id, "message": "交易创建成功"}
    finally:
        await db.close()


@router.get("/{tx_id}")
async def get_transaction(tx_id: int, user: dict = Depends(get_current_user)):
    db = await get_async_db()
    try:
        cursor = await db.execute(
            "SELECT * FROM transactions WHERE id = ? AND user_id = ?", (tx_id, user["id"])
        )
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="交易记录不存在")
        return dict(row)
    finally:
        await db.close()


@router.patch("/{tx_id}")
async def update_transaction(tx_id: int, req: TransactionUpdate, user: dict = Depends(get_current_user)):
    db = await get_async_db()
    try:
        updates = []
        params = []
        for field, value in req.model_dump(exclude_none=True).items():
            updates.append(f"{field} = ?")
            params.append(value)

        if not updates:
            raise HTTPException(status_code=400, detail="没有要更新的字段")

        params.extend([tx_id, user["id"]])
        cursor = await db.execute(
            f"UPDATE transactions SET {', '.join(updates)} WHERE id = ? AND user_id = ?",
            params,
        )
        await db.commit()
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="交易记录不存在")
        return {"message": "更新成功"}
    finally:
        await db.close()


@router.delete("/{tx_id}")
async def delete_transaction(tx_id: int, user: dict = Depends(get_current_user)):
    db = await get_async_db()
    try:
        cursor = await db.execute(
            "DELETE FROM transactions WHERE id = ? AND user_id = ?", (tx_id, user["id"])
        )
        await db.commit()
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="交易记录不存在")
        return {"message": "删除成功"}
    finally:
        await db.close()
