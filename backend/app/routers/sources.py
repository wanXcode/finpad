from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional
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
    config_json: Optional[str] = None
    sync_interval_minutes: Optional[int] = None
    enabled: Optional[bool] = None


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
    # TODO: implement actual sync logic
    db = await get_async_db()
    try:
        cursor = await db.execute(
            "SELECT * FROM data_sources WHERE id = ? AND user_id = ?", (source_id, user["id"])
        )
        source = await cursor.fetchone()
        if not source:
            raise HTTPException(status_code=404, detail="数据源不存在")
        return {"message": f"同步任务已触发: {source['name']}", "status": "queued"}
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
