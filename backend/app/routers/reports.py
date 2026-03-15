from fastapi import APIRouter, Depends, HTTPException, Query
import json
from datetime import datetime
from app.auth import get_current_user
from app.database import get_async_db
from app.ai_analysis import generate_analysis

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
async def generate_report_endpoint(
    period: str = Query(None, description="YYYY-MM format, defaults to current month"),
    user: dict = Depends(get_current_user),
):
    if not period:
        period = datetime.now().strftime("%Y-%m")

    db = await get_async_db()
    try:
        # Gather current month data
        cursor = await db.execute("""
            SELECT direction, category, ROUND(SUM(amount), 2) as total, COUNT(*) as count
            FROM transactions
            WHERE user_id = ? AND strftime('%Y-%m', tx_time) = ?
            GROUP BY direction, category
            ORDER BY total DESC
        """, (user["id"], period))
        breakdown = [dict(r) for r in await cursor.fetchall()]

        cursor = await db.execute("""
            SELECT
                COALESCE(SUM(CASE WHEN direction='收入' THEN amount ELSE 0 END), 0) as income,
                COALESCE(SUM(CASE WHEN direction='支出' THEN amount ELSE 0 END), 0) as expense,
                COUNT(*) as tx_count
            FROM transactions
            WHERE user_id = ? AND strftime('%Y-%m', tx_time) = ?
        """, (user["id"], period))
        summary = dict(await cursor.fetchone())

        # Top transactions for context
        cursor = await db.execute("""
            SELECT tx_time, platform, direction, amount, category, counterparty, note
            FROM transactions
            WHERE user_id = ? AND strftime('%Y-%m', tx_time) = ? AND direction = '支出'
            ORDER BY amount DESC
            LIMIT 15
        """, (user["id"], period))
        top_transactions = [dict(r) for r in await cursor.fetchall()]

        raw_data = {
            "period": period,
            "summary": summary,
            "breakdown": breakdown,
            "top_expenses": top_transactions,
        }
        raw_data_json = json.dumps(raw_data, ensure_ascii=False)

        # Get previous month data for comparison
        prev_month_data = None
        try:
            y, m = int(period[:4]), int(period[5:7])
            if m == 1:
                prev_period = f"{y-1}-12"
            else:
                prev_period = f"{y}-{m-1:02d}"

            cursor = await db.execute("""
                SELECT
                    COALESCE(SUM(CASE WHEN direction='收入' THEN amount ELSE 0 END), 0) as income,
                    COALESCE(SUM(CASE WHEN direction='支出' THEN amount ELSE 0 END), 0) as expense,
                    COUNT(*) as tx_count
                FROM transactions
                WHERE user_id = ? AND strftime('%Y-%m', tx_time) = ?
            """, (user["id"], prev_period))
            prev_summary = dict(await cursor.fetchone())
            if prev_summary["tx_count"] > 0:
                prev_month_data = {"period": prev_period, "summary": prev_summary}
        except Exception:
            pass

        # Generate AI analysis
        ai_text = await generate_analysis(raw_data, prev_month_data)

        # Save or update report
        cursor = await db.execute(
            "SELECT id FROM analysis_reports WHERE user_id = ? AND period = ? AND report_type = 'monthly'",
            (user["id"], period),
        )
        existing = await cursor.fetchone()

        if existing:
            await db.execute(
                "UPDATE analysis_reports SET raw_data_json = ?, ai_analysis = ?, status = 'completed' WHERE id = ?",
                (raw_data_json, ai_text, existing["id"]),
            )
            await db.commit()
            report_id = existing["id"]
        else:
            cursor = await db.execute(
                """INSERT INTO analysis_reports (user_id, period, report_type, raw_data_json, ai_analysis, status)
                   VALUES (?, ?, 'monthly', ?, ?, 'completed')""",
                (user["id"], period, raw_data_json, ai_text),
            )
            await db.commit()
            report_id = cursor.lastrowid

        return {
            "message": f"{period} 报告已生成",
            "report_id": report_id,
            "status": "completed",
        }
    finally:
        await db.close()
