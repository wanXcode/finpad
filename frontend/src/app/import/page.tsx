"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { api, getToken } from "@/lib/api";
import { AppLayout } from "@/components/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useDropzone } from "react-dropzone";
import { FileUp, Upload, CheckCircle, XCircle, Clock, FileSpreadsheet, Mail, Plus, Trash2, Play, RefreshCw } from "lucide-react";

type PreviewData = {
  filename: string;
  platform: string;
  total_rows: number;
  preview_rows: string[][];
  headers: string[];
};

type ImportResult = {
  total: number;
  created: number;
  skipped: number;
  failed: number;
};

type ImportLog = {
  id: number;
  filename: string;
  platform: string;
  total_records: number;
  created_records: number;
  skipped_records: number;
  status: string;
  created_at: string;
};

type EmailSource = {
  id: number;
  name: string;
  platform: string;
  config_json: string;
  sync_interval_minutes: number;
  enabled: number;
  last_sync_at: string | null;
  last_sync_status: string | null;
};

const PLATFORM_OPTIONS = [
  { value: "alipay", label: "支付宝", emoji: "💰" },
  { value: "wechat", label: "微信支付", emoji: "💚" },
  { value: "cmb", label: "招商银行", emoji: "🏦" },
  { value: "icbc", label: "工商银行", emoji: "🏛️" },
];

const IMAP_HOSTS = [
  { value: "imap.126.com", label: "126 邮箱" },
  { value: "imap.163.com", label: "163 邮箱" },
  { value: "imap.qq.com", label: "QQ 邮箱" },
  { value: "imap.gmail.com", label: "Gmail" },
  { value: "imap-mail.outlook.com", label: "Outlook" },
];

export default function ImportPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState("upload");
  
  // Upload state
  const [step, setStep] = useState<"upload" | "preview" | "result">("upload");
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [platform, setPlatform] = useState("");
  const [uploading, setUploading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [history, setHistory] = useState<ImportLog[]>([]);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);

  // Email sources state
  const [emailSources, setEmailSources] = useState<EmailSource[]>([]);
  const [loadingEmails, setLoadingEmails] = useState(false);
  const [showAddEmail, setShowAddEmail] = useState(false);
  const [emailForm, setEmailForm] = useState({
    name: "",
    platform: "alipay",
    imapHost: "imap.126.com",
    imapEmail: "",
    imapPassword: "",
    interval: 10,
  });
  const [savingEmail, setSavingEmail] = useState(false);

  useEffect(() => {
    if (!getToken()) { router.push("/login"); return; }
    loadHistory();
    loadEmailSources();
  }, [router]);

  const loadHistory = async () => {
    try {
      const token = getToken();
      const res = await fetch("/api/proxy/api/import/history", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setHistory(data.items || []);
      }
    } catch {}
  };

  const loadEmailSources = async () => {
    setLoadingEmails(true);
    try {
      const data = await api<{ items: EmailSource[] }>("/api/sources");
      const emailOnly = data.items?.filter((s: EmailSource) => {
        try {
          const cfg = JSON.parse(s.config_json || "{}");
          return cfg.type === "email_imap";
        } catch { return false; }
      }) || [];
      setEmailSources(emailOnly);
    } catch {}
    finally { setLoadingEmails(false); }
  };

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;
    setUploadedFile(file);
    setUploading(true);
    try {
      const token = getToken();
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/proxy/api/import/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) throw new Error(await res.text());
      const data: PreviewData = await res.json();
      setPreview(data);
      setPlatform(data.platform || "");
      setStep("preview");
    } catch (e: unknown) {
      toast.error("上传失败: " + (e instanceof Error ? e.message : "未知错误"));
    } finally {
      setUploading(false);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "text/csv": [".csv"],
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
      "application/vnd.ms-excel": [".xls"],
    },
    maxFiles: 1,
    disabled: uploading,
  });

  const confirmImport = async () => {
    if (!preview) return;
    setImporting(true);
    try {
      const token = getToken();
      const formData = new FormData();
      if (uploadedFile) formData.append("file", uploadedFile);
      formData.append("platform", platform);
      const res = await fetch("/api/proxy/api/import/confirm", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) throw new Error(await res.text());
      const data: ImportResult = await res.json();
      setResult(data);
      setStep("result");
      toast.success(`导入完成：新增 ${data.created} 条`);
      loadHistory();
    } catch (e: unknown) {
      toast.error("导入失败: " + (e instanceof Error ? e.message : "未知错误"));
    } finally {
      setImporting(false);
    }
  };

  const resetUpload = () => {
    setStep("upload");
    setPreview(null);
    setResult(null);
    setUploadedFile(null);
    setPlatform("");
  };

  const saveEmailSource = async () => {
    if (!emailForm.name || !emailForm.imapEmail || !emailForm.imapPassword) {
      toast.error("请填写完整信息");
      return;
    }
    setSavingEmail(true);
    try {
      await api("/api/sources", {
        method: "POST",
        body: JSON.stringify({
          name: emailForm.name,
          type: "email_imap",
          platform: emailForm.platform,
          config_json: JSON.stringify({
            type: "email_imap",
            imap_host: emailForm.imapHost,
            imap_email: emailForm.imapEmail,
            imap_password: emailForm.imapPassword,
          }),
          sync_interval_minutes: emailForm.interval,
        }),
      });
      toast.success("邮箱配置已保存");
      setShowAddEmail(false);
      setEmailForm({
        name: "",
        platform: "alipay",
        imapHost: "imap.126.com",
        imapEmail: "",
        imapPassword: "",
        interval: 10,
      });
      loadEmailSources();
    } catch { toast.error("保存失败"); }
    finally { setSavingEmail(false); }
  };

  const deleteEmailSource = async (id: number) => {
    if (!confirm("确认删除此邮箱配置？")) return;
    try {
      await api(`/api/sources/${id}`, { method: "DELETE" });
      toast.success("已删除");
      loadEmailSources();
    } catch { toast.error("删除失败"); }
  };

  const triggerSync = async (id: number) => {
    try {
      const res = await api<{ status: string; message: string }>(`/api/sources/${id}/sync`, { method: "POST" });
      if (res.status === "error") {
        toast.error(res.message || "同步失败");
      } else {
        toast.success("同步已触发");
      }
      loadEmailSources();
    } catch { toast.error("触发同步失败"); }
  };

  return (
    <AppLayout title="数据导入">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="max-w-4xl">
        <TabsList className="mb-4">
          <TabsTrigger value="upload" className="gap-1.5"><FileUp className="w-3.5 h-3.5" /> 文件导入</TabsTrigger>
          <TabsTrigger value="email" className="gap-1.5"><Mail className="w-3.5 h-3.5" /> 邮箱抓取</TabsTrigger>
        </TabsList>

        {/* ===== Tab 1: 文件导入 ===== */}
        <TabsContent value="upload" className="space-y-6">
          {step === "upload" && (
            <Card>
              <CardContent className="pt-6">
                <div
                  {...getRootProps()}
                  className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors
                    ${isDragActive ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50"}
                    ${uploading ? "opacity-50 pointer-events-none" : ""}`}
                >
                  <input {...getInputProps()} />
                  <div className="flex flex-col items-center gap-3">
                    {uploading ? (
                      <>
                        <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center animate-pulse">
                          <Upload className="w-6 h-6 text-muted-foreground" />
                        </div>
                        <p className="text-sm text-muted-foreground">正在解析文件...</p>
                      </>
                    ) : (
                      <>
                        <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                          <FileUp className="w-6 h-6 text-muted-foreground" />
                        </div>
                        <div>
                          <p className="font-medium">拖拽文件到这里，或点击选择</p>
                          <p className="text-sm text-muted-foreground mt-1">支持支付宝 CSV、微信 Excel（.csv / .xlsx）</p>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {step === "preview" && preview && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4" /> 文件预览：{preview.filename}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">识别平台</p>
                    <Select value={platform} onValueChange={(v: string | null) => setPlatform(v ?? "")}>
                      <SelectTrigger className="w-40 h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {PLATFORM_OPTIONS.map(p => <SelectItem key={p.value} value={p.value}>{p.emoji} {p.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">总行数</p>
                    <p className="font-medium">{preview.total_rows} 条</p>
                  </div>
                </div>
                <div className="overflow-x-auto border rounded-lg">
                  <table className="w-full text-xs">
                    <thead><tr className="bg-muted/50">
                      {preview.headers.slice(0, 6).map((h, i) => <th key={i} className="text-left py-2 px-3 font-medium whitespace-nowrap">{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {preview.preview_rows.slice(0, 5).map((row, i) => (
                        <tr key={i} className="border-t">
                          {row.slice(0, 6).map((cell, j) => <td key={j} className="py-1.5 px-3 truncate max-w-[150px]">{cell}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {preview.total_rows > 5 && <p className="text-xs text-muted-foreground">仅显示前 5 行预览...</p>}
                <div className="flex gap-3">
                  <Button onClick={confirmImport} disabled={importing}>{importing ? "导入中..." : "确认导入"}</Button>
                  <Button variant="outline" onClick={resetUpload}>取消</Button>
                </div>
              </CardContent>
            </Card>
          )}

          {step === "result" && result && (
            <Card>
              <CardContent className="pt-6">
                <div className="text-center py-6">
                  <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
                  <h3 className="text-lg font-semibold mb-4">导入完成</h3>
                  <div className="flex justify-center gap-6 text-sm">
                    <div><p className="text-2xl font-bold text-green-600">{result.created}</p><p className="text-muted-foreground">新增</p></div>
                    <div><p className="text-2xl font-bold text-muted-foreground">{result.skipped}</p><p className="text-muted-foreground">跳过（重复）</p></div>
                    <div><p className="text-2xl font-bold text-red-500">{result.failed}</p><p className="text-muted-foreground">失败</p></div>
                  </div>
                  <div className="flex gap-3 justify-center mt-6">
                    <Button onClick={resetUpload} variant="outline">继续导入</Button>
                    <Button onClick={() => router.push("/transactions")}>查看交易</Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {history.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">导入历史</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {history.map((log) => (
                    <div key={log.id} className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors">
                      <div className="flex items-center gap-3">
                        {log.status === "completed" ? <CheckCircle className="w-4 h-4 text-green-500" /> :
                         log.status === "error" ? <XCircle className="w-4 h-4 text-red-500" /> :
                         <Clock className="w-4 h-4 text-amber-500" />}
                        <div>
                          <p className="text-sm font-medium">{log.filename}</p>
                          <p className="text-xs text-muted-foreground">{log.created_at?.slice(0, 16)}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{log.platform}</Badge>
                        <span className="text-sm text-muted-foreground">+{log.created_records} / {log.total_records}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ===== Tab 2: 邮箱抓取 ===== */}
        <TabsContent value="email" className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium">邮箱账单抓取</h3>
              <p className="text-sm text-muted-foreground">通过 IMAP 从邮箱自动抓取账单邮件并解析入库</p>
            </div>
            <Button size="sm" onClick={() => setShowAddEmail(true)} className="gap-1.5">
              <Plus className="w-3.5 h-3.5" /> 添加邮箱
            </Button>
          </div>

          {/* Add email form */}
          {showAddEmail && (
            <Card>
              <CardHeader><CardTitle className="text-base">添加邮箱配置</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>配置名称</Label>
                    <Input placeholder="例如：126邮箱-支付宝" value={emailForm.name}
                      onChange={e => setEmailForm(f => ({ ...f, name: e.target.value }))} />
                  </div>
                  <div>
                    <Label>账单平台</Label>
                    <Select value={emailForm.platform} onValueChange={(v: string | null) => setEmailForm(f => ({ ...f, platform: v ?? "alipay" }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {PLATFORM_OPTIONS.map(p => <SelectItem key={p.value} value={p.value}>{p.emoji} {p.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>邮箱服务商</Label>
                    <Select value={emailForm.imapHost} onValueChange={(v: string | null) => setEmailForm(f => ({ ...f, imapHost: v ?? "imap.126.com" }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {IMAP_HOSTS.map(h => <SelectItem key={h.value} value={h.value}>{h.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>同步间隔（分钟）</Label>
                    <Input type="number" value={emailForm.interval}
                      onChange={e => setEmailForm(f => ({ ...f, interval: parseInt(e.target.value) || 10 }))} />
                  </div>
                  <div className="col-span-2">
                    <Label>邮箱地址</Label>
                    <Input placeholder="yourname@126.com" value={emailForm.imapEmail}
                      onChange={e => setEmailForm(f => ({ ...f, imapEmail: e.target.value }))} />
                  </div>
                  <div className="col-span-2">
                    <Label>IMAP 授权密码</Label>
                    <Input type="password" placeholder="邮箱的 IMAP 授权码（非登录密码）" value={emailForm.imapPassword}
                      onChange={e => setEmailForm(f => ({ ...f, imapPassword: e.target.value }))} />
                    <p className="text-xs text-muted-foreground mt-1">请在邮箱设置中开启 IMAP 并获取授权码</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <Button onClick={saveEmailSource} disabled={savingEmail}>{savingEmail ? "保存中..." : "保存"}</Button>
                  <Button variant="outline" onClick={() => setShowAddEmail(false)}>取消</Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Email sources list */}
          {loadingEmails ? (
            <div className="space-y-3">{[...Array(2)].map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
          ) : emailSources.length === 0 && !showAddEmail ? (
            <Card>
              <CardContent className="pt-6">
                <div className="text-center py-8">
                  <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
                    <Mail className="w-6 h-6 text-muted-foreground" />
                  </div>
                  <h3 className="font-medium mb-1">暂未配置邮箱</h3>
                  <p className="text-sm text-muted-foreground mb-4">配置后可自动从邮箱抓取支付宝/微信/银行账单</p>
                  <Button size="sm" onClick={() => setShowAddEmail(true)} className="gap-1.5">
                    <Plus className="w-3.5 h-3.5" /> 添加邮箱
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {emailSources.map((src) => {
                const cfg = (() => { try { return JSON.parse(src.config_json || "{}"); } catch { return {}; } })();
                const platformInfo = PLATFORM_OPTIONS.find(p => p.value === src.platform);
                return (
                  <Card key={src.id}>
                    <CardContent className="pt-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="text-lg">{platformInfo?.emoji || "📧"}</span>
                          <div>
                            <p className="font-medium">{src.name}</p>
                            <p className="text-xs text-muted-foreground">{cfg.imap_email} · {cfg.imap_host} · 每 {src.sync_interval_minutes} 分钟</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {src.last_sync_status && (
                            <Badge variant={src.last_sync_status === "success" ? "default" : "destructive"} className="text-xs">
                              {src.last_sync_status === "success" ? "✓ 正常" : "✕ 异常"}
                            </Badge>
                          )}
                          {src.last_sync_at && (
                            <span className="text-xs text-muted-foreground">上次：{src.last_sync_at.slice(0, 16)}</span>
                          )}
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => triggerSync(src.id)} title="立即同步">
                            <Play className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => deleteEmailSource(src.id)} title="删除">
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </AppLayout>
  );
}
