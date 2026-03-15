"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { api, getToken } from "@/lib/api";
import { AppLayout } from "@/components/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Plus, Trash2, PiggyBank, AlertTriangle } from "lucide-react";

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

type Budget = {
  id: number;
  category: string;
  monthly_amount: number;
  spent: number;
  enabled: boolean;
};

export default function BudgetPage() {
  const router = useRouter();
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newCategory, setNewCategory] = useState("");
  const [newAmount, setNewAmount] = useState("");

  useEffect(() => {
    if (!getToken()) { router.push("/login"); return; }
    loadBudgets();
  }, [router]);

  const loadBudgets = async () => {
    setLoading(true);
    try {
      const res = await api<{ items: Budget[] }>("/api/budgets");
      setBudgets(res.items || []);
    } catch { router.push("/login"); }
    finally { setLoading(false); }
  };

  const createBudget = async () => {
    if (!newCategory || !newAmount) return;
    try {
      await api("/api/budgets", {
        method: "POST",
        body: JSON.stringify({ category: newCategory, monthly_amount: parseFloat(newAmount) }),
      });
      toast.success("预算已创建");
      setDialogOpen(false);
      setNewCategory("");
      setNewAmount("");
      loadBudgets();
    } catch { toast.error("创建失败"); }
  };

  const deleteBudget = async (id: number) => {
    if (!confirm("确认删除此预算？")) return;
    try {
      await api(`/api/budgets/${id}`, { method: "DELETE" });
      toast.success("已删除");
      loadBudgets();
    } catch { toast.error("删除失败"); }
  };

  const totalBudget = budgets.reduce((s, b) => s + b.monthly_amount, 0);
  const totalSpent = budgets.reduce((s, b) => s + (b.spent || 0), 0);
  const usedCategories = new Set(budgets.map(b => b.category));
  const availableCategories = CATEGORIES.filter(c => !usedCategories.has(c));

  return (
    <AppLayout
      title="预算管理"
      actions={
        <Button size="sm" onClick={() => setDialogOpen(true)} className="gap-1.5">
          <Plus className="w-3.5 h-3.5" /> 添加预算
        </Button>
      }
    >
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : budgets.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center mb-6">
            <PiggyBank className="w-10 h-10 text-muted-foreground" />
          </div>
          <h2 className="text-xl font-semibold mb-2">还没有预算</h2>
          <p className="text-muted-foreground mb-6">设置月度预算，掌控你的消费节奏</p>
          <Button onClick={() => setDialogOpen(true)} className="gap-2">
            <Plus className="w-4 h-4" /> 创建第一个预算
          </Button>
        </div>
      ) : (
        <>
          {/* Overview */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <Card>
              <CardContent className="pt-4">
                <p className="text-sm text-muted-foreground">月度预算总额</p>
                <p className="text-2xl font-bold">¥{fmt(totalBudget)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-sm text-muted-foreground">本月已用</p>
                <p className="text-2xl font-bold text-red-600">¥{fmt(totalSpent)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-sm text-muted-foreground">剩余可用</p>
                <p className={`text-2xl font-bold ${totalBudget - totalSpent >= 0 ? "text-green-600" : "text-red-600"}`}>
                  ¥{fmt(totalBudget - totalSpent)}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Budget list */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {budgets.map((b) => {
              const pct = b.monthly_amount > 0 ? Math.min(((b.spent || 0) / b.monthly_amount) * 100, 100) : 0;
              const over = (b.spent || 0) > b.monthly_amount;
              return (
                <Card key={b.id} className={over ? "border-red-200 dark:border-red-900" : ""}>
                  <CardContent className="pt-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{CAT_EMOJI[b.category] || "❓"}</span>
                        <span className="font-medium">{b.category}</span>
                        {over && <AlertTriangle className="w-4 h-4 text-red-500" />}
                      </div>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteBudget(b.id)}>
                        <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
                      </Button>
                    </div>
                    <Progress value={pct} className={`h-2 mb-2 ${over ? "[&>div]:bg-red-500" : ""}`} />
                    <div className="flex justify-between text-sm">
                      <span className={over ? "text-red-500 font-medium" : "text-muted-foreground"}>
                        ¥{fmt(b.spent || 0)} / ¥{fmt(b.monthly_amount)}
                      </span>
                      <span className={over ? "text-red-500 font-medium" : "text-muted-foreground"}>
                        {pct.toFixed(0)}%
                      </span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}

      {/* Create dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加预算</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>分类</Label>
              <Select value={newCategory} onValueChange={v => setNewCategory(v ?? "")}>
                <SelectTrigger><SelectValue placeholder="选择分类" /></SelectTrigger>
                <SelectContent>
                  {availableCategories.map(c => (
                    <SelectItem key={c} value={c}>{CAT_EMOJI[c]} {c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>月度预算金额（元）</Label>
              <Input type="number" value={newAmount} onChange={e => setNewAmount(e.target.value)} placeholder="例如：2000" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button onClick={createBudget} disabled={!newCategory || !newAmount}>确认</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
