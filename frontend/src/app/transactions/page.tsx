"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { api, getToken } from "@/lib/api";
import { AppLayout } from "@/components/app-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Search, Filter, ChevronLeft, ChevronRight, Trash2, Tag,
  X, Calendar as CalIcon,
} from "lucide-react";

type Transaction = {
  id: number; tx_id: string; tx_time: string; platform: string;
  account: string; direction: string; amount: number; category: string;
  original_category: string; counterparty: string; note: string;
};
type ListResponse = { items: Transaction[]; total: number; page: number; page_size: number; total_pages: number };

const DIR_COLOR: Record<string, string> = {
  支出: "text-red-500", 收入: "text-green-500", 内转: "text-blue-500", 不计: "text-muted-foreground",
};
const CATEGORIES = [
  "餐饮","交通","购物","居住","娱乐","医疗","教育","旅行",
  "亲子","汽车","转账","红包","理财","信用","内转","退款","服务","其他",
];
const CAT_EMOJI: Record<string, string> = {
  // 统一分类 (18个标准分类)
  餐饮:"🍜",交通:"🚗",购物:"🛒",居住:"🏠",娱乐:"🎮",医疗:"🏥",教育:"📚",旅行:"🚀",
  亲子:"👶",汽车:"🚙",转账:"💰",红包:"🧧",理财:"📈",信用:"💳",内转:"🔄",退款:"🔙",服务:"📋",其他:"📦",
  // 支付宝/微信/银行原始分类 (额外映射)
  交通出行:"🚗",充值缴费:"📱",酒店旅游:"🏨",文化休闲:"🎭",运动户外:"🏃",
  日用百货:"🧻",餐饮美食:"🍜",商户消费:"🛍️",投资理财:"📈",微信红包:"🧧",
  银行卡流水:"💳",信用借还:"💳",网转:"🔄",母婴亲子:"👶",家居家装:"🏠",
  服饰装扮:"👕",教育培训:"📚",生活服务:"🔧",爱车养车:"🚗",公共服务:"🏛️",
  保险代扣:"🛡️",扫二维码付款:"📱",零钱通转出:"💰",转入零钱通:"💰",
  信使展期服务费:"📬",消费:"💳",
};
function fmt(n: number) {
  return n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function TransactionsPage() {
  const router = useRouter();
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [platform, setPlatform] = useState("");
  const [direction, setDirection] = useState("");
  const [category, setCategory] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [amountMin, setAmountMin] = useState("");
  const [amountMax, setAmountMax] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [detailTx, setDetailTx] = useState<Transaction | null>(null);
  const [editCategory, setEditCategory] = useState("");
  const [editNote, setEditNote] = useState("");

  const load = useCallback(async () => {
    if (!getToken()) { router.push("/login"); return; }
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: "20" });
      if (search) params.set("search", search);
      if (platform) params.set("platform", platform);
      if (direction) params.set("direction", direction);
      if (category) params.set("category", category);
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);
      if (amountMin) params.set("amount_min", amountMin);
      if (amountMax) params.set("amount_max", amountMax);
      const res = await api<ListResponse>(`/api/transactions?${params}`);
      setData(res);
    } catch { router.push("/login"); }
    finally { setLoading(false); }
  }, [page, search, platform, direction, category, dateFrom, dateTo, amountMin, amountMax, router]);

  useEffect(() => { load(); }, [load]);

  const toggleSelect = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (!data) return;
    if (selected.size === data.items.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(data.items.map(t => t.id)));
    }
  };

  const openDetail = (tx: Transaction) => {
    setDetailTx(tx);
    setEditCategory(tx.category);
    setEditNote(tx.note || "");
  };

  const saveDetail = async () => {
    if (!detailTx) return;
    try {
      await api(`/api/transactions/${detailTx.id}`, {
        method: "PATCH",
        body: JSON.stringify({ category: editCategory, note: editNote }),
      });
      toast.success("已保存");
      setDetailTx(null);
      load();
    } catch { toast.error("保存失败"); }
  };

  const batchDelete = async () => {
    if (selected.size === 0) return;
    if (!confirm(`确认删除 ${selected.size} 条交易？此操作不可撤销。`)) return;
    try {
      for (const id of selected) {
        await api(`/api/transactions/${id}`, { method: "DELETE" });
      }
      toast.success(`已删除 ${selected.size} 条`);
      setSelected(new Set());
      load();
    } catch { toast.error("删除失败"); }
  };

  const batchChangeCategory = async (cat: string) => {
    if (selected.size === 0) return;
    try {
      for (const id of selected) {
        await api(`/api/transactions/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ category: cat }),
        });
      }
      toast.success(`已更新 ${selected.size} 条分类为「${cat}」`);
      setSelected(new Set());
      load();
    } catch { toast.error("更新失败"); }
  };

  const clearFilters = () => {
    setSearch(""); setPlatform(""); setDirection(""); setCategory("");
    setDateFrom(""); setDateTo(""); setAmountMin(""); setAmountMax("");
    setPage(1);
  };

  const hasFilters = search || platform || direction || category || dateFrom || dateTo || amountMin || amountMax;

  const actions = (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={() => setShowFilters(!showFilters)} className="gap-1.5">
        <Filter className="w-3.5 h-3.5" /> 筛选
        {hasFilters && <Badge className="ml-1 h-4 w-4 p-0 justify-center text-[10px]">!</Badge>}
      </Button>
    </div>
  );

  return (
    <AppLayout title="交易记录" actions={actions}>
      {/* Filters */}
      {showFilters && (
        <Card className="mb-4">
          <CardContent className="pt-4">
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground mb-1">关键词</Label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                  <Input placeholder="搜索..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
                    className="pl-8 h-9 text-sm" />
                </div>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1">平台</Label>
                <Select value={platform} onValueChange={v => { setPlatform((v === "__all" || v === null) ? "" : v); setPage(1); }}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="全部" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all">全部</SelectItem>
                    <SelectItem value="支付宝">支付宝</SelectItem>
                    <SelectItem value="微信">微信</SelectItem>
                    <SelectItem value="招商银行">招商银行</SelectItem>
                    <SelectItem value="工商银行">工商银行</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1">方向</Label>
                <Select value={direction} onValueChange={v => { setDirection((v === "__all" || v === null) ? "" : v); setPage(1); }}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="全部" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all">全部</SelectItem>
                    <SelectItem value="支出">支出</SelectItem>
                    <SelectItem value="收入">收入</SelectItem>
                    <SelectItem value="内转">内转</SelectItem>
                    <SelectItem value="不计收支">不计收支</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1">分类</Label>
                <Select value={category} onValueChange={v => { setCategory((v === "__all" || v === null) ? "" : v); setPage(1); }}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="全部" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all">全部</SelectItem>
                    {CATEGORIES.map(c => <SelectItem key={c} value={c}>{CAT_EMOJI[c]} {c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1">开始日期</Label>
                <Input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }} className="h-9 text-sm" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1">结束日期</Label>
                <Input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }} className="h-9 text-sm" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1">最小金额</Label>
                <Input type="number" placeholder="¥" value={amountMin} onChange={e => { setAmountMin(e.target.value); setPage(1); }} className="h-9 text-sm" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1">最大金额</Label>
                <Input type="number" placeholder="¥" value={amountMax} onChange={e => { setAmountMax(e.target.value); setPage(1); }} className="h-9 text-sm" />
              </div>
            </div>
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="mt-2 text-xs gap-1">
                <X className="w-3 h-3" /> 清除筛选
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Batch actions */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 mb-4 p-3 bg-muted/50 rounded-lg border">
          <span className="text-sm font-medium">已选 {selected.size} 条</span>
          <Select onValueChange={(v: string | null) => batchChangeCategory(v ?? "")}>
            <SelectTrigger className="w-40 h-8 text-sm">
              <Tag className="w-3.5 h-3.5 mr-1" /> 批量改分类
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map(c => <SelectItem key={c} value={c}>{CAT_EMOJI[c]} {c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="destructive" size="sm" onClick={batchDelete} className="gap-1 h-8">
            <Trash2 className="w-3.5 h-3.5" /> 删除
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())} className="h-8">
            取消
          </Button>
        </div>
      )}

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4 space-y-3">
              {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : !data || data.items.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground">
              {hasFilters ? "没有符合条件的交易" : "暂无交易数据"}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="py-3 px-3 w-10">
                      <Checkbox
                        checked={data.items.length > 0 && selected.size === data.items.length}
                        onCheckedChange={toggleSelectAll}
                      />
                    </th>
                    <th className="text-left py-3 px-3 font-medium text-muted-foreground">时间</th>
                    <th className="text-left py-3 px-3 font-medium text-muted-foreground">平台</th>
                    <th className="text-left py-3 px-3 font-medium text-muted-foreground">方向</th>
                    <th className="text-right py-3 px-3 font-medium text-muted-foreground">金额</th>
                    <th className="text-left py-3 px-3 font-medium text-muted-foreground">分类</th>
                    <th className="text-left py-3 px-3 font-medium text-muted-foreground">交易对方</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((tx) => (
                    <tr
                      key={tx.id}
                      className="border-b last:border-0 hover:bg-muted/50 cursor-pointer transition-colors"
                      onClick={() => openDetail(tx)}
                    >
                      <td className="py-2.5 px-3" onClick={e => e.stopPropagation()}>
                        <Checkbox checked={selected.has(tx.id)} onCheckedChange={() => toggleSelect(tx.id)} />
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">{tx.tx_time?.slice(0, 16)}</td>
                      <td className="py-2.5 px-3"><Badge variant="outline" className="text-xs">{tx.platform}</Badge></td>
                      <td className={`py-2.5 px-3 font-medium ${DIR_COLOR[tx.direction] || ""}`}>{tx.direction}</td>
                      <td className={`py-2.5 px-3 text-right font-medium tabular-nums ${DIR_COLOR[tx.direction] || ""}`}>¥{fmt(tx.amount)}</td>
                      <td className="py-2.5 px-3 whitespace-nowrap">{CAT_EMOJI[tx.category] || "❓"} {tx.category}</td>
                      <td className="py-2.5 px-3 text-muted-foreground truncate max-w-[200px]">{tx.counterparty || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {data && data.total_pages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-muted-foreground">
            共 {data.total} 条，第 {data.page}/{data.total_pages} 页
          </p>
          <div className="flex gap-1">
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= data.total_pages} onClick={() => setPage(p => p + 1)}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Detail Sheet */}
      <Sheet open={!!detailTx} onOpenChange={open => !open && setDetailTx(null)}>
        <SheetContent className="w-[400px] sm:w-[440px]">
          <SheetHeader>
            <SheetTitle>交易详情</SheetTitle>
          </SheetHeader>
          {detailTx && (
            <div className="mt-6 space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground">时间</Label>
                  <p className="text-sm font-medium">{detailTx.tx_time?.slice(0, 19)}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">平台</Label>
                  <p className="text-sm font-medium">{detailTx.platform}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">方向</Label>
                  <p className={`text-sm font-medium ${DIR_COLOR[detailTx.direction] || ""}`}>{detailTx.direction}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">金额</Label>
                  <p className={`text-sm font-bold ${DIR_COLOR[detailTx.direction] || ""}`}>¥{fmt(detailTx.amount)}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">账户</Label>
                  <p className="text-sm">{detailTx.account || "—"}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">交易对方</Label>
                  <p className="text-sm">{detailTx.counterparty || "—"}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">原始分类</Label>
                  <p className="text-sm text-muted-foreground">{detailTx.original_category || "—"}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">交易号</Label>
                  <p className="text-xs text-muted-foreground font-mono break-all">{detailTx.tx_id}</p>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">分类</Label>
                <Select value={editCategory} onValueChange={v => setEditCategory(v ?? "")}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map(c => <SelectItem key={c} value={c}>{CAT_EMOJI[c]} {c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">备注</Label>
                <Input value={editNote} onChange={e => setEditNote(e.target.value)} placeholder="添加备注..." />
              </div>

              <Button onClick={saveDetail} className="w-full">保存修改</Button>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </AppLayout>
  );
}
