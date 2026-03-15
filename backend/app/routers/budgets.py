"""
Budget router - Manage monthly budgets per category
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from datetime import datetime
from app.auth import get_current_user
from app.database import get_async_db

router = APIRouter(prefix="/api/budgets", tags=["budgets"])


class BudgetCreate(BaseModel):
    category: str
    monthly_amount: float


class BudgetUpdate(BaseModel):
    monthly_amount: float | None = None
    enabled: bool | None = None


@router.get("")
async def list_budgets(user: dict = Depends(get_current_user)):
    db = await get_async_db()

    # Get current month spending per category
    now = datetime.now()
    month_start = now.strftime("%Y-%m-01 00:00:00")
    next_month = now.month + 1
    next_year = now.year
    if next_month > 12:
        next_month = 1
        next_year += 1
    month_end = f"{next_year}-{next_month:02d}-01 00:00:00"

    # Get spending
    cursor = await db.execute("""
        SELECT category, SUM(amount) FROM transactions
        WHERE user_id = ? AND direction = '支出' AND tx_time >= ? AND tx_time < ?
        GROUP BY category
    """, (user["id"], month_start, month_end))
    spending = {r[0]: r[1] for r in await cursor.fetchall()}

    # Get budgets
    cursor = await db.execute("""
        SELECT id, category, monthly_amount, enabled FROM budgets
        WHERE user_id = ? ORDER BY category
    """, (user["id"],))
    items = []
    for r in await cursor.fetchall():
        items.append({
            "id": r[0],
            "category": r[1],
            "monthly_amount": r[2],
            "enabled": bool(r[3]),
            "spent": spending.get(r[1], 0),
        })
    return {"items": items}


@router.post("")
async def create_budget(data: BudgetCreate, user: dict = Depends(get_current_user)):
    db = await get_async_db()
    try:
        await db.execute("""
            INSERT INTO budgets (user_id, category, monthly_amount)
            VALUES (?, ?, ?)
            ON CONFLICT(user_id, category) DO UPDATE SET monthly_amount = ?, updated_at = CURRENT_TIMESTAMP
        """, (user["id"], data.category, data.monthly_amount, data.monthly_amount))
        await db.commit()
        return {"message": "ok"}
    except Exception as e:
        raise HTTPException(500, str(e))


@router.patch("/{budget_id}")
async def update_budget(budget_id: int, data: BudgetUpdate, user: dict = Depends(get_current_user)):
    db = await get_async_db()
    updates = []
    params = []
    if data.monthly_amount is not None:
        updates.append("monthly_amount = ?")
        params.append(data.monthly_amount)
    if data.enabled is not None:
        updates.append("enabled = ?")
        params.append(int(data.enabled))
    if not updates:
        return {"message": "nothing to update"}
    updates.append("updated_at = CURRENT_TIMESTAMP")
    params.extend([budget_id, user["id"]])
    await db.execute(
        f"UPDATE budgets SET {', '.join(updates)} WHERE id = ? AND user_id = ?",
        params,
    )
    await db.commit()
    return {"message": "ok"}


@router.delete("/{budget_id}")
async def delete_budget(budget_id: int, user: dict = Depends(get_current_user)):
    db = await get_async_db()
    await db.execute("DELETE FROM budgets WHERE id = ? AND user_id = ?", (budget_id, user["id"]))
    await db.commit()
    return {"message": "ok"}
