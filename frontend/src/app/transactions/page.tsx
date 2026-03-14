"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { api, getToken } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Transaction = {
  id: number;
  tx_id: string;
  tx_time: string;
  platform: string;
  account: string;
  direction: string;
  amount: number;
  category: string;
  original_category: string;
  counterparty: string;
  note: string;
};

type ListResponse = {
  items: Transaction[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
};

const DIRECTION_COLOR: Record<string, string> = {
  支出: "text-red-500",
  收入: "text-green-500",
  内转: "text-blue-500",
  不计: "text-gray-400",
};

function formatMoney(n: number) {
  return n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function TransactionsPage() {
  const router = useRouter();
  const [data, setData] = useState<ListResponse | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [platform, setPlatform] = useState("");
  const [direction, setDirection] = useState("");
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: "20" });
      if (search) params.set("search", search);
      if (platform) params.set("platform", platform);
      if (direction) params.set("direction", direction);
      const res = await api<ListResponse>(`/api/transactions?${params}`);
      setData(res);
    } catch {
      router.push("/login");
    } finally {
      setLoading(false);
    }
  }, [page, search, platform, direction, router]);

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    fetchData();
  }, [fetchData, router]);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-background/95 backdrop-blur sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <h1 className="text-xl font-bold cursor-pointer" onClick={() => router.push("/")}>FinPad</h1>
          <nav className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => router.push("/")}>总览</Button>
            <Button variant="default" size="sm">交易</Button>
            <Button variant="ghost" size="sm" onClick={() => router.push("/sources")}>数据源</Button>
            <Button variant="ghost" size="sm" onClick={() => router.push("/settings")}>设置</Button>
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-4">
        {/* Filters */}
        <Card>
          <CardContent className="py-4">
            <div className="flex flex-wrap gap-3 items-center">
              <Input
                placeholder="搜索交易对方、备注..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-64"
                onKeyDown={(e) => e.key === "Enter" && (setPage(1), fetchData())}
              />
              <select
                value={platform}
                onChange={(e) => { setPlatform(e.target.value); setPage(1); }}
                className="border rounded px-3 py-2 text-sm bg-background"
              >
                <option value="">全部平台</option>
                <option value="支付宝">支付宝</option>
                <option value="微信">微信</option>
                <option value="招商银行">招商银行</option>
                <option value="工商银行">工商银行</option>
              </select>
              <select
                value={direction}
                onChange={(e) => { setDirection(e.target.value); setPage(1); }}
                className="border rounded px-3 py-2 text-sm bg-background"
              >
                <option value="">全部方向</option>
                <option value="支出">支出</option>
                <option value="收入">收入</option>
                <option value="内转">内转</option>
                <option value="不计收支">不计收支</option>
              </select>
              <Button size="sm" onClick={() => { setPage(1); fetchData(); }}>搜索</Button>
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center justify-between">
              <span>交易列表</span>
              {data && <span className="text-sm font-normal text-muted-foreground">共 {data.total} 条</span>}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-muted-foreground text-center py-8">加载中...</p>
            ) : !data || data.items.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">暂无交易记录</p>
            ) : (
              <>
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
                        <th className="text-left py-2 font-medium">备注</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((tx) => (
                        <tr key={tx.id} className="border-b last:border-0 hover:bg-muted/50">
                          <td className="py-2 whitespace-nowrap">{tx.tx_time?.slice(0, 16)}</td>
                          <td className="py-2"><Badge variant="outline">{tx.platform}</Badge></td>
                          <td className={`py-2 ${DIRECTION_COLOR[tx.direction] || ""}`}>{tx.direction}</td>
                          <td className={`py-2 text-right font-medium ${DIRECTION_COLOR[tx.direction] || ""}`}>
                            ¥{formatMoney(tx.amount)}
                          </td>
                          <td className="py-2">{tx.category}</td>
                          <td className="py-2 max-w-32 truncate">{tx.counterparty || "—"}</td>
                          <td className="py-2 max-w-48 truncate text-muted-foreground">{tx.note || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                <div className="flex items-center justify-between mt-4">
                  <p className="text-sm text-muted-foreground">
                    第 {data.page} / {data.total_pages} 页
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page <= 1}
                      onClick={() => setPage(page - 1)}
                    >
                      上一页
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= data.total_pages}
                      onClick={() => setPage(page + 1)}
                    >
                      下一页
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
