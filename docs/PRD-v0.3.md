# FinPad v0.3 PRD — 多用户系统

## 背景

v0.2 schema 预留了 `user_id` 字段，所有数据表都有用户隔离查询，`get_current_user` 认证链路完整。但缺少注册入口、角色权限、用户管理后台、个人资料编辑。

## 功能模块

### P0-A 注册与登录增强

| 功能 | 说明 |
|------|------|
| 注册页面 `/register` | 用户名 + 密码 + 显示名，密码强度校验（≥8位） |
| 后端 `POST /api/auth/register` | 创建用户，返回 token 直接登录 |
| 注册开关 | `ALLOW_REGISTRATION=true/false` 环境变量控制，关闭时注册页展示"暂不开放注册" |
| 登录页增加"注册"链接 | 条件显示（仅开放注册时） |
| Token 有效期 | 保持 24h，登录态前端 auto-refresh（token 剩余 <2h 时静默刷新） |

### P0-B 角色权限

| 功能 | 说明 |
|------|------|
| users 表新增 `role` 字段 | `admin` / `user`，默认 `user`，初始 admin 用户为 `admin` |
| `get_current_user` 返回 role | 所有路由可用 `user["role"]` 判断权限 |
| 权限装饰器 `require_admin` | 仅 admin 可调用的端点用此装饰 |
| 数据隔离不变 | 普通用户只看到自己的数据，admin 看到自己的（不看全局，除管理页面外） |

### P0-C 管理后台

| 功能 | 说明 |
|------|------|
| `/admin/users` 页面 | 用户列表：ID、用户名、显示名、角色、注册时间、交易笔数 |
| 管理操作 | 改角色（admin↔user）、重置密码、禁用/启用账户 |
| users 表新增 `is_active` | 默认 true，禁用后登录返回"账户已停用" |
| 侧边栏条件渲染 | 仅 admin 角色显示"管理"入口 |
| 后端 `GET /api/admin/users` | 管理员专用接口，返回用户列表+统计 |
| 后端 `PATCH /api/admin/users/{id}` | 改角色、重置密码、启停用 |

### P1-A 个人资料

| 功能 | 说明 |
|------|------|
| 设置页增加"个人资料"tab | 修改显示名、修改密码（已有改密接口复用） |
| 头像 | 暂不做，显示首字母 avatar（已有 shadcn Avatar 组件） |

## 数据库变更

```sql
-- users 表新增字段
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user';
ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;

-- 迁移：将现有 admin 用户角色设为 admin
UPDATE users SET role = 'admin' WHERE username = 'admin';
```

## 安全要求

1. 注册接口限流：同 IP 每分钟最多 5 次
2. 密码 bcrypt hash，不变
3. 禁用用户的已有 token 立即失效（`get_current_user` 检查 `is_active`）
4. admin 不可降级自己（防止无 admin 状态）
5. `tx_id` 唯一键改为 `(user_id, tx_id)` 联合唯一 — 不同用户可以有相同 tx_id

## 前端路由守卫

| 路径 | 权限 |
|------|------|
| `/login`, `/register` | 未登录可访问，已登录跳转首页 |
| `/admin/*` | 仅 admin，非 admin 跳转首页 |
| 其他所有页面 | 需登录 |

## 环境变量新增

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `ALLOW_REGISTRATION` | `true` | 是否开放注册 |

## 开发优先级

1. **P0-A + P0-B** 一起做（注册 + 角色，底层改动，互相依赖）
2. **P0-C** 管理后台（依赖 P0-B 角色系统）
3. **P1-A** 个人资料（收尾）
