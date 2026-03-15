"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getToken } from "@/lib/api";
import { AppLayout } from "@/components/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useDropzone } from "react-dropzone";
import { FileUp, Upload, CheckCircle, XCircle, Clock, FileSpreadsheet } from "lucide-react";

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

export default function ImportPage() {
  const router = useRouter();
  const [step, setStep] = useState<"upload" | "preview" | "result">("upload");
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [platform, setPlatform] = useState("");
  const [uploading, setUploading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [history, setHistory] = useState<ImportLog[]>([]);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);

  useEffect(() => {
    if (!getToken()) { router.push("/login"); return; }
    loadHistory();
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

  return (
    <AppLayout title="数据导入">
      <div className="max-w-4xl space-y-6">
        {/* Upload area */}
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
                        <p className="text-sm text-muted-foreground mt-1">
                          支持支付宝 CSV、微信 Excel（.csv / .xlsx）
                        </p>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Preview */}
        {step === "preview" && preview && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4" />
                文件预览：{preview.filename}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">识别平台</p>
                  <Select value={platform} onValueChange={v => setPlatform(v ?? "")}>
                    <SelectTrigger className="w-40 h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="alipay">支付宝</SelectItem>
                      <SelectItem value="wechat">微信</SelectItem>
                      <SelectItem value="cmb">招商银行</SelectItem>
                      <SelectItem value="icbc">工商银行</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">总行数</p>
                  <p className="font-medium">{preview.total_rows} 条</p>
                </div>
              </div>

              {/* Preview table */}
              <div className="overflow-x-auto border rounded-lg">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted/50">
                      {preview.headers.slice(0, 6).map((h, i) => (
                        <th key={i} className="text-left py-2 px-3 font-medium whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.preview_rows.slice(0, 5).map((row, i) => (
                      <tr key={i} className="border-t">
                        {row.slice(0, 6).map((cell, j) => (
                          <td key={j} className="py-1.5 px-3 truncate max-w-[150px]">{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.total_rows > 5 && (
                <p className="text-xs text-muted-foreground">仅显示前 5 行预览...</p>
              )}

              <div className="flex gap-3">
                <Button onClick={confirmImport} disabled={importing} className="gap-2">
                  {importing ? "导入中..." : "确认导入"}
                </Button>
                <Button variant="outline" onClick={resetUpload}>取消</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Result */}
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

        {/* Import History */}
        {history.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">导入历史</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {history.map((log) => (
                  <div key={log.id} className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors">
                    <div className="flex items-center gap-3">
                      {log.status === "completed" ? (
                        <CheckCircle className="w-4 h-4 text-green-500" />
                      ) : log.status === "error" ? (
                        <XCircle className="w-4 h-4 text-red-500" />
                      ) : (
                        <Clock className="w-4 h-4 text-amber-500" />
                      )}
                      <div>
                        <p className="text-sm font-medium">{log.filename}</p>
                        <p className="text-xs text-muted-foreground">{log.created_at?.slice(0, 16)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{log.platform}</Badge>
                      <span className="text-sm text-muted-foreground">
                        +{log.created_records} / {log.total_records}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
