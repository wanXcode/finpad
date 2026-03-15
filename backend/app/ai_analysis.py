"""
AI Analysis Module for FinPad
Generates monthly financial analysis reports using LLM.
"""
import json
import httpx
from app.config import settings


SYSTEM_PROMPT = """你是一个专业的个人财务分析师。用户会给你一个月的收支数据，请你生成一份详细的月度财务分析报告。

报告要求：
1. 用中文撰写，语气专业但友好
2. 使用 Markdown 格式
3. 包含以下板块：

## 📊 收支总览
- 总收入、总支出、净结余
- 与上月对比（如有数据）

## 🏷️ 支出分类分析
- 各分类占比排名
- 哪些分类支出偏高或偏低
- 值得关注的消费趋势

## ⚠️ 异常消费提醒
- 大额消费（单笔超过日均支出 3 倍的）
- 非常规支出
- 重复扣费或可疑交易

## 💡 优化建议
- 可以节省的地方
- 消费结构是否健康
- 下月预算建议

## 📈 财务健康评分
给出 1-100 的健康评分，并解释原因。

注意：
- 数据中 "不计收支" 的交易（如内部转账、退款）不要计入收支统计
- 金额单位是人民币（元）
- 分析要基于实际数据，不要编造数字
"""


async def generate_analysis(raw_data: dict, prev_month_data: dict | None = None) -> str:
    """
    Call LLM API to generate financial analysis.
    raw_data: {"summary": {...}, "breakdown": [...], "transactions": [...]}
    Returns: Markdown string with analysis
    """
    if not settings.AI_API_KEY:
        return _generate_local_analysis(raw_data)

    user_content = f"以下是本月的财务数据：\n\n```json\n{json.dumps(raw_data, ensure_ascii=False, indent=2)}\n```"
    if prev_month_data:
        user_content += f"\n\n上月数据（供对比）：\n```json\n{json.dumps(prev_month_data, ensure_ascii=False, indent=2)}\n```"

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
                        {"role": "user", "content": user_content},
                    ],
                    "temperature": 0.7,
                    "max_tokens": 2000,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            return data["choices"][0]["message"]["content"]
    except Exception as e:
        # Fallback to local analysis on API failure
        return _generate_local_analysis(raw_data) + f"\n\n> ⚠️ AI 分析暂不可用（{str(e)[:100]}），以上为自动生成的基础分析。"


def _generate_local_analysis(raw_data: dict) -> str:
    """Fallback: generate a basic analysis without LLM."""
    summary = raw_data.get("summary", {})
    breakdown = raw_data.get("breakdown", [])

    income = float(summary.get("income", 0))
    expense = float(summary.get("expense", 0))
    tx_count = int(summary.get("tx_count", 0))
    net = income - expense

    # Expense breakdown
    expense_items = [b for b in breakdown if b.get("direction") == "支出"]
    expense_items.sort(key=lambda x: float(x.get("total", 0)), reverse=True)

    lines = [
        "## 📊 收支总览\n",
        f"| 指标 | 金额 |",
        f"|------|------|",
        f"| 总收入 | ¥{income:,.2f} |",
        f"| 总支出 | ¥{expense:,.2f} |",
        f"| 净结余 | ¥{net:,.2f} |",
        f"| 交易笔数 | {tx_count} |",
        "",
    ]

    if expense > 0:
        savings_rate = (net / income * 100) if income > 0 else 0
        lines.append(f"储蓄率：**{savings_rate:.1f}%**\n")

    lines.append("## 🏷️ 支出分类分析\n")
    if expense_items:
        lines.append("| 分类 | 金额 | 占比 | 笔数 |")
        lines.append("|------|------|------|------|")
        for item in expense_items:
            total = float(item.get("total", 0))
            count = int(item.get("count", 0))
            pct = (total / expense * 100) if expense > 0 else 0
            lines.append(f"| {item.get('category', '未知')} | ¥{total:,.2f} | {pct:.1f}% | {count} |")
        lines.append("")

        # Top category insight
        if expense_items:
            top = expense_items[0]
            top_pct = float(top.get("total", 0)) / expense * 100 if expense > 0 else 0
            lines.append(f"最大支出分类为 **{top.get('category')}**，占总支出的 **{top_pct:.1f}%**。\n")
    else:
        lines.append("本月暂无支出记录。\n")

    # Health score
    lines.append("## 📈 财务健康评分\n")
    if income > 0:
        savings_rate = net / income * 100
        if savings_rate >= 30:
            score = 85
            comment = "储蓄率优秀，财务状况健康。"
        elif savings_rate >= 10:
            score = 70
            comment = "储蓄率尚可，建议适当控制非必要支出。"
        elif savings_rate >= 0:
            score = 55
            comment = "收支基本平衡，但储蓄空间不足。"
        else:
            score = 35
            comment = "本月入不敷出，需要关注支出结构。"
    else:
        score = 50
        comment = "本月无收入记录，仅有支出。"

    lines.append(f"**{score} / 100** — {comment}\n")

    lines.append("\n---\n*此为基础自动分析。配置 AI API Key 后可获得更详细的智能分析。*")

    return "\n".join(lines)
