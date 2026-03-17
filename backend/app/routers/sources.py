from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional
import json as _json
from pathlib import Path
from zipfile import ZipFile
import tempfile
import shutil
from app.auth import get_current_user
from app.database import get_async_db

router = APIRouter(prefix="/api/sources", tags=["sources"])


class SourceCreate(BaseModel):
    name: str
    type: str  # email_imap / manual_upload
    platform: str  # alipay / wechat / cmb / icbc
    config_json: Optional[str] = None
    sync_interval_minutes: int = 10


class SourceUpdate(BaseModel):
    name: Optional[str] = None
    platform: Optional[str] = None
    config_json: Optional[str] = None
    sync_interval_minutes: Optional[int] = None
    enabled: Optional[bool] = None


class UnlockRequest(BaseModel):
    password: str


@router.get("")
async def list_sources(user: dict = Depends(get_current_user)):
    db = await get_async_db()
    try:
        cursor = await db.execute(
            "SELECT * FROM data_sources WHERE user_id = ? ORDER BY created_at DESC", (user["id"],)
        )
        return {"items": [dict(r) for r in await cursor.fetchall()]}
    finally:
        await db.close()


@router.post("")
async def create_source(req: SourceCreate, user: dict = Depends(get_current_user)):
    db = await get_async_db()
    try:
        cursor = await db.execute(
            """INSERT INTO data_sources (user_id, name, type, platform, config_json, sync_interval_minutes)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (user["id"], req.name, req.type, req.platform, req.config_json, req.sync_interval_minutes),
        )
        await db.commit()
        return {"id": cursor.lastrowid, "message": "数据源创建成功"}
    finally:
        await db.close()


@router.patch("/{source_id}")
async def update_source(source_id: int, req: SourceUpdate, user: dict = Depends(get_current_user)):
    db = await get_async_db()
    try:
        updates = []
        params = []
        for field, value in req.model_dump(exclude_none=True).items():
            updates.append(f"{field} = ?")
            params.append(value)
        if not updates:
            raise HTTPException(status_code=400, detail="没有要更新的字段")
        params.extend([source_id, user["id"]])
        await db.execute(f"UPDATE data_sources SET {', '.join(updates)} WHERE id = ? AND user_id = ?", params)
        await db.commit()
        return {"message": "更新成功"}
    finally:
        await db.close()


@router.delete("/{source_id}")
async def delete_source(source_id: int, user: dict = Depends(get_current_user)):
    db = await get_async_db()
    try:
        cursor = await db.execute("DELETE FROM data_sources WHERE id = ? AND user_id = ?", (source_id, user["id"]))
        await db.commit()
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="数据源不存在")
        return {"message": "删除成功"}
    finally:
        await db.close()


@router.post("/{source_id}/sync")
async def trigger_sync(source_id: int, user: dict = Depends(get_current_user)):
    db = await get_async_db()
    try:
        cursor = await db.execute(
            "SELECT * FROM data_sources WHERE id = ? AND user_id = ?", (source_id, user["id"])
        )
        source = await cursor.fetchone()
        if not source:
            raise HTTPException(status_code=404, detail="数据源不存在")

        source = dict(source)
        src_type = source.get("type", "")
        config_json = source.get("config_json", "")

        if src_type == "email_imap" and config_json:
            try:
                config = _json.loads(config_json)
            except Exception as e:
                return {"message": f"配置解析失败: {str(e)[:200]}", "status": "error", "error": str(e)[:500]}

            # Parse platform — could be JSON array string or plain string
            platform_raw = source.get("platform", "alipay")
            platforms = []
            try:
                parsed = _json.loads(platform_raw)
                if isinstance(parsed, list):
                    platforms = parsed
                else:
                    platforms = [str(parsed)]
            except (ValueError, TypeError):
                platforms = [platform_raw]

            try:
                from app.sync_engine import sync_from_email
                result = sync_from_email(config, data_source_id=source_id, platforms=platforms)
                return {
                    "status": result.get("status", "success"),
                    "results": result.get("results", {}),
                    "message": result.get("message", f"同步完成: {source['name']}"),
                }
            except Exception as e:
                return {"message": f"IMAP连接失败: {str(e)[:200]}", "status": "error", "error": str(e)[:500]}
        else:
            return {"message": f"同步任务已触发: {source['name']}", "status": "queued"}
    except HTTPException:
        raise
    except Exception as e:
        return {"message": f"同步失败: {str(e)[:200]}", "status": "error", "error": str(e)[:500]}
    finally:
        await db.close()


# --- Sync logs ---

@router.get("/{source_id}/logs")
async def list_sync_logs(
    source_id: int,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user: dict = Depends(get_current_user),
):
    db = await get_async_db()
    try:
        # Verify ownership
        cursor = await db.execute(
            "SELECT id FROM data_sources WHERE id = ? AND user_id = ?", (source_id, user["id"])
        )
        if not await cursor.fetchone():
            raise HTTPException(status_code=404, detail="数据源不存在")

        cursor = await db.execute("SELECT COUNT(*) as cnt FROM sync_logs WHERE data_source_id = ?", (source_id,))
        total = (await cursor.fetchone())["cnt"]

        offset = (page - 1) * page_size
        cursor = await db.execute(
            "SELECT * FROM sync_logs WHERE data_source_id = ? ORDER BY started_at DESC LIMIT ? OFFSET ?",
            (source_id, page_size, offset),
        )
        rows = [dict(r) for r in await cursor.fetchall()]
        return {"items": rows, "total": total, "page": page, "page_size": page_size}
    finally:
        await db.close()


# --- Pending imports (encrypted ZIP password) ---

@router.get("/{source_id}/pending")
async def list_pending_imports(source_id: int, user: dict = Depends(get_current_user)):
    db = await get_async_db()
    try:
        # Verify ownership
        cursor = await db.execute(
            "SELECT id FROM data_sources WHERE id = ? AND user_id = ?", (source_id, user["id"])
        )
        if not await cursor.fetchone():
            raise HTTPException(status_code=404, detail="数据源不存在")

        cursor = await db.execute(
            """SELECT id, filename, subject, platform, status, created_at
               FROM pending_imports
               WHERE data_source_id = ? AND status = 'pending'
               ORDER BY created_at DESC""",
            (source_id,),
        )
        rows = [dict(r) for r in await cursor.fetchall()]
        return {"items": rows}
    finally:
        await db.close()


@router.post("/{source_id}/pending/{pending_id}/unlock")
async def unlock_pending_import(
    source_id: int,
    pending_id: int,
    req: UnlockRequest,
    user: dict = Depends(get_current_user),
):
    db = await get_async_db()
    try:
        # Verify ownership of source
        cursor = await db.execute(
            "SELECT id FROM data_sources WHERE id = ? AND user_id = ?", (source_id, user["id"])
        )
        if not await cursor.fetchone():
            raise HTTPException(status_code=404, detail="数据源不存在")

        # Get pending record
        cursor = await db.execute(
            "SELECT * FROM pending_imports WHERE id = ? AND data_source_id = ? AND status = 'pending'",
            (pending_id, source_id),
        )
        pending = await cursor.fetchone()
        if not pending:
            raise HTTPException(status_code=404, detail="待处理记录不存在")

        pending = dict(pending)
        raw_path = Path(pending["raw_path"])
        platform = pending["platform"]
        password = req.password

        if not raw_path.exists():
            await db.execute(
                "UPDATE pending_imports SET status = 'failed', error_message = '原始文件丢失' WHERE id = ?",
                (pending_id,),
            )
            await db.commit()
            raise HTTPException(status_code=404, detail="原始文件丢失")

        # Try to extract with password
        try:
            tmp_dir = Path(tempfile.mkdtemp())
            with ZipFile(str(raw_path)) as z:
                z.extractall(str(tmp_dir), pwd=password.encode("utf-8"))
            extracted = list(tmp_dir.iterdir())
        except (RuntimeError, Exception) as e:
            err_str = str(e).lower()
            if "password" in err_str or "bad password" in err_str or "incorrect" in err_str or "crypt" in err_str:
                return {"status": "error", "message": "密码错误，无法解压"}
            return {"status": "error", "message": f"解压失败: {str(e)[:200]}"}

        # Parse based on platform
        try:
            from app.sync_engine import parse_alipay_csv, parse_wechat_xlsx, insert_transactions

            rows = []
            if platform == "alipay":
                csv_file = next((p for p in extracted if p.suffix.lower() == ".csv"), None)
                if not csv_file:
                    # Check subdirectories
                    for d in extracted:
                        if d.is_dir():
                            csv_file = next((p for p in d.iterdir() if p.suffix.lower() == ".csv"), None)
                            if csv_file:
                                break
                if not csv_file:
                    return {"status": "error", "message": "ZIP 中未找到 CSV 文件"}
                rows = parse_alipay_csv(csv_file)
            elif platform == "wechat":
                xlsx_file = next((p for p in extracted if p.suffix.lower() == ".xlsx"), None)
                if not xlsx_file:
                    for d in extracted:
                        if d.is_dir():
                            xlsx_file = next((p for p in d.iterdir() if p.suffix.lower() == ".xlsx"), None)
                            if xlsx_file:
                                break
                if not xlsx_file:
                    return {"status": "error", "message": "ZIP 中未找到 XLSX 文件"}
                rows = parse_wechat_xlsx(xlsx_file)
            else:
                return {"status": "error", "message": f"暂不支持 {platform} 平台的自动解析"}

            if not rows:
                return {"status": "error", "message": "解析后无有效数据"}

            result = insert_transactions(rows, source=f"email_{platform}")

            # Update pending status
            await db.execute(
                "UPDATE pending_imports SET status = 'completed', completed_at = datetime('now') WHERE id = ?",
                (pending_id,),
            )
            await db.commit()

            # Cleanup temp dir
            shutil.rmtree(str(tmp_dir), ignore_errors=True)

            return {
                "status": "success",
                "result": {
                    "total": result["total"],
                    "new_inserted": result["new"],
                    "duplicates_skipped": result["duplicates"],
                },
            }
        except Exception as e:
            await db.execute(
                "UPDATE pending_imports SET status = 'failed', error_message = ? WHERE id = ?",
                (str(e)[:500], pending_id),
            )
            await db.commit()
            return {"status": "error", "message": f"解析失败: {str(e)[:200]}"}
    finally:
        await db.close()
