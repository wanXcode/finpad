# FinPad — 个人财务控制台 PRD v1.0

## 1. 产品概述

**FinPad** 是一个自托管的个人财务管理系统，提供 Web 控制台，支持自动采集多平台账单、可视化分析和资产管理。

- **定位**：个人财务的统一控制台
- **部署方式**：私有服务器自托管，数据完全自主
- **技术架构**：前后端分离 + API 驱动，为多端扩展预留
- **目标用户**：先做单用户版，schema 预留多用户

---

## 2. 技术选型

| 层 | 选型 | 说明 |
|---|---|---|
| 前端 | Next.js 14 + Tailwind CSS + shadcn/ui | Notion 简洁风，亮暗自动切换 |
| 后端 | Python FastAPI | 复用现有账单同步逻辑 |
| 数据库 | SQLite（WAL 模式） | 轻量，单用户足够，后续可迁移 PostgreSQL |
| 认证 | 用户名 + 密码 + JWT | 简单可靠 |
| 部署 | Docker Compose（x2 服务器） | 前后端 + Nginx 一键部署 |

---

## 3. 数据分类体系（重新设计）

### 3.1 统一消费分类（一级）

基于现有 330 条账目数据的分布重新设计，覆盖所有平台的原始分类映射：

| 分类 | 说明 | 映射来源举例 |
|---|---|---|
| 🍜 餐饮 | 吃饭、外卖、饮品 | 餐饮美食 |
| 🚗 交通 | 打车、公交、地铁、加油 | 交通出行 |
| 🛒 购物 | 日用品、服饰、数码 | 日用百货、商户消费、服饰装扮 |
| 🏠 居住 | 房租、水电、物业 | 充值缴费、家居家装 |
| 🎮 娱乐 | 游戏、影音、休闲 | 文化休闲、运动户外 |
| 🏥 医疗 | 看病、药品、保险 | 保险代扣 |
| 📚 教育 | 书籍、课程、培训 | 教育培训 |
| 🚀 旅行 | 机票、酒店、景点 | 酒店旅游 |
| 👶 亲子 | 母婴用品、教育 | 母婴亲子 |
| 🚙 汽车 | 保养、维修、停车 | 爱车养车 |
| 💰 转账 | 转账给他人（非消费） | 转账、网转 |
| 🧧 红包 | 微信红包收发 | 微信红包、群红包 |
| 📈 理财 | 基金、股票、定期 | 投资理财 |
| 💳 信用 | 信用卡还款、借还款 | 信用借还 |
| 🔄 内转 | 自己账户间转账 | 零钱通转出、转入零钱通 |
| 🔙 退款 | 退款退货 | 退款 |
| 📋 服务 | 手续费、公共服务 | 生活服务、公共服务、信使展期 |
| ❓ 其他 | 无法归类 | 其他、扫二维码付款 |

### 3.2 收支方向

| 方向 | 说明 |
|---|---|
| 支出 | 花钱 |
| 收入 | 进账 |
| 内转 | 自己账户间流转（不影响总资产） |
| 不计 | 不计入收支统计 |

### 3.3 账户体系

| 账户类型 | 具体账户 |
|---|---|
| 支付宝 | 余额、余额宝 |
| 微信 | 零钱、零钱通 |
| 银行储蓄 | 招行(6666)、工行(1838) |
| 银行信用 | 招行信用卡(3756) |

### 3.4 分类映射规则

系统维护一张 `原始分类 → 统一分类` 的映射表，用户可在控制台自定义修改。当遇到未知分类时，默认归入"其他"并提示用户手动归类。

---

## 4. 数据库 Schema

### 4.1 用户表 (users)
```sql
CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 4.2 交易表 (transactions)
```sql
CREATE TABLE transactions (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL DEFAULT 1,
    tx_id TEXT UNIQUE NOT NULL,          -- 幂等键
    tx_time DATETIME NOT NULL,           -- 交易时间
    platform TEXT NOT NULL,              -- 支付宝/微信/招行/工行
    account TEXT,                        -- 具体账户（余额宝、零钱等）
    direction TEXT NOT NULL,             -- 支出/收入/内转/不计
    amount REAL NOT NULL,                -- 金额
    category TEXT NOT NULL DEFAULT '其他', -- 统一分类
    original_category TEXT,              -- 原始分类（平台原始值）
    counterparty TEXT,                   -- 交易对方
    note TEXT,                           -- 备注
    source TEXT,                         -- 数据来源（email_auto/manual_upload/api）
    ingest_batch TEXT,                   -- 批次号
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);
```

### 4.3 账户表 (accounts)
```sql
CREATE TABLE accounts (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL DEFAULT 1,
    name TEXT NOT NULL,                  -- 显示名
    platform TEXT NOT NULL,              -- 平台
    account_type TEXT NOT NULL,          -- checking/savings/credit/ewallet
    balance REAL DEFAULT 0,              -- 当前余额
    currency TEXT DEFAULT 'CNY',
    last_synced_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);
```

### 4.4 数据源配置表 (data_sources)
```sql
CREATE TABLE data_sources (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL DEFAULT 1,
    name TEXT NOT NULL,                  -- 显示名
    type TEXT NOT NULL,                  -- email_imap/manual_upload
    platform TEXT NOT NULL,              -- alipay/wechat/cmb/icbc
    config_json TEXT,                    -- 加密存储的配置（邮箱、密码等）
    sync_interval_minutes INTEGER DEFAULT 10,
    enabled BOOLEAN DEFAULT 1,
    last_sync_at DATETIME,
    last_sync_status TEXT,               -- success/error
    last_sync_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);
```

### 4.5 同步日志表 (sync_logs)
```sql
CREATE TABLE sync_logs (
    id INTEGER PRIMARY KEY,
    data_source_id INTEGER NOT NULL,
    started_at DATETIME NOT NULL,
    finished_at DATETIME,
    status TEXT NOT NULL,                -- running/success/error
    records_total INTEGER DEFAULT 0,
    records_created INTEGER DEFAULT 0,
    records_skipped INTEGER DEFAULT 0,
    error_message TEXT,
    FOREIGN KEY (data_source_id) REFERENCES data_sources(id)
);
```

### 4.6 分类映射表 (category_mappings)
```sql
CREATE TABLE category_mappings (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL DEFAULT 1,
    platform TEXT NOT NULL,
    original_category TEXT NOT NULL,
    mapped_category TEXT NOT NULL,
    UNIQUE(user_id, platform, original_category),
    FOREIGN KEY (user_id) REFERENCES users(id)
);
```

---

## 5. MVP 功能清单

### 5.1 第一版（MVP）

1. **登录页**
   - 用户名密码登录
   - JWT token 管理

2. **Dashboard 首页**
   - 总资产卡片
   - 本月收入/支出/净结余 KPI
   - 收支趋势折线图（近 6 个月）
   - 分类占比饼图（本月支出）
   - 最近 10 笔交易

3. **交易列表**
   - 表格展示（时间、平台、方向、金额、分类、对方、备注）
   - 搜索（关键词、时间范围、金额范围）
   - 筛选（平台、方向、分类）
   - 单条编辑（修改分类、备注）

4. **数据源配置**
   - 添加/编辑/删除数据源
   - 邮箱 IMAP 配置（支付宝/微信/招行/工行）
   - 启用/禁用开关
   - 同步频率设置

5. **同步管理**
   - 各数据源状态一览
   - 手动触发同步
   - 同步日志查看

6. **设置**
   - 分类映射管理
   - 账户管理
   - 修改密码

### 5.2 第二版（规划）

- 预算管理
- 多币种支持
- 报表导出（PDF/Excel）
- 股票/基金账户
- PWA 移动端
- Tauri 桌面版

---

## 6. API 设计（RESTful）

```
POST   /api/auth/login           # 登录
POST   /api/auth/logout          # 登出
GET    /api/auth/me              # 当前用户信息

GET    /api/dashboard/summary    # 总览数据
GET    /api/dashboard/trend      # 趋势数据
GET    /api/dashboard/category   # 分类数据

GET    /api/transactions         # 交易列表（分页、筛选）
GET    /api/transactions/:id     # 交易详情
PATCH  /api/transactions/:id     # 更新交易
DELETE /api/transactions/:id     # 删除交易

GET    /api/accounts             # 账户列表
POST   /api/accounts             # 添加账户
PATCH  /api/accounts/:id         # 更新账户
DELETE /api/accounts/:id         # 删除账户

GET    /api/sources              # 数据源列表
POST   /api/sources              # 添加数据源
PATCH  /api/sources/:id          # 更新数据源
DELETE /api/sources/:id          # 删除数据源
POST   /api/sources/:id/sync     # 手动触发同步

GET    /api/sync-logs            # 同步日志
GET    /api/sync-logs/:id        # 日志详情

GET    /api/categories           # 分类列表
GET    /api/category-mappings    # 映射规则
POST   /api/category-mappings    # 添加映射
PATCH  /api/category-mappings/:id # 更新映射
```

---

## 7. 页面结构

```
/login                 # 登录页
/                      # Dashboard 首页
/transactions          # 交易列表
/accounts              # 账户管理
/sources               # 数据源配置
/sources/:id/logs      # 同步日志
/settings              # 设置（分类映射、密码等）
```

---

## 8. 部署方案

- **服务器**：x2 (`43.134.109.206`)
- **域名**：待定（finpad.xxx）
- **架构**：Docker Compose
  - `finpad-api`：FastAPI 后端（端口 8000）
  - `finpad-web`：Next.js 前端（端口 3000）
  - Nginx 反代 + HTTPS（Let's Encrypt）
- **数据持久化**：SQLite 文件挂载到宿主机 volume

---

## 9. 开发计划

| 阶段 | 内容 | 预估 |
|------|------|------|
| P0 | 项目骨架 + DB + Auth API | 1 session |
| P1 | Dashboard API + 前端首页 | 1-2 sessions |
| P2 | 交易列表（前后端） | 1 session |
| P3 | 数据源配置 + 同步引擎 | 1-2 sessions |
| P4 | 设置页 + 分类映射 | 1 session |
| P5 | 部署上线 | 1 session |
