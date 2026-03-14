from fastapi import APIRouter, Depends, HTTPException, Query
from app.auth import get_current_user
from app.database import get_async_db

router = APIRouter(prefix="/api/reports", tags=["reports"])


@router.get("")
async def list_reports(
    page: int = Query(1, ge=1),
    page_size: int = Query(12, ge=1, le=50),
    user: dict = Depends(get_current_user),
):
    db = await get_async_db()
    try:
        cursor = await db.execute("SELECT COUNT(*) as cnt FROM analysis_reports WHERE user_id = ?", (user["id"],))
        total = (await cursor.fetchone())["cnt"]

        offset = (page - 1) * page_size
        cursor = await db.execute(
            """SELECT id, period, report_type, status, created_at
               FROM analysis_reports WHERE user_id = ?
               ORDER BY period DESC LIMIT ? OFFSET ?""",
            (user["id"], page_size, offset),
        )
        rows = [dict(r) for r in await cursor.fetchall()]
        return {"items": rows, "total": total, "page": page}
    finally:
        await db.close()


@router.get("/{report_id}")
async def get_report(report_id: int, user: dict = Depends(get_current_user)):
    db = await get_async_db()
    try:
        cursor = await db.execute(
            "SELECT * FROM analysis_reports WHERE id = ? AND user_id = ?", (report_id, user["id"])
        )
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="报告不存在")
        return dict(row)
    finally:
        await db.close()


@router.post("/generate")
async def generate_report(
    period: str = Query(None, description="YYYY-MM format, defaults to current month"),
    user: dict = Depends(get_current_user),
):
    """Trigger AI analysis report generation. Placeholder for now."""
    import json
    from datetime import datetime

    if not period:
        period = datetime.now().strftime("%Y-%m")

    db = await get_async_db()
    try:
        # Check if report exists
        cursor = await db.execute(
            "SELECT id, status FROM analysis_reports WHERE user_id = ? AND period = ? AND report_type = 'monthly'",
            (user["id"], period),
        )
        existing = await cursor.fetchone()

        # Gather raw data
        cursor = await db.execute("""
            SELECT direction, category, ROUND(SUM(amount), 2) as total, COUNT(*) as count
            FROM transactions
            WHERE user_id = ? AND strftime('%Y-%m', tx_time) = ?
            GROUP BY direction, category
            ORDER BY total DESC
        """, (user["id"], period))
        raw_rows = [dict(r) for r in await cursor.fetchall()]

        cursor = await db.execute("""
            SELECT
                COALESCE(SUM(CASE WHEN direction='收入' THEN amount ELSE 0 END), 0) as income,
                COALESCE(SUM(CASE WHEN direction='支出' THEN amount ELSE 0 END), 0) as expense,
                COUNT(*) as tx_count
            FROM transactions
            WHERE user_id = ? AND strftime('%Y-%m', tx_time) = ?
        """, (user["id"], period))
        summary = dict(await cursor.fetchone())

        raw_data = json.dumps({"summary": summary, "breakdown": raw_rows}, ensure_ascii=False)

        if existing:
            await db.execute(
                "UPDATE analysis_reports SET raw_data_json = ?, status = 'pending', ai_analysis = NULL WHERE id = ?",
                (raw_data, existing["id"]),
            )
            await db.commit()
            return {"message": f"{period} 报告已重新触发", "report_id": existing["id"], "status": "pending"}
        else:
            cursor = await db.execute(
                """INSERT INTO analysis_reports (user_id, period, report_type, raw_data_json, status)
                   VALUES (?, ?, 'monthly', ?, 'pending')""",
                (user["id"], period, raw_data),
            )
            await db.commit()
            return {"message": f"{period} 报告生成已触发", "report_id": cursor.lastrowid, "status": "pending"}

        # TODO: async call to AI API to fill ai_analysis
    finally:
        await db.close()
