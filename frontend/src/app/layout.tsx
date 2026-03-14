import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FinPad — 个人财务控制台",
  description: "自托管的个人财务管理系统",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
