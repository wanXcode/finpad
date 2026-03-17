"""
Import router - Upload and parse CSV/Excel files
"""
import io
import csv
import json
from datetime import datetime
from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from app.auth import get_current_user
from app.database import get_async_db

router = APIRouter(prefix="/api/import", tags=["import"])

PLATFORM_DETECT = {
    "alipay": ["交易号", "商家订单号", "交易创建时间"],
    "wechat": ["微信支付账单", "交易时间", "交易类型"],
}


def detect_platform(headers: list[str], content_preview: str) -> str:
    normalized_headers = [str(h).replace("\ufeff", "").strip() for h in headers]
    joined_headers = "|".join(normalized_headers)

    for h in normalized_headers:
        if "交易号" in h or "商家订单号" in h or "交易创建时间" in h:
            return "alipay"
        if "微信支付" in h or "交易单号" in h or "交易类型" in h:
            return "wechat"

    if any(k in joined_headers for k in ["交易号", "商家订单号", "交易创建时间", "支付宝"]):
        return "alipay"
    if any(k in joined_headers for k in ["微信支付", "交易单号", "交易类型"]):
        return "wechat"

    if any(k in content_preview for k in ["交易号", "商家订单号", "交易创建时间", "支付宝"]):
        return "alipay"
    if any(k in content_preview for k in ["微信支付", "交易单号", "交易类型"]):
        return "wechat"
    return "unknown"


def parse_csv_preview(content: bytes, filename: str):
    """Parse CSV and return preview data"""
    text = content.decode("utf-8-sig", errors="replace")
    lines = text.strip().split("\n")

    # Skip leading comment lines (Alipay CSVs have header comments)
    data_start = 0
    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped and not stripped.startswith("#") and not stripped.startswith("-"):
            # Check if this looks like a header row
            if "," in stripped or "\t" in stripped:
                data_start = i
                break

    reader = csv.reader(lines[data_start:])
    rows = list(reader)
    if len(rows) < 2:
        raise ValueError("文件内容为空或格式不正确")

    headers = [h.strip() for h in rows[0]]
    data_rows = rows[1:]
    platform = detect_platform(headers, text[:500])

    return {
        "headers": headers,
        "preview_rows": [r for r in data_rows[:10]],
        "total_rows": len(data_rows),
        "platform": platform,
        "filename": filename,
    }


def parse_xlsx_preview(content: bytes, filename: str):
    """Parse Excel and return preview data"""
    try:
        import openpyxl
        wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True)
        ws = wb.active
        rows = []
        for row in ws.iter_rows(values_only=True):
            rows.append([str(c) if c is not None else "" for c in row])
        wb.close()
    except Exception as e:
        raise ValueError(f"无法解析 Excel 文件: {e}")

    if len(rows) < 2:
        raise ValueError("文件内容为空")

    # Find header row (skip comment rows)
    header_idx = 0
    for i, row in enumerate(rows):
        non_empty = [c for c in row if c.strip()]
        if len(non_empty) >= 3:
            header_idx = i
            break

    headers = [h.strip() for h in rows[header_idx]]
    data_rows = rows[header_idx + 1:]
    content_preview = str(rows[:5])
    platform = detect_platform(headers, content_preview)

    return {
        "headers": headers,
        "preview_rows": data_rows[:10],
        "total_rows": len(data_rows),
        "platform": platform,
        "filename": filename,
    }


@router.post("/upload")
async def upload_preview(
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    content = await file.read()
    filename = file.filename or "unknown"

    if filename.lower().endswith(".csv"):
        preview = parse_csv_preview(content, filename)
    elif filename.lower().endswith((".xlsx", ".xls")):
        preview = parse_xlsx_preview(content, filename)
    else:
        raise HTTPException(400, "不支持的文件格式，请上传 CSV 或 Excel 文件")

    return preview


@router.post("/confirm")
async def confirm_import(
    file: UploadFile = File(...),
    platform: str = Form("alipay"),
    user: dict = Depends(get_current_user),
):
    if platform == "unknown":
        raise HTTPException(400, "未识别账单类型，请先手动选择 支付宝 / 微信 后再确认导入")

    content = await file.read()
    filename = file.filename or "unknown"
    db = await get_async_db()

    try:
        # Parse file
        if filename.lower().endswith(".csv"):
            text = content.decode("utf-8-sig", errors="replace")
            lines = text.strip().split("\n")
            data_start = 0
            for i, line in enumerate(lines):
                stripped = line.strip()
                if stripped and not stripped.startswith("#") and not stripped.startswith("-"):
                    if "," in stripped:
                        data_start = i
                        break
            reader = csv.reader(lines[data_start:])
            rows = list(reader)
            headers = [h.strip() for h in rows[0]]
            data_rows = rows[1:]
        elif filename.lower().endswith((".xlsx", ".xls")):
            import openpyxl
            wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True)
            ws = wb.active
            all_rows = []
            for row in ws.iter_rows(values_only=True):
                all_rows.append([str(c) if c is not None else "" for c in row])
            wb.close()
            header_idx = 0
            for i, row in enumerate(all_rows):
                non_empty = [c for c in row if c.strip()]
                if len(non_empty) >= 3:
                    header_idx = i
                    break
            headers = [h.strip() for h in all_rows[header_idx]]
            data_rows = all_rows[header_idx + 1:]
        else:
            raise HTTPException(400, "不支持的文件格式")

        created = 0
        skipped = 0
        failed = 0
        total = len(data_rows)

        # Platform-specific parsing
        if platform == "alipay":
            created, skipped, failed = await _import_alipay(db, headers, data_rows, user["id"])
        elif platform == "wechat":
            created, skipped, failed = await _import_wechat(db, headers, data_rows, user["id"])
        else:
            raise HTTPException(400, f"暂不支持 {platform} 格式的导入")

        # Log import
        await db.execute("""
            INSERT INTO import_logs (user_id, filename, platform, file_size, total_records, created_records, skipped_records, failed_records, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed')
        """, (user["id"], filename, platform, len(content), total, created, skipped, failed))
        await db.commit()

        return {"total": total, "created": created, "skipped": skipped, "failed": failed}

    except HTTPException:
        raise
    except Exception as e:
        await db.execute("""
            INSERT INTO import_logs (user_id, filename, platform, file_size, status, error_message)
            VALUES (?, ?, ?, ?, 'error', ?)
        """, (user["id"], filename, platform, len(content), str(e)))
        await db.commit()
        raise HTTPException(500, f"导入失败: {e}")


async def _import_alipay(db, headers: list, rows: list, user_id: int):
    """Import Alipay CSV data"""
    # Build header index
    idx = {h: i for i, h in enumerate(headers)}
    created = skipped = failed = 0

    for row in rows:
        if not row or all(not c.strip() for c in row):
            continue
        try:
            tx_no = row[idx.get("交易号", 0)].strip() if "交易号" in idx else ""
            if not tx_no:
                failed += 1
                continue
            tx_id = f"alipay_{tx_no}"

            # Check duplicate within current user only
            cursor = await db.execute(
                "SELECT id FROM transactions WHERE user_id = ? AND tx_id = ?",
                (user_id, tx_id),
            )
            if await cursor.fetchone():
                skipped += 1
                continue

            tx_time = row[idx.get("交易创建时间", idx.get("交易时间", 1))].strip()
            amount_str = row[idx.get("金额（元）", idx.get("金额", 5))].strip().replace(",", "")
            amount = abs(float(amount_str)) if amount_str else 0

            direction_raw = row[idx.get("收/支", idx.get("资金状态", 6))].strip() if "收/支" in idx or "资金状态" in idx else ""
            if "支出" in direction_raw:
                direction = "支出"
            elif "收入" in direction_raw:
                direction = "收入"
            elif "不计" in direction_raw:
                direction = "不计收支"
            else:
                direction = "不计收支"

            category = row[idx.get("交易分类", 12)].strip() if "交易分类" in idx and idx["交易分类"] < len(row) else "其他"
            counterparty = row[idx.get("交易对方", 2)].strip() if "交易对方" in idx else ""
            note = row[idx.get("商品名称", idx.get("商品说明", 3))].strip() if "商品名称" in idx or "商品说明" in idx else ""

            await db.execute("""
                INSERT INTO transactions (user_id, tx_id, tx_time, platform, account, direction, amount, category, original_category, counterparty, note, source)
                VALUES (?, ?, ?, '支付宝', '余额宝', ?, ?, ?, ?, ?, ?, 'manual_upload')
            """, (user_id, tx_id, tx_time, direction, amount, category, category, counterparty, note))
            created += 1

        except Exception:
            failed += 1

    await db.commit()
    return created, skipped, failed


async def _import_wechat(db, headers: list, rows: list, user_id: int):
    """Import WeChat Excel/CSV data"""
    idx = {h: i for i, h in enumerate(headers)}
    created = skipped = failed = 0

    for row in rows:
        if not row or all(not str(c).strip() for c in row):
            continue
        try:
            tx_no = str(row[idx.get("交易单号", 8)]).strip() if "交易单号" in idx else ""
            if not tx_no or tx_no == "None":
                failed += 1
                continue
            tx_id = f"wechat_{tx_no}"

            cursor = await db.execute(
                "SELECT id FROM transactions WHERE user_id = ? AND tx_id = ?",
                (user_id, tx_id),
            )
            if await cursor.fetchone():
                skipped += 1
                continue

            tx_time = str(row[idx.get("交易时间", 0)]).strip()
            amount_str = str(row[idx.get("金额(元)", idx.get("金额", 5))]).strip().replace("¥", "").replace(",", "")
            amount = abs(float(amount_str)) if amount_str else 0

            direction_raw = str(row[idx.get("收/支", 4)]).strip() if "收/支" in idx else ""
            if "支出" in direction_raw:
                direction = "支出"
            elif "收入" in direction_raw:
                direction = "收入"
            else:
                direction = "不计收支"

            category = str(row[idx.get("交易类型", 1)]).strip() if "交易类型" in idx else "其他"
            counterparty = str(row[idx.get("交易对方", 2)]).strip() if "交易对方" in idx else ""
            note = str(row[idx.get("商品", 3)]).strip() if "商品" in idx else ""

            await db.execute("""
                INSERT INTO transactions (user_id, tx_id, tx_time, platform, account, direction, amount, category, original_category, counterparty, note, source)
                VALUES (?, ?, ?, '微信', '零钱', ?, ?, ?, ?, ?, ?, 'manual_upload')
            """, (user_id, tx_id, tx_time, direction, amount, category, category, counterparty, note))
            created += 1

        except Exception:
            failed += 1

    await db.commit()
    return created, skipped, failed


@router.get("/history")
async def import_history(
    user: dict = Depends(get_current_user),
):
    db = await get_async_db()
    cursor = await db.execute("""
        SELECT id, filename, platform, total_records, created_records, skipped_records, status, created_at
        FROM import_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 20
    """, (user["id"],))
    rows = await cursor.fetchall()
    items = []
    for r in rows:
        items.append({
            "id": r[0], "filename": r[1], "platform": r[2],
            "total_records": r[3], "created_records": r[4],
            "skipped_records": r[5], "status": r[6], "created_at": r[7],
        })
    return {"items": items}
