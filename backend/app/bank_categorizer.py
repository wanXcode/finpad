from __future__ import annotations


def categorize_bank_transaction(summary: str = "", counterparty: str = "", note: str = "", direction: str = "") -> str:
    """Rule-based categorization for bank statement imports.

    Priority: explicit patterns first, broad buckets later.
    """
    text = " | ".join([summary or "", counterparty or "", note or ""]).lower()

    def has(*keywords: str) -> bool:
        return any(k.lower() in text for k in keywords)

    # Refund / credit back
    if has("退款", "退货", "退回"):
        return "退款"

    # Credit / repayment / bank card center
    if has("自动还款", "银行卡中心", "信用卡", "信用借还"):
        return "信用"

    # Insurance / utilities / recurring services
    if has("保险", "代扣", "服务费", "手续费", "话费", "手机充值", "充值"):
        return "服务"

    # Education / childcare
    if has("学校", "幼儿园", "培训", "教育", "学费", "击剑", "网球俱乐部", "俱乐部"):
        return "教育"

    # Medical
    if has("医院", "门诊", "诊所", "医疗", "药房"):
        return "医疗"

    # Travel / hotel / ticketing
    if has("去哪儿", "携程", "同程", "酒店", "机票", "火车票", "高铁"):
        return "旅行"

    # Food / dining
    if has("百味鸡", "餐饮", "美食", "饭店", "餐厅", "咖啡", "奶茶", "外卖"):
        return "餐饮"

    # Shopping / retail
    if has("购物", "商城", "唯泰", "微店", "teenie weenie", "百货"):
        return "购物"

    # Wealth / finance
    if has("理财", "基金", "证券", "零钱通", "余额宝", "投资"):
        return "理财"

    # Red packet
    if has("红包"):
        return "红包"

    # Transfers / p2p money movement
    if has("微信转账", "支付宝", "财付通", "转账", "网转", "汇款", "他行汇入", "跨行汇款", "手机银行"):
        return "转账"

    # Generic consumption fallback
    if has("消费", "二维码付款", "扫二维码付款"):
        return "购物" if direction == "支出" else "其他"

    return "其他"
