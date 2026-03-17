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
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useDropzone } from "react-dropzone";
import {
  FileUp, Upload, CheckCircle, XCircle, Clock, FileSpreadsheet, Mail, Plus, Trash2, Play,
  RefreshCw, ChevronDown, ChevronUp, Pencil, Eye, EyeOff, Lock, Loader2
} from "lucide-react";

type PreviewData = { filename: string; platform: string; total_rows: number; preview_rows: string[][]; headers: string[]; };
type ImportResult = { total: number; created: number; skipped: number; failed: number; };
type ImportLog = { id: number; filename: string; platform: string; total_records: number; created_records: number; skipped_records: number; status: string; created_at: string; };
type EmailSource = { id: number; name: string; type: string; platform: string; config_json: string; sync_interval_minutes: number; enabled: number; last_sync_at: string | null; last_sync_status: string | null; last_sync_message: string | null; created_at: string | null; };
type PendingImport = { id: number; filename: string; subject: string | null; platform: string; status: string; created_at: string; };
type EmailFormData = { name: string; platforms: string[]; imapHost: string; imapEmail: string; imapPassword: string; interval: number; };
type PlatformSyncResult = { status: string; records_created?: number; records_skipped?: number; pending_count?: number; error_message?: string | null; };

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

function parsePlatforms(platform: string): string[] {
  if (!platform) return [];
  try {
    const parsed = JSON.parse(platform);
    if (Array.isArray(parsed)) return parsed;
    return [String(parsed)];
  } catch {
    return [platform];
  }
}

function getPlatformInfo(value: string) {
  return PLATFORM_OPTIONS.find(p => p.value === value);
}

function parseSyncDetails(message: string | null): Record<string, PlatformSyncResult> | null {
  if (!message) return null;
  try {
    const parsed = JSON.parse(message);
    if (typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, PlatformSyncResult>;
    return null;
  } catch {
    return null;
  }
}

function SyncStatusBadge({ source, pendingCount }: { source: EmailSource; pendingCount: number }) {
  const status = source.last_sync_status;
  const message = source.last_sync_message;
  if (pendingCount > 0) return <Badge className="text-xs bg-yellow-100 text-yellow-800 border-yellow-300 hover:bg-yellow-100">⏳ {pendingCount} 个文件待输入密码</Badge>;
  if (!status) return <Badge variant="outline" className="text-xs text-muted-foreground">— 尚未同步</Badge>;
  switch (status) {
    case "success": return <Badge className="text-xs bg-green-100 text-green-800 border-green-300 hover:bg-green-100">✓ 同步成功</Badge>;
    case "partial": return <Badge className="text-xs bg-orange-100 text-orange-800 border-orange-300 hover:bg-orange-100">⚠ 部分成功</Badge>;
    case "pending_password": return <Badge className="text-xs bg-yellow-100 text-yellow-800 border-yellow-300 hover:bg-yellow-100">⏳ 待输入密码</Badge>;
    case "error": case "failed": {
      let brief = "";
      if (message) { const d = parseSyncDetails(message); if (!d) brief = " · " + message.slice(0, 30); }
      return <Badge className="text-xs bg-red-100 text-red-800 border-red-300 hover:bg-red-100">✕ 失败{brief}</Badge>;
    }
    case "syncing": return <Badge className="text-xs bg-blue-100 text-blue-800 border-blue-300 hover:bg-blue-100"><Loader2 className="w-3 h-3 mr-1 animate-spin inline" />同步中...</Badge>;
    default: return <Badge variant="outline" className="text-xs">{status}</Badge>;
  }
}

function PlatformSyncDetail({ platformKey, result }: { platformKey: string; result: PlatformSyncResult }) {
  const info = getPlatformInfo(platformKey);
  const emoji = info?.emoji || "📧";
  const label = info?.label || platformKey;
  let statusIcon: string, statusText: string, statusColor: string;
  switch (result.status) {
    case "success": statusIcon = "✓"; statusText = "成功"; statusColor = "text-green-700"; break;
    case "pending_password": statusIcon = "⏳"; statusText = "待输入密码"; statusColor = "text-yellow-700"; break;
    case "error": statusIcon = "✕"; statusText = "失败"; statusColor = "text-red-700"; break;
    case "partial": statusIcon = "⚠"; statusText = "部分成功"; statusColor = "text-orange-700"; break;
    default: statusIcon = "—"; statusText = result.status; statusColor = "text-muted-foreground";
  }
  return (
    <div className="flex items-start gap-2 py-1.5">
      <span className="text-sm shrink-0">{emoji}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium">{label}</span>
          <span className={statusColor + " font-medium"}>{statusIcon} {statusText}</span>
        </div>
        {result.status === "success" && <p className="text-xs text-muted-foreground">新增 {result.records_created || 0} 条，跳过 {result.records_skipped || 0} 条（重复）</p>}
        {result.status === "pending_password" && result.pending_count ? <p className="text-xs text-yellow-600">{result.pending_count} 个文件待输入密码</p> : null}
        {result.status === "error" && result.error_message && <p className="text-xs text-red-600 truncate">{result.error_message}</p>}
      </div>
    </div>
  );
}

export default function ImportPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState("upload");
  const [step, setStep] = useState<"upload" | "preview" | "result">("upload");
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [platform, setPlatform] = useState("");
  const [uploading, setUploading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [history, setHistory] = useState<ImportLog[]>([]);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [emailSources, setEmailSources] = useState<EmailSource[]>([]);
  const [loadingEmails, setLoadingEmails] = useState(false);
  const [showAddEmail, setShowAddEmail] = useState(false);
  const [emailForm, setEmailForm] = useState<EmailFormData>({ name: "", platforms: ["alipay"], imapHost: "imap.126.com", imapEmail: "", imapPassword: "", interval: 10 });
  const [savingEmail, setSavingEmail] = useState(false);
  const [expandedSources, setExpandedSources] = useState<Set<number>>(new Set());
  const [editingSources, setEditingSources] = useState<Set<number>>(new Set());
  const [editForms, setEditForms] = useState<Record<number, EmailFormData>>({});
  const [showPasswords, setShowPasswords] = useState<Set<number>>(new Set());
  const [syncingIds, setSyncingIds] = useState<Set<number>>(new Set());
  const [pendingBySource, setPendingBySource] = useState<Record<number, PendingImport[]>>({});
  const [pendingPasswords, setPendingPasswords] = useState<Record<number, string>>({});
  const [unlockingIds, setUnlockingIds] = useState<Set<number>>(new Set());
  const [unlockErrors, setUnlockErrors] = useState<Record<number, string>>({});
  const [detailsExpanded, setDetailsExpanded] = useState<Set<number>>(new Set());

  useEffect(() => { if (!getToken()) { router.push("/login"); return; } loadHistory(); loadEmailSources(); }, [router]);

  const loadHistory = async () => {
    try { const token = getToken(); const res = await fetch("/api/proxy/api/import/history", { headers: { Authorization: `Bearer ${token}` } }); if (res.ok) { const data = await res.json(); setHistory(data.items || []); } } catch {}
  };

  const loadEmailSources = async () => {
    setLoadingEmails(true);
    try {
      const data = await api<{ items: EmailSource[] }>("/api/sources");
      const emailOnly = data.items?.filter((s: EmailSource) => s.type === "email_imap") || [];
      setEmailSources(emailOnly);
      for (const src of emailOnly) { loadPending(src.id); }
    } catch {} finally { setLoadingEmails(false); }
  };

  const loadPending = async (sourceId: number) => {
    try { const data = await api<{ items: PendingImport[] }>(`/api/sources/${sourceId}/pending`); setPendingBySource(prev => ({ ...prev, [sourceId]: data.items || [] })); }
    catch { setPendingBySource(prev => ({ ...prev, [sourceId]: [] })); }
  };

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0]; if (!file) return;
    setUploadedFile(file); setUploading(true);
    try {
      const token = getToken(); const formData = new FormData(); formData.append("file", file);
      const res = await fetch("/api/proxy/api/import/upload", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: formData });
      if (!res.ok) throw new Error(await res.text());
      const data: PreviewData = await res.json(); setPreview(data); setPlatform(data.platform || ""); setStep("preview");
    } catch (e: unknown) { toast.error("上传失败: " + (e instanceof Error ? e.message : "未知错误")); } finally { setUploading(false); }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, accept: { "text/csv": [".csv"], "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"], "application/vnd.ms-excel": [".xls"] }, maxFiles: 1, disabled: uploading });

  const confirmImport = async () => {
    if (!preview) return;
    if (!platform || platform === "unknown") {
      toast.error("请先选择正确的账单平台（支付宝或微信）再确认导入");
      return;
    }
    setImporting(true);
    try {
      const token = getToken(); const formData = new FormData();
      if (uploadedFile) formData.append("file", uploadedFile); formData.append("platform", platform);
      const res = await fetch("/api/proxy/api/import/confirm", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: formData });
      if (!res.ok) throw new Error(await res.text());
      const data: ImportResult = await res.json(); setResult(data); setStep("result");
      toast.success("导入完成：新增 " + data.created + " 条"); loadHistory();
    } catch (e: unknown) { toast.error("导入失败: " + (e instanceof Error ? e.message : "未知错误")); } finally { setImporting(false); }
  };

  const resetUpload = () => { setStep("upload"); setPreview(null); setResult(null); setUploadedFile(null); setPlatform(""); };

  const toggleFormPlatform = (value: string, current: string[]): string[] => {
    return current.includes(value) ? current.filter(p => p !== value) : [...current, value];
  };

  const saveEmailSource = async () => {
    if (!emailForm.name || !emailForm.imapEmail || !emailForm.imapPassword) { toast.error("请填写完整信息"); return; }
    if (emailForm.platforms.length === 0) { toast.error("请至少选择一个账单平台"); return; }
    setSavingEmail(true);
    try {
      await api("/api/sources", { method: "POST", body: JSON.stringify({ name: emailForm.name, type: "email_imap", platform: JSON.stringify(emailForm.platforms), config_json: JSON.stringify({ type: "email_imap", imap_host: emailForm.imapHost, email: emailForm.imapEmail, password: emailForm.imapPassword }), sync_interval_minutes: emailForm.interval }) });
      toast.success("邮箱配置已保存"); setShowAddEmail(false);
      setEmailForm({ name: "", platforms: ["alipay"], imapHost: "imap.126.com", imapEmail: "", imapPassword: "", interval: 10 }); loadEmailSources();
    } catch { toast.error("保存失败"); } finally { setSavingEmail(false); }
  };

  const deleteEmailSource = async (id: number) => {
    if (!confirm("确认删除此邮箱配置？")) return;
    try { await api(`/api/sources/${id}`, { method: "DELETE" }); toast.success("已删除"); loadEmailSources(); } catch { toast.error("删除失败"); }
  };

  const triggerSync = async (id: number) => {
    setSyncingIds(prev => new Set(prev).add(id));
    try {
      const res = await api<{ status: string; message: string; results?: Record<string, PlatformSyncResult> }>(`/api/sources/${id}/sync`, { method: "POST" });
      if (res.status === "error") toast.error(res.message || "同步失败");
      else if (res.status === "pending_password") toast.warning(res.message || "有加密文件待输入密码");
      else if (res.status === "partial") toast.warning(res.message || "部分平台同步成功");
      else toast.success(res.message || "同步成功");
      setDetailsExpanded(prev => new Set(prev).add(id));
      loadEmailSources();
    } catch { toast.error("触发同步失败"); }
    finally { setSyncingIds(prev => { const n = new Set(prev); n.delete(id); return n; }); }
  };

  const toggleExpand = (id: number) => { setExpandedSources(prev => { const n = new Set(prev); if (n.has(id)) { n.delete(id); setEditingSources(es => { const x = new Set(es); x.delete(id); return x; }); } else n.add(id); return n; }); };
  const toggleDetails = (id: number) => { setDetailsExpanded(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; }); };

  const startEdit = (src: EmailSource) => {
    const cfg = (() => { try { return JSON.parse(src.config_json || "{}"); } catch { return {} as Record<string, string>; } })();
    setEditForms(prev => ({ ...prev, [src.id]: { name: src.name, platforms: parsePlatforms(src.platform), imapHost: cfg.imap_host || "imap.126.com", imapEmail: cfg.email || cfg.imap_email || "", imapPassword: cfg.password || cfg.imap_password || "", interval: src.sync_interval_minutes } }));
    setEditingSources(prev => new Set(prev).add(src.id));
  };
  const cancelEdit = (id: number) => { setEditingSources(prev => { const n = new Set(prev); n.delete(id); return n; }); };
  const saveEdit = async (id: number) => {
    const form = editForms[id]; if (!form) return;
    if (form.platforms.length === 0) { toast.error("请至少选择一个账单平台"); return; }
    try {
      await api(`/api/sources/${id}`, { method: "PATCH", body: JSON.stringify({ name: form.name, platform: JSON.stringify(form.platforms), config_json: JSON.stringify({ type: "email_imap", imap_host: form.imapHost, email: form.imapEmail, password: form.imapPassword }), sync_interval_minutes: form.interval }) });
      toast.success("配置已更新"); cancelEdit(id); loadEmailSources();
    } catch { toast.error("更新失败"); }
  };
  const togglePasswordVisibility = (id: number) => { setShowPasswords(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; }); };

  const unlockPending = async (sourceId: number, pendingId: number) => {
    const password = pendingPasswords[pendingId] || ""; if (!password) { toast.error("请输入密码"); return; }
    setUnlockingIds(prev => new Set(prev).add(pendingId));
    setUnlockErrors(prev => { const n = { ...prev }; delete n[pendingId]; return n; });
    try {
      const res = await api<{ status: string; message?: string; result?: { total: number; new_inserted: number; duplicates_skipped: number } }>(`/api/sources/${sourceId}/pending/${pendingId}/unlock`, { method: "POST", body: JSON.stringify({ password }) });
      if (res.status === "success") { toast.success("解锁成功！新增 " + (res.result?.new_inserted || 0) + " 条交易"); setPendingPasswords(prev => { const n = { ...prev }; delete n[pendingId]; return n; }); loadPending(sourceId); loadEmailSources(); }
      else { setUnlockErrors(prev => ({ ...prev, [pendingId]: res.message || "解锁失败" })); }
    } catch (e: unknown) { setUnlockErrors(prev => ({ ...prev, [pendingId]: e instanceof Error ? e.message : "解锁失败" })); }
    finally { setUnlockingIds(prev => { const n = new Set(prev); n.delete(pendingId); return n; }); }
  };

  const renderPlatformCheckboxes = (selected: string[], onChange: (v: string[]) => void) => (
    <div className="space-y-2.5 pt-1">
      {PLATFORM_OPTIONS.map(p => (
        <label key={p.value} className="flex items-center gap-2.5 cursor-pointer select-none">
          <Checkbox checked={selected.includes(p.value)} onCheckedChange={() => onChange(toggleFormPlatform(p.value, selected))} />
          <span className="text-sm">{p.emoji} {p.label}</span>
        </label>
      ))}
    </div>
  );

  const renderSourceCard = (src: EmailSource) => {
    const cfg = (() => { try { return JSON.parse(src.config_json || "{}"); } catch { return {} as Record<string, string>; } })();
    const platforms = parsePlatforms(src.platform);
    const isExpanded = expandedSources.has(src.id);
    const isEditing = editingSources.has(src.id);
    const isSyncing = syncingIds.has(src.id);
    const pendingItems = pendingBySource[src.id] || [];
    const pendingCount = pendingItems.length;
    const pwdVisible = showPasswords.has(src.id);
    const editForm = editForms[src.id];
    const imapHostLabel = IMAP_HOSTS.find(h => h.value === (cfg.imap_host || ""))?.label || cfg.imap_host || "";
    const emailAddr = cfg.email || cfg.imap_email || "";
    const passwordVal = cfg.password || cfg.imap_password || "";
    const isDetailsOpen = detailsExpanded.has(src.id);
    const syncDetails = parseSyncDetails(src.last_sync_message);

    return (
      <Card key={src.id}>
        <CardContent className="pt-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer" onClick={() => toggleExpand(src.id)}>
              <span className="text-lg">📧</span>
              <div className="min-w-0 flex-1">
                <p className="font-medium truncate">{src.name}</p>
                <p className="text-xs text-muted-foreground truncate">{emailAddr} · {imapHostLabel} · 每 {src.sync_interval_minutes} 分钟</p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {platforms.map(p => { const info = getPlatformInfo(p); return <Badge key={p} variant="outline" className="text-xs px-1.5 py-0">{info ? (info.emoji + " " + info.label) : p}</Badge>; })}
                </div>
              </div>
              {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
            </div>
            <div className="flex items-center gap-2 ml-3">
              <div className="cursor-pointer" onClick={() => toggleDetails(src.id)}>
                <SyncStatusBadge source={src} pendingCount={pendingCount} />
              </div>
              {src.last_sync_at && <span className="text-xs text-muted-foreground hidden sm:inline">上次：{src.last_sync_at.slice(0, 16)}</span>}
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => triggerSync(src.id)} title="立即同步" disabled={isSyncing}>
                {isSyncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => deleteEmailSource(src.id)} title="删除">
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>

          {isDetailsOpen && (src.last_sync_status || pendingCount > 0) && (
            <div className="border-t pt-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">同步详情{src.last_sync_at ? ("（" + src.last_sync_at.slice(0, 16) + "）") : ""}</p>
                <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => toggleDetails(src.id)}>收起</Button>
              </div>
              {syncDetails ? (
                <div className="bg-muted/30 rounded-lg p-3 space-y-1">
                  {Object.entries(syncDetails).map(([key, val]) => <PlatformSyncDetail key={key} platformKey={key} result={val} />)}
                </div>
              ) : src.last_sync_message ? (
                <div className="bg-muted/30 rounded-lg p-3"><p className="text-sm text-muted-foreground">{src.last_sync_message}</p></div>
              ) : null}
              {pendingItems.map(pi => {
                const piInfo = getPlatformInfo(pi.platform);
                return (
                  <div key={pi.id} className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 space-y-2">
                    <div className="flex items-start gap-2">
                      <Lock className="w-4 h-4 text-yellow-600 mt-0.5 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{piInfo ? (piInfo.emoji + " " + piInfo.label) : pi.platform} · 📎 {pi.filename}</p>
                        {pi.subject && <p className="text-xs text-muted-foreground truncate">来自：{pi.subject}</p>}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Input type="password" placeholder="输入 ZIP 密码" className="flex-1 h-8 text-sm" value={pendingPasswords[pi.id] || ""} onChange={e => setPendingPasswords(prev => ({ ...prev, [pi.id]: e.target.value }))} onKeyDown={e => { if (e.key === "Enter") unlockPending(src.id, pi.id); }} />
                      <Button size="sm" className="h-8 text-xs" onClick={() => unlockPending(src.id, pi.id)} disabled={unlockingIds.has(pi.id)}>
                        {unlockingIds.has(pi.id) ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}解锁并导入
                      </Button>
                    </div>
                    {unlockErrors[pi.id] && <p className="text-xs text-red-600">{unlockErrors[pi.id]}</p>}
                  </div>
                );
              })}
            </div>
          )}

          {!isDetailsOpen && pendingCount > 0 && (
            <div className="border-t pt-3">
              <p className="text-sm font-medium text-yellow-700 cursor-pointer" onClick={() => toggleDetails(src.id)}>⏳ {pendingCount} 个文件待输入密码 — 点击展开</p>
            </div>
          )}

          {isExpanded && (
            <div className="border-t pt-3">
              {!isEditing ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">配置详情</p>
                    <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => startEdit(src)}><Pencil className="w-3 h-3" /> 编辑</Button>
                  </div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                    <div><span className="text-muted-foreground">配置名称</span><p className="font-medium">{src.name}</p></div>
                    <div>
                      <span className="text-muted-foreground">开通平台</span>
                      <div className="flex flex-wrap gap-1.5 mt-0.5">
                        {platforms.map(p => { const info = getPlatformInfo(p); return <span key={p} className="font-medium text-sm">{info ? (info.emoji + " " + info.label) : p}</span>; })}
                      </div>
                    </div>
                    <div><span className="text-muted-foreground">邮箱服务商</span><p className="font-medium">{imapHostLabel}</p></div>
                    <div><span className="text-muted-foreground">邮箱地址</span><p className="font-medium">{emailAddr}</p></div>
                    <div><span className="text-muted-foreground">IMAP 授权码</span>
                      <div className="flex items-center gap-1">
                        <p className="font-medium font-mono">{pwdVisible ? passwordVal : "••••••••"}</p>
                        <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => togglePasswordVisibility(src.id)}>{pwdVisible ? <EyeOff className="w-3 h-3" /> :
 <Eye className="w-3 h-3" />}</Button>
                      </div>
                    </div>
                    <div><span className="text-muted-foreground">同步间隔</span><p className="font-medium">每 {src.sync_interval_minutes} 分钟</p></div>
                    {src.created_at && <div><span className="text-muted-foreground">创建时间</span><p className="font-medium">{src.created_at.slice(0, 16)}</p></div>}
                  </div>
                </div>
              ) : editForm ? (
                <div className="space-y-4">
                  <p className="text-sm font-medium">编辑配置</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div><Label className="text-xs">配置名称</Label><Input value={editForm.name} onChange={e => setEditForms(prev => ({ ...prev, [src.id]: { ...prev[src.id], name: e.target.value } }))} /></div>
                    <div><Label className="text-xs">邮箱服务商</Label>
                      <Select value={editForm.imapHost} onValueChange={(v: string | null) => setEditForms(prev => ({ ...prev, [src.id]: { ...prev[src.id], imapHost: v ?? "imap.126.com" } }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{IMAP_HOSTS.map(h => <SelectItem key={h.value} value={h.value}>{h.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-2">
                      <Label className="text-xs">开通平台</Label>
                      {renderPlatformCheckboxes(editForm.platforms, (v) => setEditForms(prev => ({ ...prev, [src.id]: { ...prev[src.id], platforms: v } })))}
                    </div>
                    <div><Label className="text-xs">同步间隔（分钟）</Label><Input type="number" value={editForm.interval} onChange={e => setEditForms(prev => ({ ...prev, [src.id]: { ...prev[src.id], interval: parseInt(e.target.value) || 10 } }))} /></div>
                    <div className="col-span-2"><Label className="text-xs">邮箱地址</Label><Input value={editForm.imapEmail} onChange={e => setEditForms(prev => ({ ...prev, [src.id]: { ...prev[src.id], imapEmail: e.target.value } }))} /></div>
                    <div className="col-span-2"><Label className="text-xs">IMAP 授权码</Label>
                      <div className="flex gap-2">
                        <Input type={showPasswords.has(src.id) ? "text" : "password"} value={editForm.imapPassword} onChange={e => setEditForms(prev => ({ ...prev, [src.id]: { ...prev[src.id], imapPassword: e.target.value } }))} className="flex-1" />
                        <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => togglePasswordVisibility(src.id)}>{showPasswords.has(src.id) ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</Button>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-3"><Button size="sm" onClick={() => saveEdit(src.id)}>保存</Button><Button size="sm" variant="outline" onClick={() => cancelEdit(src.id)}>取消</Button></div>
                </div>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <AppLayout title="数据导入">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="max-w-4xl">
        <TabsList className="mb-4">
          <TabsTrigger value="upload" className="gap-1.5"><FileUp className="w-3.5 h-3.5" /> 文件导入</TabsTrigger>
          <TabsTrigger value="email" className="gap-1.5"><Mail className="w-3.5 h-3.5" /> 邮箱抓取</TabsTrigger>
        </TabsList>

        <TabsContent value="upload" className="space-y-6">
          {step === "upload" && (
            <Card><CardContent className="pt-6">
              <div {...getRootProps()} className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors ${isDragActive ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50"} ${uploading ? "opacity-50 pointer-events-none" : ""}`}>
                <input {...getInputProps()} />
                <div className="flex flex-col items-center gap-3">
                  {uploading ? (<><div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center animate-pulse"><Upload className="w-6 h-6 text-muted-foreground" /></div><p className="text-sm text-muted-foreground">正在解析文件...</p></>) : (<><div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center"><FileUp className="w-6 h-6 text-muted-foreground" /></div><div><p className="font-medium">拖拽文件到这里，或点击选择</p><p className="text-sm text-muted-foreground mt-1">支持支付宝 CSV、微信 Excel（.csv / .xlsx）</p></div></>)}
                </div>
              </div>
            </CardContent></Card>
          )}

          {step === "preview" && preview && (
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><FileSpreadsheet className="w-4 h-4" /> 文件预览：{preview.filename}</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">识别平台</p>
                    <Select value={platform} onValueChange={(v: string | null) => setPlatform(v ?? "")}>
                      <SelectTrigger className="w-40 h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>{PLATFORM_OPTIONS.map(p => <SelectItem key={p.value} value={p.value}>{p.emoji} {p.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div><p className="text-sm text-muted-foreground">总行数</p><p className="font-medium">{preview.total_rows} 条</p></div>
                </div>
                <div className="overflow-x-auto border rounded-lg">
                  <table className="w-full text-xs">
                    <thead><tr className="bg-muted/50">{preview.headers.slice(0, 6).map((h, i) => <th key={i} className="text-left py-2 px-3 font-medium whitespace-nowrap">{h}</th>)}</tr></thead>
                    <tbody>{preview.preview_rows.slice(0, 5).map((row, i) => (<tr key={i} className="border-t">{row.slice(0, 6).map((cell, j) => <td key={j} className="py-1.5 px-3 truncate max-w-[150px]">{cell}</td>)}</tr>))}</tbody>
                  </table>
                </div>
                {preview.total_rows > 5 && <p className="text-xs text-muted-foreground">仅显示前 5 行预览...</p>}
                <div className="flex gap-3"><Button onClick={confirmImport} disabled={importing}>{importing ? "导入中..." : "确认导入"}</Button><Button variant="outline" onClick={resetUpload}>取消</Button></div>
              </CardContent>
            </Card>
          )}

          {step === "result" && result && (
            <Card><CardContent className="pt-6">
              <div className="text-center py-6">
                <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-4">导入完成</h3>
                <div className="flex justify-center gap-6 text-sm">
                  <div><p className="text-2xl font-bold text-green-600">{result.created}</p><p className="text-muted-foreground">新增</p></div>
                  <div><p className="text-2xl font-bold text-muted-foreground">{result.skipped}</p><p className="text-muted-foreground">跳过（重复）</p></div>
                  <div><p className="text-2xl font-bold text-red-500">{result.failed}</p><p className="text-muted-foreground">失败</p></div>
                </div>
                <div className="flex gap-3 justify-center mt-6"><Button onClick={resetUpload} variant="outline">继续导入</Button><Button onClick={() => router.push("/transactions")}>查看交易</Button></div>
              </div>
            </CardContent></Card>
          )}

          {history.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">导入历史</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {history.map((log) => (
                    <div key={log.id} className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors">
                      <div className="flex items-center gap-3">
                        {log.status === "completed" ? <CheckCircle className="w-4 h-4 text-green-500" /> : log.status === "error" ? <XCircle className="w-4 h-4 text-red-500" /> : <Clock className="w-4 h-4 text-amber-500" />}
                        <div><p className="text-sm font-medium">{log.filename}</p><p className="text-xs text-muted-foreground">{log.created_at?.slice(0, 16)}</p></div>
                      </div>
                      <div className="flex items-center gap-2"><Badge variant="outline">{log.platform}</Badge><span className="text-sm text-muted-foreground">+{log.created_records} / {log.total_records}</span></div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="email" className="space-y-6">
          <div className="flex items-center justify-between">
            <div><h3 className="font-medium">邮箱账单抓取</h3><p className="text-sm text-muted-foreground">通过 IMAP 从邮箱自动抓取账单邮件并解析入库</p></div>
            <Button size="sm" onClick={() => setShowAddEmail(true)} className="gap-1.5"><Plus className="w-3.5 h-3.5" /> 添加邮箱</Button>
          </div>

          {showAddEmail && (
            <Card>
              <CardHeader><CardTitle className="text-base">添加邮箱通道</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div><Label>通道名称</Label><Input placeholder="例如：我的126邮箱" value={emailForm.name} onChange={e => setEmailForm(f => ({ ...f, name: e.target.value }))} /></div>
                  <div><Label>邮箱服务商</Label>
                    <Select value={emailForm.imapHost} onValueChange={(v: string | null) => setEmailForm(f => ({ ...f, imapHost: v ?? "imap.126.com" }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{IMAP_HOSTS.map(h => <SelectItem key={h.value} value={h.value}>{h.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2"><Label>邮箱地址</Label><Input placeholder="yourname@126.com" value={emailForm.imapEmail} onChange={e => setEmailForm(f => ({ ...f, imapEmail: e.target.value }))} /></div>
                  <div className="col-span-2"><Label>IMAP 授权密码</Label><Input type="password" placeholder="邮箱的 IMAP 授权码（非登录密码）" value={emailForm.imapPassword} onChange={e => setEmailForm(f => ({ ...f, imapPassword: e.target.value }))} /><p className="text-xs text-muted-foreground mt-1">请在邮箱设置中开启 IMAP 并获取授权码</p></div>
                  <div><Label>同步间隔（分钟）</Label><Input type="number" value={emailForm.interval} onChange={e => setEmailForm(f => ({ ...f, interval: parseInt(e.target.value) || 10 }))} /></div>
                  <div className="col-span-2">
                    <Label>开通平台（勾选邮箱中接收的账单类型）</Label>
                    {renderPlatformCheckboxes(emailForm.platforms, (v) => setEmailForm(f => ({ ...f, platforms: v })))}
                  </div>
                </div>
                <div className="flex gap-3"><Button onClick={saveEmailSource} disabled={savingEmail}>{savingEmail ? "保存中..." : "保存"}</Button><Button variant="outline" onClick={() => setShowAddEmail(false)}>取消</Button></div>
              </CardContent>
            </Card>
          )}

          {loadingEmails ? (
            <div className="space-y-3">{[...Array(2)].map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
          ) : emailSources.length === 0 && !showAddEmail ? (
            <Card><CardContent className="pt-6">
              <div className="text-center py-8">
                <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-4"><Mail className="w-6 h-6 text-muted-foreground" /></div>
                <h3 className="font-medium mb-1">暂未配置邮箱</h3>
                <p className="text-sm text-muted-foreground mb-4">配置后可自动从邮箱抓取支付宝/微信/银行账单</p>
                <Button size="sm" onClick={() => setShowAddEmail(true)} className="gap-1.5"><Plus className="w-3.5 h-3.5" /> 添加邮箱</Button>
              </div>
            </CardContent></Card>
          ) : (
            <div className="space-y-3">{emailSources.map(src => renderSourceCard(src))}</div>
          )}
        </TabsContent>
      </Tabs>
    </AppLayout>
  );
}
