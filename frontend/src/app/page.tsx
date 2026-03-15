"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, getToken } from "@/lib/api";
import { AppLayout } from "@/components/app-layout";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from "recharts";
import {
  TrendingUp, TrendingDown, ArrowRight, FileUp, Mail,
  Wallet, ArrowUpRight, ArrowDownRight, Minus,
} from "lucide-react";

type Summary = {
  total_assets: number;
  this_month: { income: number; expense: number; net: number };
  last_month: { income: number; expense: number };
  transaction_count: number;
  recent_transactions: {
    id: number; tx_time: string; platform: string;
    direction: string; amount: number; category: string; counterparty: string;
  }[];
};
type TrendMonth = { month: string; income: number; expense: number; net: number };
type CategoryItem = { category: string; total: number };

function fmt(n: number) {
  return n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pctBadge(cur: number, prev: number) {
  if (prev === 0) return null;
  const pct = ((cur - prev) / prev) * 100;
  const up = pct >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${up ? "text-green-600" : "text-red-600"}`}>
      {up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
      {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

const CAT_EMOJI: Record<string, string> = {
  餐饮: "🍜", 交通: "🚗", 购物: "🛒", 居住: "🏠", 娱乐: "🎮",
  医疗: "🏥", 教育: "📚", 旅行: "🚀", 亲子: "👶", 汽车: "🚙",
  转账: "💰", 红包: "🧧", 理财: "📈", 信用: "💳", 内转: "🔄",
  退款: "🔙", 服务: "📋", 其他: "❓",
};
const DIR_COLOR: Record<string, string> = {
  支出: "text-red-500", 收入: "text-green-500",
  内转: "text-blue-500", 不计: "text-muted-foreground",
};
const PIE_COLORS = [
  "#2563eb","#16a34a","#dc2626","#f59e0b","#8b5cf6","#ec4899",
  "#06b6d4","#84cc16","#f97316","#6366f1","#14b8a6","#e11d48",
];

export default function DashboardPage() {
  const router = useRouter();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [trend, setTrend] = useState<TrendMonth[]>([]);
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) { router.push("/login"); return; }
    Promise.all([
      api<Summary>("/api/dashboard/summary"),
      api<{ months: TrendMonth[] }>("/api/dashboard/trend?months=6"),
      api<{ categories: CategoryItem[] }>("/api/dashboard/category"),
    ])
      .then(([s, t, c]) => { setSummary(s); setTrend(t.months); setCategories(c.categories); })
      .catch(() => router.push("/login"))
      .finally(() => setLoading(false));
  }, [router]);

  if (loading) {
    return (
      <AppLayout title="Dashboard">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          {[...Array(4)].map((_, i) => (
            <Card key={i}><CardContent className="pt-6"><Skeleton className="h-8 w-32" /><Skeleton className="h-4 w-20 mt-2" /></CardContent></Card>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2"><CardContent className="pt-6"><Skeleton className="h-64 w-full" /></CardContent></Card>
          <Card><CardContent className="pt-6"><Skeleton className="h-64 w-full" /></CardContent></Card>
        </div>
      </AppLayout>
    );
  }

  if (!summary) return null;
  const isEmpty = summary.transaction_count === 0;

  // Empty state
  if (isEmpty) {
    return (
      <AppLayout title="Dashboard">
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center mb-6">
            <Wallet className="w-10 h-10 text-muted-foreground" />
          </div>
          <h2 className="text-xl font-semibold mb-2">还没有账单数据</h2>
          <p className="text-muted-foreground mb-8 max-w-md">
            导入你的第一份账单，开始掌控你的财务状况
          </p>
          <div className="flex gap-3">
            <Button onClick={() => router.push("/import")} className="gap-2">
              <FileUp className="w-4 h-4" /> 导入 CSV 文件
            </Button>
            <Button variant="outline" onClick={() => router.push("/sources")} className="gap-2">
              <Mail className="w-4 h-4" /> 配置邮箱同步
            </Button>
          </div>
        </div>
      </AppLayout>
    );
  }

  const totalExpense = categories.reduce((s, c) => s + c.total, 0);
  const pieData = categories.filter(c => c.total > 0).map(c => ({
    name: c.category, value: c.total,
    emoji: CAT_EMOJI[c.category] || "❓",
  }));

  return (
    <AppLayout title="Dashboard">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">总资产</CardTitle>
            <Wallet className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">¥{fmt(summary.total_assets)}</p>
            <p className="text-xs text-muted-foreground mt-1">{summary.transaction_count} 笔交易</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">本月收入</CardTitle>
            <TrendingUp className="w-4 h-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-green-600">¥{fmt(summary.this_month.income)}</p>
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              较上月 {pctBadge(summary.this_month.income, summary.last_month.income) || "—"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">本月支出</CardTitle>
            <TrendingDown className="w-4 h-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-red-600">¥{fmt(summary.this_month.expense)}</p>
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              较上月 {pctBadge(summary.this_month.expense, summary.last_month.expense) || "—"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">本月净结余</CardTitle>
            {summary.this_month.net >= 0
              ? <TrendingUp className="w-4 h-4 text-green-500" />
              : <TrendingDown className="w-4 h-4 text-red-500" />}
          </CardHeader>
          <CardContent>
            <p className={`text-2xl font-bold ${summary.this_month.net >= 0 ? "text-green-600" : "text-red-600"}`}>
              ¥{fmt(summary.this_month.net)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* Trend Chart */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">收支趋势</CardTitle>
          </CardHeader>
          <CardContent>
            {trend.length === 0 ? (
              <p className="text-muted-foreground py-10 text-center">暂无趋势数据</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={trend} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="month" className="text-xs" tick={{ fontSize: 12 }} />
                  <YAxis className="text-xs" tick={{ fontSize: 12 }} tickFormatter={v => `¥${(v/1000).toFixed(0)}k`} />
                  <RTooltip
                    formatter={(value: number, name: string) => [
                      `¥${fmt(value)}`,
                      name === "income" ? "收入" : name === "expense" ? "支出" : "净额",
                    ]}
                    labelFormatter={l => `${l}`}
                  />
                  <Line type="monotone" dataKey="income" stroke="#16a34a" strokeWidth={2} dot={{ r: 3 }} name="income" />
                  <Line type="monotone" dataKey="expense" stroke="#dc2626" strokeWidth={2} dot={{ r: 3 }} name="expense" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Pie Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">支出分类</CardTitle>
          </CardHeader>
          <CardContent>
            {pieData.length === 0 ? (
              <p className="text-muted-foreground py-10 text-center">暂无支出</p>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={pieData} cx="50%" cy="50%"
                      innerRadius={45} outerRadius={75}
                      paddingAngle={2} dataKey="value"
                    >
                      {pieData.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <RTooltip formatter={(value: number, name: string) => [`¥${fmt(value)}`, name]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-1.5 mt-2 max-h-32 overflow-y-auto">
                  {pieData.map((c, i) => (
                    <div key={c.name} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                        <span>{c.emoji} {c.name}</span>
                      </div>
                      <span className="font-medium tabular-nums">¥{fmt(c.value)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Transactions */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">最近交易</CardTitle>
          <Button variant="ghost" size="sm" onClick={() => router.push("/transactions")} className="gap-1 text-sm">
            查看全部 <ArrowRight className="w-3 h-3" />
          </Button>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left py-2.5 font-medium">时间</th>
                  <th className="text-left py-2.5 font-medium">平台</th>
                  <th className="text-left py-2.5 font-medium">方向</th>
                  <th className="text-right py-2.5 font-medium">金额</th>
                  <th className="text-left py-2.5 font-medium">分类</th>
                  <th className="text-left py-2.5 font-medium">交易对方</th>
                </tr>
              </thead>
              <tbody>
                {summary.recent_transactions.map((tx) => (
                  <tr
                    key={tx.id}
                    className="border-b last:border-0 hover:bg-muted/50 cursor-pointer transition-colors"
                    onClick={() => router.push(`/transactions?highlight=${tx.id}`)}
                  >
                    <td className="py-2.5 whitespace-nowrap">{tx.tx_time?.slice(0, 16)}</td>
                    <td className="py-2.5"><Badge variant="outline" className="text-xs">{tx.platform}</Badge></td>
                    <td className={`py-2.5 ${DIR_COLOR[tx.direction] || ""}`}>{tx.direction}</td>
                    <td className={`py-2.5 text-right font-medium tabular-nums ${DIR_COLOR[tx.direction] || ""}`}>¥{fmt(tx.amount)}</td>
                    <td className="py-2.5">{CAT_EMOJI[tx.category] || "❓"} {tx.category}</td>
                    <td className="py-2.5 text-muted-foreground truncate max-w-[200px]">{tx.counterparty || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </AppLayout>
  );
}
