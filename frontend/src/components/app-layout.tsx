"use client";

import { useRouter, usePathname } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Menu, ChevronRight } from "lucide-react";
import { useState, useEffect } from "react";

interface AppLayoutProps {
  children: React.ReactNode;
  title?: string;
  actions?: React.ReactNode;
}

export function AppLayout({ children, title, actions }: AppLayoutProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (mobile) setSidebarOpen(false);
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Close sidebar on navigation for mobile
  useEffect(() => {
    if (isMobile) setSidebarOpen(false);
  }, [pathname, isMobile]);

  const handleLogout = () => {
    localStorage.removeItem("token");
    router.push("/login");
  };

  const isDashboard = !title || title === "Dashboard";

  return (
    <div className="flex min-h-screen bg-background">
      {/* Mobile overlay */}
      {isMobile && sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div
        className={
          isMobile
            ? `fixed inset-y-0 left-0 z-50 transition-transform duration-200 ${
                sidebarOpen ? "translate-x-0" : "-translate-x-full"
              }`
            : ""
        }
      >
        {(sidebarOpen || !isMobile) && (
          <AppSidebar onLogout={handleLogout} />
        )}
      </div>

      {/* Main content */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="flex items-center gap-4 border-b bg-card/50 backdrop-blur-sm px-6 h-14 sticky top-0 z-30">
          {isMobile && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              <Menu className="w-5 h-5" />
            </Button>
          )}
          {/* Breadcrumb - desktop only */}
          {!isMobile && (
            <div className="flex items-center gap-1.5">
              <span className="text-sm text-muted-foreground">FinPad</span>
              {!isDashboard && title && (
                <>
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-sm font-medium">{title}</span>
                </>
              )}
            </div>
          )}
          {/* Mobile title */}
          {isMobile && title && (
            <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
          )}
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            {actions}
          </div>
        </header>

        {/* Page content */}
        <div className="flex-1 p-6">{children}</div>
      </main>
    </div>
  );
}
