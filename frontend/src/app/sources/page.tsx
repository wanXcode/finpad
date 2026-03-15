"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { api, getToken } from "@/lib/api";
import { AppLayout } from "@/components/app-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type Source = {
  id: number;
  name: string;
  type: string;
  platform: string;
  config_json: string | null;
  sync_interval_minutes: number;
  enabled: number;
  last_sync_at: string | null;
  created_at: string;
};

type SyncLog = {
  id: number;
  status: string;
  total_fetched: number;
  new_inserted: number;
  duplicates_skipped: number;
  errors: number;
  error_message: string | null;
  started_at: string;
  finished_at: string | null;
};

const PLATFORM_OPTIONS = [
  { value: "alipay", label: "支付宝", emoji: "💰" },
  { value: "wechat", label: "微信支付", emoji: "💚" },
  { value: "cmb", label: "招商银行", emoji: "🏦" },
  { value: "icbc", label: "工商银行", emoji: "🏛️" },
];

const TYPE_OPTIONS = [
  { value: "email_imap", label: "邮箱 IMAP（自动抓取）" },
  { value: "manual_upload", label: "手动上传" },
];

export default function SourcesPage() {
  const router = useRouter();
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [logsDialogOpen, setLogsDialogOpen] = useState(false);
  const [activeLogs, setActiveLogs] = useState<SyncLog[]>([]);
  const [activeSourceName, setActiveSourceName] = useState("");

  // Form state
  const [formName, setFormName] = useState("");
  const [formType, setFormType] = useState("email_imap");
  const [formPlatform, setFormPlatform] = useState("alipay");
  const [formInterval, setFormInterval] = useState(10);
  const [formImapHost, setFormImapHost] = useState("");
  const [formImapEmail, setFormImapEmail] = useState("");
  const [formImapPassword, setFormImapPassword] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchSources = useCallback(async () => {
    try {
      const res = await api<{ items: Source[] }>("/api/sources");
      setSources(res.items);
    } catch {
      router.push("/login");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    if (!getToken()) { router.push("/login"); return; }
    fetchSources();
  }, [fetchSources, router]);

  const handleCreate = async () => {
    setSaving(true);
    try {
      const configJson = formType === "email_imap"
        ? JSON.stringify({ imap_host: formImapHost, email: formImapEmail, password: formImapPassword })
        : null;
      await api("/api/sources", {
        method: "POST",
        body: {
          name: formName,
          type: formType,
          platform: formPlatform,
          config_json: configJson,
          sync_interval_minutes: formInterval,
        },
      });
      setDialogOpen(false);
      setFormName(""); setFormImapHost(""); setFormImapEmail(""); setFormImapPassword("");
      fetchSources();
    } catch (e) {
      alert(e instanceof Error ? e.message : "创建失败");
    } finally {
      setSaving(false);
    }
  };

  const handleSync = async (id: number) => {
    try {
      const res = await api<{ message: string }>(`/api/sources/${id}/sync`, { method: "POST" });
      alert(res.message);
    } catch (e) {
      alert(e instanceof Error ? e.message : "同步失败");
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("确定要删除这个数据源吗？")) return;
    try {
      await api(`/api/sources/${id}`, { method: "DELETE" });
      fetchSources();
    } catch (e) {
      alert(e instanceof Error ? e.message : "删除失败");
    }
  };

  const handleViewLogs = async (source: Source) => {
    try {
      const res = await api<{ items: SyncLog[] }>(`/api/sources/${source.id}/logs`);
      setActiveLogs(res.items);
      setActiveSourceName(source.name);
      setLogsDialogOpen(true);
    } catch (e) {
      alert(e instanceof Error ? e.message : "获取日志失败");
    }
  };

  const platformInfo = (key: string) => PLATFORM_OPTIONS.find((p) => p.value === key);

  return (
    <AppLayout title="数据源管理">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold">数据源管理</h2>
            <p className="text-sm text-muted-foreground mt-1">配置账单自动抓取或手动导入</p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger>
              <Button>+ 添加数据源</Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>添加数据源</DialogTitle>
                <DialogDescription>配置新的账单数据来源</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 mt-2">
                <div className="space-y-2">
                  <Label>名称</Label>
                  <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="例：支付宝账单" />
                </div>
                <div className="space-y-2">
                  <Label>平台</Label>
                  <select value={formPlatform} onChange={(e) => setFormPlatform(e.target.value)} className="w-full border rounded px-3 py-2 text-sm bg-background">
                    {PLATFORM_OPTIONS.map((p) => (
                      <option key={p.value} value={p.value}>{p.emoji} {p.label}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>接入方式</Label>
                  <select value={formType} onChange={(e) => setFormType(e.target.value)} className="w-full border rounded px-3 py-2 text-sm bg-background">
                    {TYPE_OPTIONS.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
                {formType === "email_imap" && (
                  <>
                    <div className="space-y-2">
                      <Label>IMAP 服务器</Label>
                      <Input value={formImapHost} onChange={(e) => setFormImapHost(e.target.value)} placeholder="imap.126.com" />
                    </div>
                    <div className="space-y-2">
                      <Label>邮箱</Label>
                      <Input value={formImapEmail} onChange={(e) => setFormImapEmail(e.target.value)} placeholder="your@126.com" />
                    </div>
                    <div className="space-y-2">
                      <Label>密码 / 授权码</Label>
                      <Input type="password" value={formImapPassword} onChange={(e) => setFormImapPassword(e.target.value)} placeholder="IMAP 授权码" />
                    </div>
                  </>
                )}
                <div className="space-y-2">
                  <Label>同步间隔（分钟）</Label>
                  <Input type="number" value={formInterval} onChange={(e) => setFormInterval(Number(e.target.value))} min={1} />
                </div>
                <Button className="w-full" onClick={handleCreate} disabled={saving || !formName}>
                  {saving ? "创建中..." : "创建"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {loading ? (
          <p className="text-muted-foreground text-center py-12">加载中...</p>
        ) : sources.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">还没有配置任何数据源</p>
              <p className="text-sm text-muted-foreground mt-1">点击右上角"添加数据源"开始</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {sources.map((s) => {
              const pInfo = platformInfo(s.platform);
              return (
                <Card key={s.id}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{pInfo?.emoji || "📄"}</span>
                        <div>
                          <CardTitle className="text-base">{s.name}</CardTitle>
                          <CardDescription>
                            {pInfo?.label || s.platform} · {s.type === "email_imap" ? "邮箱自动抓取" : "手动上传"} · 每 {s.sync_interval_minutes} 分钟
                          </CardDescription>
                        </div>
                      </div>
                      <Badge variant={s.enabled ? "default" : "secondary"}>
                        {s.enabled ? "启用" : "停用"}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-muted-foreground">
                        上次同步：{s.last_sync_at || "从未"}
                      </p>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => handleViewLogs(s)}>日志</Button>
                        <Button variant="outline" size="sm" onClick={() => handleSync(s.id)}>立即同步</Button>
                        <Button variant="ghost" size="sm" className="text-destructive" onClick={() => handleDelete(s.id)}>删除</Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Sync logs dialog */}
        <Dialog open={logsDialogOpen} onOpenChange={setLogsDialogOpen}>
          <DialogContent className="max-w-2xl max-h-[70vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>同步日志 — {activeSourceName}</DialogTitle>
            </DialogHeader>
            {activeLogs.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">暂无同步记录</p>
            ) : (
              <div className="space-y-3">
                {activeLogs.map((log) => (
                  <div key={log.id} className="border rounded-lg p-3 text-sm space-y-1">
                    <div className="flex items-center justify-between">
                      <Badge variant={log.status === "success" ? "default" : log.status === "running" ? "secondary" : "destructive"}>
                        {log.status}
                      </Badge>
                      <span className="text-muted-foreground">{log.started_at}</span>
                    </div>
                    <div className="flex gap-4 text-muted-foreground">
                      <span>抓取 {log.total_fetched}</span>
                      <span>新增 {log.new_inserted}</span>
                      <span>跳过 {log.duplicates_skipped}</span>
                      {log.errors > 0 && <span className="text-destructive">错误 {log.errors}</span>}
                    </div>
                    {log.error_message && (
                      <p className="text-destructive text-xs">{log.error_message}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </AppLayout>
  );
}
