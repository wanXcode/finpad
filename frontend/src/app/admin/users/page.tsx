"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, getCurrentUser, getToken, type UserInfo } from "@/lib/api";
import { AppLayout } from "@/components/app-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  Shield,
  ShieldOff,
  KeyRound,
  UserCheck,
  UserX,
} from "lucide-react";

type AdminUser = {
  id: number;
  username: string;
  display_name: string;
  role: string;
  is_active: boolean;
  created_at: string;
  tx_count: number;
};

export default function AdminUsersPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<UserInfo | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);

  // Password reset dialog
  const [resetUserId, setResetUserId] = useState<number | null>(null);
  const [resetUsername, setResetUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");

  // Confirm dialog
  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    description: string;
    onConfirm: () => void;
  } | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadData = async () => {
    try {
      const user = await getCurrentUser();
      setCurrentUser(user);
      if (user.role !== "admin") {
        toast.error("无权限访问");
        router.push("/");
        return;
      }
      const res = await api<{ items: AdminUser[] }>("/api/admin/users");
      setUsers(res.items);
    } catch {
      router.push("/login");
    } finally {
      setLoading(false);
    }
  };

  const handleToggleRole = (user: AdminUser) => {
    const newRole = user.role === "admin" ? "user" : "admin";
    const actionLabel =
      newRole === "admin" ? "提升为管理员" : "降级为普通用户";
    setConfirmAction({
      title: `${actionLabel}`,
      description: `确定将用户 "${user.username}" ${actionLabel}？`,
      onConfirm: async () => {
        try {
          await api(`/api/admin/users/${user.id}`, {
            method: "PATCH",
            body: { role: newRole },
          });
          toast.success(`已将 ${user.username} ${actionLabel}`);
          loadData();
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "操作失败");
        }
        setConfirmAction(null);
      },
    });
  };

  const handleToggleActive = (user: AdminUser) => {
    const newActive = !user.is_active;
    const actionLabel = newActive ? "启用" : "停用";
    setConfirmAction({
      title: `${actionLabel}账户`,
      description: `确定${actionLabel}用户 "${user.username}" 的账户？${
        !newActive ? "停用后该用户将无法登录。" : ""
      }`,
      onConfirm: async () => {
        try {
          await api(`/api/admin/users/${user.id}`, {
            method: "PATCH",
            body: { is_active: newActive },
          });
          toast.success(`已${actionLabel}用户 ${user.username}`);
          loadData();
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "操作失败");
        }
        setConfirmAction(null);
      },
    });
  };

  const handleResetPassword = async () => {
    if (!resetUserId || newPassword.length < 8) {
      toast.error("密码长度至少8位");
      return;
    }
    try {
      await api(`/api/admin/users/${resetUserId}`, {
        method: "PATCH",
        body: { new_password: newPassword },
      });
      toast.success(`已重置 ${resetUsername} 的密码`);
      setResetUserId(null);
      setNewPassword("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "操作失败");
    }
  };

  if (loading) {
    return (
      <AppLayout title="用户管理">
        <h2 className="text-xl font-bold mb-4">用户管理</h2>
        <Card>
          <CardContent className="space-y-3 pt-6">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="用户管理">
      <h2 className="text-xl font-bold mb-4">用户管理</h2>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            所有用户 ({users.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">ID</TableHead>
                <TableHead>用户名</TableHead>
                <TableHead>显示名</TableHead>
                <TableHead>角色</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>注册时间</TableHead>
                <TableHead className="text-right">交易笔数</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="font-mono text-xs">
                    {user.id}
                  </TableCell>
                  <TableCell className="font-medium">
                    {user.username}
                  </TableCell>
                  <TableCell>{user.display_name}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        user.role === "admin" ? "default" : "secondary"
                      }
                    >
                      {user.role === "admin" ? "管理员" : "用户"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={user.is_active ? "outline" : "destructive"}
                      className={
                        user.is_active
                          ? "border-green-500 text-green-600"
                          : ""
                      }
                    >
                      {user.is_active ? "正常" : "已停用"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {user.created_at
                      ? new Date(user.created_at).toLocaleDateString("zh-CN")
                      : "-"}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {user.tx_count}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {/* Toggle role */}
                      {user.id !== currentUser?.id && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          title={
                            user.role === "admin"
                              ? "降级为用户"
                              : "提升为管理员"
                          }
                          onClick={() => handleToggleRole(user)}
                        >
                          {user.role === "admin" ? (
                            <ShieldOff className="h-4 w-4" />
                          ) : (
                            <Shield className="h-4 w-4" />
                          )}
                        </Button>
                      )}

                      {/* Reset password */}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title="重置密码"
                        onClick={() => {
                          setResetUserId(user.id);
                          setResetUsername(user.username);
                          setNewPassword("");
                        }}
                      >
                        <KeyRound className="h-4 w-4" />
                      </Button>

                      {/* Toggle active */}
                      {user.id !== currentUser?.id && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          title={user.is_active ? "停用" : "启用"}
                          onClick={() => handleToggleActive(user)}
                        >
                          {user.is_active ? (
                            <UserX className="h-4 w-4 text-destructive" />
                          ) : (
                            <UserCheck className="h-4 w-4 text-green-600" />
                          )}
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Reset password dialog */}
      <Dialog
        open={resetUserId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setResetUserId(null);
            setNewPassword("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重置密码</DialogTitle>
            <DialogDescription>
              为用户 &ldquo;{resetUsername}&rdquo; 设置新密码
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>新密码</Label>
            <Input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="至少8位"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setResetUserId(null);
                setNewPassword("");
              }}
            >
              取消
            </Button>
            <Button
              onClick={handleResetPassword}
              disabled={newPassword.length < 8}
            >
              确认重置
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm action dialog */}
      <Dialog
        open={confirmAction !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirmAction?.title}</DialogTitle>
            <DialogDescription>
              {confirmAction?.description}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmAction(null)}>
              取消
            </Button>
            <Button onClick={confirmAction?.onConfirm}>确认</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
