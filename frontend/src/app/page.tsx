"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, getToken, clearToken } from "@/lib/api";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

type Summary = {
  total_assets: number;
  this_month: { income: number; expense: number; net: number };
  last_month: { income: number; expense: number };
  transaction_count: number;
  recent_transactions: {
    id: number;
    tx_time: string;
    platform: string;
    direction: string;
    amount: number;
    category: string;
    counterparty: string;
  }[];
};

type TrendMonth = {
  month: string;
  income: number;
  expense: number;
  net: number;
};

type CategoryItem = {
  category: string;
  total: number;
};

function formatMoney(n: number) {
  return n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pctChange(current: number, previous: number) {
  if (previous === 0) return current > 0 ? "+∞" : "—";
  const pct = ((current - previous) / previous) * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

const CATEGORY_EMOJI: Record<string, string> = {
  餐饮: "🍜", 交通: "🚗", 购物: "🛒", 居住: "🏠", 娱乐: "🎮",
  医疗: "🏥", 教育: "📚", 旅行: "🚀", 亲子: "👶", 汽车: "🚙",
  转账: "💰", 红包: "🧧", 理财: "📈", 信用: "💳", 内转: "🔄",
  退款: "🔙", 服务: "📋", 其他: "❓",
};

const DIRECTION_COLOR: Record<string, string> = {
  支出: "text-red-500",
  收入: "text-green-500",
  内转: "text-blue-500",
  不计: "text-gray-400",
};

export default function DashboardPage() {
  const router = useRouter();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [trend, setTrend] = useState<TrendMonth[]>([]);
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    Promise.all([
      api<Summary>("/api/dashboard/summary"),
      api<{ months: TrendMonth[] }>("/api/dashboard/trend?months=6"),
      api<{ categories: CategoryItem[] }>("/api/dashboard/category"),
    ])
      .then(([s, t, c]) => {
        setSummary(s);
        setTrend(t.months);
        setCategories(c.categories);
      })
      .catch(() => router.push("/login"))
      .finally(() => setLoading(false));
  }, [router]);

  if (loading || !summary) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">加载中...</p>
      </div>
    );
  }

  const totalExpense = categories.reduce((s, c) => s + c.total, 0);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <h1 className="text-xl font-bold">FinPad</h1>
          <nav className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => router.push("/")}>
              总览
            </Button>
            <Button variant="ghost" size="sm" onClick={() => router.push("/transactions")}>
              交易
            </Button>
            <Button variant="ghost" size="sm" onClick={() => router.push("/sources")}>
              数据源
            </Button>
            <Button variant="ghost" size="sm" onClick={() => router.push("/settings")}>
              设置
            </Button>
            <Separator orientation="vertical" className="h-6" />
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                clearToken();
                router.push("/login");
              }}
            >
              退出
            </Button>
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">总资产</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">¥{formatMoney(summary.total_assets)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">本月收入</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-green-500">¥{formatMoney(summary.this_month.income)}</p>
              <p className="text-xs text-muted-foreground mt-1">
                较上月 {pctChange(summary.this_month.income, summary.last_month.income)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">本月支出</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-red-500">¥{formatMoney(summary.this_month.expense)}</p>
              <p className="text-xs text-muted-foreground mt-1">
                较上月 {pctChange(summary.this_month.expense, summary.last_month.expense)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">本月净结余</CardTitle>
            </CardHeader>
            <CardContent>
              <p className={`text-2xl font-bold ${summary.this_month.net >= 0 ? "text-green-500" : "text-red-500"}`}>
                ¥{formatMoney(summary.this_month.net)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                共 {summary.transaction_count} 笔交易
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Trend - simple text version for MVP */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">收支趋势（近 6 月）</CardTitle>
            </CardHeader>
            <CardContent>
              {trend.length === 0 ? (
                <p className="text-muted-foreground">暂无数据</p>
              ) : (
                <div className="space-y-3">
                  {trend.map((m) => (
                    <div key={m.month} className="flex items-center justify-between text-sm">
                      <span className="font-medium w-20">{m.month}</span>
                      <div className="flex-1 mx-4">
                        <div className="flex gap-2">
                          <div
                            className="bg-green-400/30 h-4 rounded"
                            style={{ width: `${Math.min((m.income / Math.max(...trend.map(t => Math.max(t.income, t.expense)))) * 100, 100)}%` }}
                          />
                        </div>
                        <div className="flex gap-2 mt-1">
                          <div
                            className="bg-red-400/30 h-4 rounded"
                            style={{ width: `${Math.min((m.expense / Math.max(...trend.map(t => Math.max(t.income, t.expense)))) * 100, 100)}%` }}
                          />
                        </div>
                      </div>
                      <div className="text-right w-40">
                        <span className="text-green-500">+{formatMoney(m.income)}</span>
                        {" / "}
                        <span className="text-red-500">-{formatMoney(m.expense)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Category breakdown */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">本月支出分类</CardTitle>
            </CardHeader>
            <CardContent>
              {categories.length === 0 ? (
                <p className="text-muted-foreground">暂无数据</p>
              ) : (
                <div className="space-y-2">
                  {categories.map((c) => (
                    <div key={c.category} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span>{CATEGORY_EMOJI[c.category] || "❓"}</span>
                        <span>{c.category}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">¥{formatMoney(c.total)}</span>
                        <Badge variant="secondary" className="text-xs">
                          {totalExpense > 0 ? ((c.total / totalExpense) * 100).toFixed(1) : 0}%
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Recent transactions */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">最近交易</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-2 font-medium">时间</th>
                    <th className="text-left py-2 font-medium">平台</th>
                    <th className="text-left py-2 font-medium">方向</th>
                    <th className="text-right py-2 font-medium">金额</th>
                    <th className="text-left py-2 font-medium">分类</th>
                    <th className="text-left py-2 font-medium">交易对方</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.recent_transactions.map((tx) => (
                    <tr key={tx.id} className="border-b last:border-0 hover:bg-muted/50">
                      <td className="py-2">{tx.tx_time?.slice(0, 16)}</td>
                      <td className="py-2">
                        <Badge variant="outline">{tx.platform}</Badge>
                      </td>
                      <td className={`py-2 ${DIRECTION_COLOR[tx.direction] || ""}`}>{tx.direction}</td>
                      <td className={`py-2 text-right font-medium ${DIRECTION_COLOR[tx.direction] || ""}`}>
                        ¥{formatMoney(tx.amount)}
                      </td>
                      <td className="py-2">
                        {CATEGORY_EMOJI[tx.category] || "❓"} {tx.category}
                      </td>
                      <td className="py-2 text-muted-foreground">{tx.counterparty || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 text-center">
              <Button variant="ghost" size="sm" onClick={() => router.push("/transactions")}>
                查看全部交易 →
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
