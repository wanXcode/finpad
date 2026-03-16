"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, getToken } from "@/lib/api";
import { AppLayout } from "@/components/app-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

type Account = {
  id: number;
  name: string;
  platform: string;
  account_type: string;
  balance: number;
  enabled: number;
};

type CategoryMapping = {
  id: number;
  platform: string;
  original_category: string;
  mapped_category: string;
};

type UserInfo = {
  id: number;
  username: string;
  display_name: string;
  role: string;
};

const UNIFIED_CATEGORIES = [
  "餐饮",
  "交通",
  "购物",
  "居住",
  "娱乐",
  "医疗",
  "教育",
  "旅行",
  "亲子",
  "汽车",
  "转账",
  "红包",
  "理财",
  "信用",
  "内转",
  "退款",
  "服务",
  "其他",
];

function formatMoney(n: number) {
  return n.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function SettingsPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [mappings, setMappings] = useState<CategoryMapping[]>([]);
  const [loading, setLoading] = useState(true);

  // Profile edit
  const [editDisplayName, setEditDisplayName] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  // Password change
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwMsg, setPwMsg] = useState("");

  // Account form
  const [accName, setAccName] = useState("");
  const [accPlatform, setAccPlatform] = useState("支付宝");
  const [accType, setAccType] = useState("ewallet");
  const [accBalance, setAccBalance] = useState(0);

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    Promise.all([
      api<UserInfo>("/api/auth/me"),
      api<{ items: Account[] }>("/api/accounts"),
      api<{ items: CategoryMapping[] }>("/api/categories/mappings"),
    ])
      .then(([u, a, m]) => {
        setUser(u);
        setEditDisplayName(u.display_name || "");
        setAccounts(a.items);
        setMappings(m.items);
      })
      .catch(() => router.push("/login"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSaveProfile = async () => {
    setSavingProfile(true);
    try {
      await api("/api/auth/profile", {
        method: "PATCH",
        body: { display_name: editDisplayName },
      });
      if (user) {
        setUser({ ...user, display_name: editDisplayName });
      }
      toast.success("个人资料已更新");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "更新失败");
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePw = async () => {
    try {
      const res = await api<{ message: string }>("/api/auth/change-password", {
        method: "POST",
        body: { old_password: oldPw, new_password: newPw },
      });
      setPwMsg(res.message);
      setOldPw("");
      setNewPw("");
    } catch (e) {
      setPwMsg(e instanceof Error ? e.message : "修改失败");
    }
  };

  const handleAddAccount = async () => {
    try {
      await api("/api/accounts", {
        method: "POST",
        body: {
          name: accName,
          platform: accPlatform,
          account_type: accType,
          balance: accBalance,
        },
      });
      const res = await api<{ items: Account[] }>("/api/accounts");
      setAccounts(res.items);
      setAccName("");
      setAccBalance(0);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "添加失败");
    }
  };

  const handleDeleteAccount = async (id: number) => {
    if (!confirm("确定删除？")) return;
    try {
      await api(`/api/accounts/${id}`, { method: "DELETE" });
      setAccounts(accounts.filter((a) => a.id !== id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "删除失败");
    }
  };

  const handleMappingChange = async (id: number, newCategory: string) => {
    try {
      await api(`/api/categories/mappings/${id}`, {
        method: "PATCH",
        body: { mapped_category: newCategory },
      });
      setMappings(
        mappings.map((m) =>
          m.id === id ? { ...m, mapped_category: newCategory } : m
        )
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "更新失败");
    }
  };

  if (loading) {
    return (
      <AppLayout title="设置">
        <h2 className="text-xl font-bold">设置</h2>
        <div className="space-y-4 mt-4">
          <Skeleton className="h-10 w-64" />
          <Card>
            <CardHeader>
              <Skeleton className="h-5 w-24" />
            </CardHeader>
            <CardContent className="space-y-3">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-4 w-36" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <Skeleton className="h-5 w-24" />
            </CardHeader>
            <CardContent className="space-y-3">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-28" />
            </CardContent>
          </Card>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="设置">
      <h2 className="text-xl font-bold">设置</h2>

      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">账户</TabsTrigger>
          <TabsTrigger value="accounts">资产账户</TabsTrigger>
          <TabsTrigger value="categories">分类映射</TabsTrigger>
        </TabsList>

        {/* Profile */}
        <TabsContent value="profile" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">个人资料</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                <Label className="w-20">用户名</Label>
                <span className="text-sm">{user?.username}</span>
              </div>
              <div className="flex items-center gap-4">
                <Label className="w-20">角色</Label>
                <Badge
                  variant={user?.role === "admin" ? "default" : "secondary"}
                >
                  {user?.role === "admin" ? "管理员" : "普通用户"}
                </Badge>
              </div>
              <div className="flex items-center gap-4">
                <Label className="w-20">显示名</Label>
                <Input
                  value={editDisplayName}
                  onChange={(e) => setEditDisplayName(e.target.value)}
                  className="max-w-xs"
                  placeholder="设置显示名称"
                />
              </div>
              <Button
                onClick={handleSaveProfile}
                disabled={savingProfile || editDisplayName === user?.display_name}
                size="sm"
              >
                保存
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">修改密码</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <Label>当前密码</Label>
                <Input
                  type="password"
                  value={oldPw}
                  onChange={(e) => setOldPw(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>新密码</Label>
                <Input
                  type="password"
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                />
              </div>
              {pwMsg && (
                <p className="text-sm text-muted-foreground">{pwMsg}</p>
              )}
              <Button onClick={handleChangePw} disabled={!oldPw || !newPw}>
                确认修改
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Accounts */}
        <TabsContent value="accounts" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">资产账户</CardTitle>
              <CardDescription>
                管理你的支付宝、微信、银行卡等账户及余额
              </CardDescription>
            </CardHeader>
            <CardContent>
              {accounts.length === 0 ? (
                <p className="text-muted-foreground text-sm">暂无账户</p>
              ) : (
                <div className="space-y-2">
                  {accounts.map((a) => (
                    <div
                      key={a.id}
                      className="flex items-center justify-between py-2 border-b last:border-0"
                    >
                      <div>
                        <span className="font-medium">{a.name}</span>
                        <Badge variant="outline" className="ml-2">
                          {a.platform}
                        </Badge>
                        <Badge variant="secondary" className="ml-1">
                          {a.account_type}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3">
                        <span
                          className={`font-medium ${
                            a.balance >= 0 ? "text-green-500" : "text-red-500"
                          }`}
                        >
                          ¥{formatMoney(a.balance)}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          onClick={() => handleDeleteAccount(a.id)}
                        >
                          删除
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <Separator className="my-4" />

              <div className="flex gap-3 items-end flex-wrap">
                <div className="space-y-1">
                  <Label className="text-xs">名称</Label>
                  <Input
                    value={accName}
                    onChange={(e) => setAccName(e.target.value)}
                    placeholder="储蓄卡(尾号)"
                    className="w-36"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">平台</Label>
                  <Select
                    value={accPlatform}
                    onValueChange={(v) => {
                      if (v) setAccPlatform(v);
                    }}
                  >
                    <SelectTrigger className="w-36 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="支付宝">支付宝</SelectItem>
                      <SelectItem value="微信">微信</SelectItem>
                      <SelectItem value="招商银行">招商银行</SelectItem>
                      <SelectItem value="工商银行">工商银行</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">类型</Label>
                  <Select
                    value={accType}
                    onValueChange={(v) => {
                      if (v) setAccType(v);
                    }}
                  >
                    <SelectTrigger className="w-36 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ewallet">电子钱包</SelectItem>
                      <SelectItem value="savings">储蓄卡</SelectItem>
                      <SelectItem value="credit">信用卡</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">余额</Label>
                  <Input
                    type="number"
                    value={accBalance}
                    onChange={(e) => setAccBalance(Number(e.target.value))}
                    className="w-28"
                  />
                </div>
                <Button size="sm" onClick={handleAddAccount} disabled={!accName}>
                  添加
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Category Mappings */}
        <TabsContent value="categories" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">分类映射规则</CardTitle>
              <CardDescription>
                将各平台原始分类映射到统一分类。新平台分类首次出现时默认归为&ldquo;其他&rdquo;，可在此处修改。
              </CardDescription>
            </CardHeader>
            <CardContent>
              {mappings.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  暂无映射规则（系统将在导入数据时自动生成）
                </p>
              ) : (
                <div className="space-y-2">
                  {mappings.map((m) => (
                    <div
                      key={m.id}
                      className="flex items-center justify-between py-1 border-b last:border-0"
                    >
                      <div className="flex items-center gap-2 text-sm">
                        <Badge variant="outline">{m.platform}</Badge>
                        <span>{m.original_category}</span>
                        <span className="text-muted-foreground">→</span>
                      </div>
                      <Select
                        value={m.mapped_category}
                        onValueChange={(val) => {
                          if (val) handleMappingChange(m.id, val);
                        }}
                      >
                        <SelectTrigger className="w-32 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {UNIFIED_CATEGORIES.map((c) => (
                            <SelectItem key={c} value={c}>
                              {c}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </AppLayout>
  );
}
