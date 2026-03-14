from fastapi import APIRouter, Depends, Query
from app.auth import get_current_user
from app.database import get_async_db

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("/summary")
async def get_summary(user: dict = Depends(get_current_user)):
    db = await get_async_db()
    try:
        uid = user["id"]

        # Total assets
        cursor = await db.execute("SELECT COALESCE(SUM(balance), 0) as total FROM accounts WHERE user_id = ?", (uid,))
        total_assets = (await cursor.fetchone())["total"]

        # This month income/expense
        cursor = await db.execute("""
            SELECT
                COALESCE(SUM(CASE WHEN direction='收入' THEN amount ELSE 0 END), 0) as income,
                COALESCE(SUM(CASE WHEN direction='支出' THEN amount ELSE 0 END), 0) as expense
            FROM transactions
            WHERE user_id = ? AND strftime('%Y-%m', tx_time) = strftime('%Y-%m', 'now')
        """, (uid,))
        row = await cursor.fetchone()
        income = row["income"]
        expense = row["expense"]

        # Last month for comparison
        cursor = await db.execute("""
            SELECT
                COALESCE(SUM(CASE WHEN direction='收入' THEN amount ELSE 0 END), 0) as income,
                COALESCE(SUM(CASE WHEN direction='支出' THEN amount ELSE 0 END), 0) as expense
            FROM transactions
            WHERE user_id = ? AND strftime('%Y-%m', tx_time) = strftime('%Y-%m', 'now', '-1 month')
        """, (uid,))
        last = await cursor.fetchone()

        # Recent transactions
        cursor = await db.execute("""
            SELECT id, tx_id, tx_time, platform, account, direction, amount, category, counterparty, note
            FROM transactions WHERE user_id = ?
            ORDER BY tx_time DESC LIMIT 10
        """, (uid,))
        recent = [dict(r) for r in await cursor.fetchall()]

        # Transaction count
        cursor = await db.execute("SELECT COUNT(*) as cnt FROM transactions WHERE user_id = ?", (uid,))
        tx_count = (await cursor.fetchone())["cnt"]

        return {
            "total_assets": round(total_assets, 2),
            "this_month": {
                "income": round(income, 2),
                "expense": round(expense, 2),
                "net": round(income - expense, 2),
            },
            "last_month": {
                "income": round(last["income"], 2),
                "expense": round(last["expense"], 2),
            },
            "transaction_count": tx_count,
            "recent_transactions": recent,
        }
    finally:
        await db.close()


@router.get("/trend")
async def get_trend(months: int = Query(6, ge=1, le=24), user: dict = Depends(get_current_user)):
    db = await get_async_db()
    try:
        cursor = await db.execute("""
            SELECT
                strftime('%Y-%m', tx_time) as month,
                COALESCE(SUM(CASE WHEN direction='收入' THEN amount ELSE 0 END), 0) as income,
                COALESCE(SUM(CASE WHEN direction='支出' THEN amount ELSE 0 END), 0) as expense
            FROM transactions
            WHERE user_id = ? AND tx_time >= date('now', ? || ' months')
            GROUP BY strftime('%Y-%m', tx_time)
            ORDER BY month
        """, (user["id"], f"-{months}"))
        rows = [dict(r) for r in await cursor.fetchall()]
        for r in rows:
            r["income"] = round(r["income"], 2)
            r["expense"] = round(r["expense"], 2)
            r["net"] = round(r["income"] - r["expense"], 2)
        return {"months": rows}
    finally:
        await db.close()


@router.get("/category")
async def get_category(month: str = Query(None), user: dict = Depends(get_current_user)):
    db = await get_async_db()
    try:
        month_filter = month or "strftime('%Y-%m', 'now')"
        if month:
            cursor = await db.execute("""
                SELECT category, ROUND(SUM(amount), 2) as total
                FROM transactions
                WHERE user_id = ? AND direction = '支出' AND strftime('%Y-%m', tx_time) = ?
                GROUP BY category ORDER BY total DESC
            """, (user["id"], month))
        else:
            cursor = await db.execute("""
                SELECT category, ROUND(SUM(amount), 2) as total
                FROM transactions
                WHERE user_id = ? AND direction = '支出' AND strftime('%Y-%m', tx_time) = strftime('%Y-%m', 'now')
                GROUP BY category ORDER BY total DESC
            """, (user["id"],))
        rows = [dict(r) for r in await cursor.fetchall()]
        return {"categories": rows}
    finally:
        await db.close()
