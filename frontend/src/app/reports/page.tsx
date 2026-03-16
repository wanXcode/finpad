"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, getToken } from "@/lib/api";
import { AppLayout } from "@/components/app-layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import ReactMarkdown from "react-markdown";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

type Report = {
  id: number;
  period: string;
  report_type: string;
  status: string;
  created_at: string;
};

type ReportDetail = Report & {
  raw_data_json: string;
  ai_analysis: string | null;
};

function getMonthOptions(): { value: string; label: string }[] {
  const options = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`;
    options.push({ value, label });
  }
  return options;
}

export default function ReportsPage() {
  const router = useRouter();
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [detail, setDetail] = useState<ReportDetail | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [regenerating, setRegenerating] = useState(false);

  const monthOptions = getMonthOptions();

  const fetchReports = async () => {
    try {
      const res = await api<{ items: Report[] }>("/api/reports");
      setReports(res.items);
    } catch {
      router.push("/login");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!getToken()) { router.push("/login"); return; }
    fetchReports();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleGenerate = async (period?: string) => {
    const p = period || selectedPeriod;
    setGenerating(true);
    try {
      const res = await api<{ message: string }>(`/api/reports/generate?period=${p}`, { method: "POST" });
      alert(res.message);
      fetchReports();
    } catch (e) {
      alert(e instanceof Error ? e.message : "生成失败");
    } finally {
      setGenerating(false);
    }
  };

  const handleRegenerate = async () => {
    if (!detail) return;
    setRegenerating(true);
    try {
      const res = await api<{ message: string; report_id: number }>(`/api/reports/generate?period=${detail.period}`, { method: "POST" });
      alert(res.message);
      // Reload the detail
      const updated = await api<ReportDetail>(`/api/reports/${res.report_id}`);
      setDetail(updated);
      fetchReports();
    } catch (e) {
      alert(e instanceof Error ? e.message : "重新生成失败");
    } finally {
      setRegenerating(false);
    }
  };

  const handleViewDetail = async (id: number) => {
    try {
      const res = await api<ReportDetail>(`/api/reports/${id}`);
      setDetail(res);
    } catch (e) {
      alert(e instanceof Error ? e.message : "获取失败");
    }
  };

  const renderRawData = (jsonStr: string) => {
    try {
      const data = JSON.parse(jsonStr);
      const { summary, breakdown } = data;
      return (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-4">
                <p className="text-sm text-muted-foreground">收入</p>
                <p className="text-xl font-bold text-green-500">¥{Number(summary.income).toLocaleString()}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-sm text-muted-foreground">支出</p>
                <p className="text-xl font-bold text-red-500">¥{Number(summary.expense).toLocaleString()}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-sm text-muted-foreground">交易笔数</p>
                <p className="text-xl font-bold">{summary.tx_count}</p>
              </CardContent>
            </Card>
          </div>
          <div>
            <h4 className="font-medium mb-2">分类明细</h4>
            <div className="space-y-1">
              {breakdown
                .filter((b: { direction: string }) => b.direction === "支出")
                .map((b: { category: string; total: number; count: number }, i: number) => (
                  <div key={i} className="flex items-center justify-between text-sm py-1 border-b last:border-0">
                    <span>{b.category}</span>
                    <div className="flex gap-4">
                      <span className="text-muted-foreground">{b.count} 笔</span>
                      <span className="font-medium">¥{Number(b.total).toLocaleString()}</span>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      );
    } catch {
      return <pre className="text-xs bg-muted p-3 rounded overflow-auto">{jsonStr}</pre>;
    }
  };

  if (detail) {
    return (
      <AppLayout title="分析报告">
        
        
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="sm" onClick={() => setDetail(null)}>← 返回</Button>
              <h2 className="text-xl font-bold">{detail.period} 月度报告</h2>
              <Badge variant={detail.status === "completed" ? "default" : "secondary"}>{detail.status}</Badge>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRegenerate}
              disabled={regenerating}
            >
              {regenerating ? "重新生成中..." : "🔄 重新生成"}
            </Button>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">数据概览</CardTitle>
            </CardHeader>
            <CardContent>
              {renderRawData(detail.raw_data_json)}
            </CardContent>
          </Card>

          {detail.ai_analysis ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">🤖 AI 分析</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown>{detail.ai_analysis}</ReactMarkdown>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                AI 分析尚未生成（状态：{detail.status}）
              </CardContent>
            </Card>
          )}
        </AppLayout>
    );
  }

  return (
    <AppLayout title="分析报告">
      
      
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold">财务报告</h2>
            <p className="text-sm text-muted-foreground mt-1">AI 驱动的月度财务分析</p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              {monthOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <Button onClick={() => handleGenerate()} disabled={generating}>
              {generating ? "生成中..." : "生成报告"}
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="grid gap-3">
            {[...Array(3)].map((_, i) => (
              <Card key={i}>
                <CardContent className="py-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Skeleton className="w-10 h-10 rounded" />
                      <div className="space-y-2">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-3 w-24" />
                      </div>
                    </div>
                    <Skeleton className="h-6 w-16 rounded-full" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : reports.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-4xl mb-4">📊</p>
              <p className="text-muted-foreground">还没有生成过报告</p>
              <p className="text-sm text-muted-foreground mt-1">选择月份并点击"生成报告"开始 AI 财务分析</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3">
            {reports.map((r) => (
              <Card key={r.id} className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => handleViewDetail(r.id)}>
                <CardContent className="py-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">📊</span>
                      <div>
                        <p className="font-medium">{r.period} 月度报告</p>
                        <p className="text-sm text-muted-foreground">{r.created_at}</p>
                      </div>
                    </div>
                    <Badge variant={r.status === "completed" ? "default" : r.status === "pending" ? "secondary" : "destructive"}>
                      {r.status === "completed" ? "已完成" : r.status === "pending" ? "处理中" : r.status}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </AppLayout>
  );
}
