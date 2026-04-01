from __future__ import annotations

import json
import httpx
from app.config import settings

ALLOWED_CATEGORIES = [
    "餐饮", "交通", "购物", "居住", "娱乐", "医疗", "教育", "旅行",
    "亲子", "汽车", "转账", "红包", "理财", "信用", "内转", "退款", "服务", "其他",
]

SYSTEM_PROMPT = """你是个人财务分类助手。请把银行卡流水交易归类到给定分类之一。

可选分类：
餐饮、交通、购物、居住、娱乐、医疗、教育、旅行、亲子、汽车、转账、红包、理财、信用、内转、退款、服务、其他

要求：
1. 只能返回 JSON，不要解释
2. JSON 格式：{\"category\": \"分类名\", \"reason\": \"一句话原因\", \"confidence\": 0到1之间数字}
3. category 必须是可选分类之一
4. 不确定时返回 “其他”
"""


async def classify_bank_transaction_ai(summary: str = "", counterparty: str = "", note: str = "", direction: str = "") -> dict:
    if not settings.AI_API_KEY:
        return {"category": "其他", "reason": "AI API 未配置", "confidence": 0.0}

    user_content = {
        "summary": summary,
        "counterparty": counterparty,
        "note": note,
        "direction": direction,
        "allowed_categories": ALLOWED_CATEGORIES,
    }

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                f"{settings.AI_API_BASE}/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.AI_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": settings.AI_MODEL,
                    "messages": [
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": json.dumps(user_content, ensure_ascii=False)},
                    ],
                    "temperature": 0.1,
                    "max_tokens": 200,
                    "response_format": {"type": "json_object"},
                },
            )
            resp.raise_for_status()
            data = resp.json()
            text = data["choices"][0]["message"]["content"]
            result = json.loads(text)
            category = result.get("category", "其他")
            if category not in ALLOWED_CATEGORIES:
                category = "其他"
            return {
                "category": category,
                "reason": result.get("reason", ""),
                "confidence": float(result.get("confidence", 0) or 0),
            }
    except Exception as e:
        return {"category": "其他", "reason": f"AI 分类失败: {type(e).__name__}", "confidence": 0.0}
