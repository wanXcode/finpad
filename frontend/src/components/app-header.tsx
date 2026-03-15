"use client";

import { useRouter, usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { clearToken } from "@/lib/api";

const NAV_ITEMS = [
  { label: "总览", path: "/" },
  { label: "交易", path: "/transactions" },
  { label: "数据源", path: "/sources" },
  { label: "报告", path: "/reports" },
  { label: "设置", path: "/settings" },
];

export function AppHeader() {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
        <h1
          className="text-xl font-bold cursor-pointer select-none"
          onClick={() => router.push("/")}
        >
          FinPad
        </h1>
        <nav className="flex items-center gap-1">
          {NAV_ITEMS.map((item) => (
            <Button
              key={item.path}
              variant={pathname === item.path ? "default" : "ghost"}
              size="sm"
              onClick={() => router.push(item.path)}
            >
              {item.label}
            </Button>
          ))}
          <Separator orientation="vertical" className="h-6 mx-2" />
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              clearToken();
              router.push("/login");
            }}
          >
            退出
          </Button>
        </nav>
      </div>
    </header>
  );
}
