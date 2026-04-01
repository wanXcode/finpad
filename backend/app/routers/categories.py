from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from app.auth import get_current_user
from app.database import get_async_db
from app.bank_categorizer import categorize_bank_transaction

router = APIRouter(prefix="/api/categories", tags=["categories"])

# Default category list
CATEGORIES = [
    {"key": "餐饮", "emoji": "🍜", "label": "餐饮"},
    {"key": "交通", "emoji": "🚗", "label": "交通"},
    {"key": "购物", "emoji": "🛒", "label": "购物"},
    {"key": "居住", "emoji": "🏠", "label": "居住"},
    {"key": "娱乐", "emoji": "🎮", "label": "娱乐"},
    {"key": "医疗", "emoji": "🏥", "label": "医疗"},
    {"key": "教育", "emoji": "📚", "label": "教育"},
    {"key": "旅行", "emoji": "🚀", "label": "旅行"},
    {"key": "亲子", "emoji": "👶", "label": "亲子"},
    {"key": "汽车", "emoji": "🚙", "label": "汽车"},
    {"key": "转账", "emoji": "💰", "label": "转账"},
    {"key": "红包", "emoji": "🧧", "label": "红包"},
    {"key": "理财", "emoji": "📈", "label": "理财"},
    {"key": "信用", "emoji": "💳", "label": "信用"},
    {"key": "内转", "emoji": "🔄", "label": "内转"},
    {"key": "退款", "emoji": "🔙", "label": "退款"},
    {"key": "服务", "emoji": "📋", "label": "服务"},
    {"key": "其他", "emoji": "❓", "label": "其他"},
]


@router.get("")
async def list_categories():
    return {"items": CATEGORIES}


# --- Category Mappings ---

class MappingCreate(BaseModel):
    platform: str
    original_category: str
    mapped_category: str


class MappingUpdate(BaseModel):
    mapped_category: str


@router.get("/mappings")
async def list_mappings(user: dict = Depends(get_current_user)):
    db = await get_async_db()
    try:
        cursor = await db.execute(
            "SELECT * FROM category_mappings WHERE user_id = ? ORDER BY platform, original_category",
            (user["id"],),
        )
        return {"items": [dict(r) for r in await cursor.fetchall()]}
    finally:
        await db.close()


@router.post("/mappings")
async def create_mapping(req: MappingCreate, user: dict = Depends(get_current_user)):
    db = await get_async_db()
    try:
        await db.execute(
            """INSERT OR REPLACE INTO category_mappings (user_id, platform, original_category, mapped_category)
               VALUES (?, ?, ?, ?)""",
            (user["id"], req.platform, req.original_category, req.mapped_category),
        )
        await db.commit()
        return {"message": "映射规则已保存"}
    finally:
        await db.close()


@router.patch("/mappings/{mapping_id}")
async def update_mapping(mapping_id: int, req: MappingUpdate, user: dict = Depends(get_current_user)):
    db = await get_async_db()
    try:
        cursor = await db.execute(
            "UPDATE category_mappings SET mapped_category = ? WHERE id = ? AND user_id = ?",
            (req.mapped_category, mapping_id, user["id"]),
        )
        await db.commit()
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="映射规则不存在")
        return {"message": "更新成功"}
    finally:
        await db.close()


@router.post("/reclassify-bank")
async def reclassify_bank_transactions(user: dict = Depends(get_current_user)):
    db = await get_async_db()
    try:
        cursor = await db.execute(
            """
            SELECT id, direction, counterparty, note
            FROM transactions
            WHERE user_id = ? AND platform IN ('工商银行', '招商银行', '银行')
              AND original_category = '银行卡流水'
            """,
            (user["id"],),
        )
        rows = await cursor.fetchall()

        updated = 0
        for row in rows:
            note = row["note"] or ""
            summary = note.split(" | ")[0] if note else ""
            category = categorize_bank_transaction(
                summary=summary,
                counterparty=row["counterparty"] or "",
                note=note,
                direction=row["direction"] or "",
            )
            await db.execute(
                "UPDATE transactions SET category = ? WHERE id = ? AND user_id = ?",
                (category, row["id"], user["id"]),
            )
            updated += 1

        await db.commit()
        return {"message": "银行卡流水重分类完成", "updated": updated}
    finally:
        await db.close()
