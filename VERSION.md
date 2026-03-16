# FinPad Version History

## v0.3.0 — 2026-03-16

### Multi-User System & Database Encryption

**新功能**
- 用户注册与登录（支持 `ALLOW_REGISTRATION` 开关）
- 角色权限系统（admin / user）
- Admin 用户管理面板（角色分配、账户启停、密码重置）
- Admin 自保护（不能降级/停用自己）
- 用户数据隔离（不同用户数据互不可见）
- 个人设置页（修改显示名、修改密码）
- Token 自动刷新机制
- SQLCipher 数据库加密（`DB_ENCRYPTION_KEY` 环境变量控制）
- 加密迁移脚本 `scripts/encrypt_db.py`

**改进**
- 登录页展示服务端实际错误信息（如"账户已停用"）
- 改密表单增加确认密码字段 + 客户端长度校验
- 改密成功/失败消息区分颜色
- `TransactionCreate` 支持可选 `tx_id` 字段
- `/me` 接口 `is_active` 统一返回布尔值
- 清理所有 `__import__` hack，替换为正常 import

**数据库变更**
- `users` 表新增 `role`（默认 `user`）、`is_active`（默认 `1`）列
- `transactions` 表唯一约束从 `tx_id UNIQUE` 改为 `UNIQUE(user_id, tx_id)`

---

## v0.2.0 — 2026-03-16

### UI Upgrade & Feature Enhancement

**新功能**
- CSV 文件导入（支付宝、微信、银行对账单）
- 交易列表增强：分类筛选、批量编辑/删除、侧边栏详情
- 数据仪表盘：收支概览卡片、分类饼图、趋势折线图
- 预算管理：按分类设置月度预算、进度追踪

**UI 升级**
- 品牌色从黑灰改为 #2563EB 蓝色体系
- 暗色模式（亮/暗/系统三档）
- 表格斑马纹 + hover 交互
- 空状态增强（图标 + 引导文案）
- Skeleton 加载态
- 面包屑导航

**技术债清理**
- 批量 API（`PATCH/DELETE /api/transactions/batch`）
- 原生 `<select>` → shadcn Select
- `alert()` → sonner toast
- IMAP 同步错误返回结构化 JSON

---

## v0.1.0 — 2026-03-15

### Initial Release

- 交易 CRUD + 分页
- 数据源管理（银行账户）
- 分类管理
- 设置页面
- AI 智能分类（可选）
- Docker Compose 部署
- 默认 admin 账户
