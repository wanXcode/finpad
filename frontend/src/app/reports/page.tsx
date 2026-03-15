"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, getToken } from "@/lib/api";
import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import ReactMarkdown from "react-markdown";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

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

export default function ReportsPage() {
  const router = useRouter();
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [detail, setDetail] = useState<ReportDetail | null>(null);

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

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await api<{ message: string }>("/api/reports/generate", { method: "POST" });
      alert(res.message);
      fetchReports();
    } catch (e) {
      alert(e instanceof Error ? e.message : "生成失败");
    } finally {
      setGenerating(false);
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
      <div className="min-h-screen bg-background">
        <AppHeader />
        <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => setDetail(null)}>← 返回</Button>
            <h2 className="text-xl font-bold">{detail.period} 月度报告</h2>
            <Badge variant={detail.status === "completed" ? "default" : "secondary"}>{detail.status}</Badge>
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
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold">财务报告</h2>
            <p className="text-sm text-muted-foreground mt-1">AI 驱动的月度财务分析</p>
          </div>
          <Button onClick={handleGenerate} disabled={generating}>
            {generating ? "生成中..." : "生成本月报告"}
          </Button>
        </div>

        {loading ? (
          <p className="text-muted-foreground text-center py-12">加载中...</p>
        ) : reports.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-4xl mb-4">📊</p>
              <p className="text-muted-foreground">还没有生成过报告</p>
              <p className="text-sm text-muted-foreground mt-1">点击"生成本月报告"开始第一份 AI 财务分析</p>
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
      </main>
    </div>
  );
}
