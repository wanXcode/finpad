# FinPad

个人财务控制台 — 自托管、多用户、数据加密、AI 分析

## ✨ Features

- **多用户系统** — 注册、登录、角色权限（admin / user）
- **交易管理** — 手动录入、CSV 导入、批量操作、分类筛选
- **数据仪表盘** — 收支概览、分类饼图、趋势分析
- **预算管理** — 按分类设置月度预算，实时追踪
- **数据源管理** — 多账户管理（银行卡、支付宝、微信等）
- **Admin 管理面板** — 用户管理、角色分配、账户启停
- **数据库加密** — SQLCipher 加密存储，防止数据泄露
- **暗色模式** — 亮/暗/跟随系统三档切换
- **AI 智能分类** — 基于 LLM 的交易自动分类（可选）

## 🚀 Quick Start

### Docker Compose（推荐）

```bash
git clone https://github.com/wanXcode/finpad.git
cd finpad
cp .env.example .env  # 编辑环境变量
docker compose up -d --build
```

访问 http://localhost:3000

### 本地开发

**Backend:**

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

API docs: http://localhost:8000/api/docs

**Frontend:**

```bash
cd frontend
npm install
npm run dev
```

Web UI: http://localhost:3000

## 🔑 Default Login

- Username: `admin`
- Password: `finpad2026`

> ⚠️ 首次部署后请立即修改默认密码。

## ⚙️ Environment Variables

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `SECRET_KEY` | `change-me-in-production` | JWT 签名密钥 |
| `DEFAULT_USERNAME` | `admin` | 默认管理员用户名 |
| `DEFAULT_PASSWORD` | `finpad2026` | 默认管理员密码 |
| `ALLOW_REGISTRATION` | `true` | 是否开放用户注册 |
| `DB_ENCRYPTION_KEY` | _(空)_ | 数据库加密密钥，空值=不加密 |
| `AI_API_BASE` | `https://api.openai.com/v1` | AI API 地址 |
| `AI_API_KEY` | _(空)_ | AI API Key |
| `AI_MODEL` | `gpt-4o` | AI 模型名称 |

## 🔐 Database Encryption

FinPad 支持 SQLCipher 数据库加密，加密后即使数据库文件被拷走也无法读取。

**加密现有数据库：**

```bash
# 进入后端容器
docker exec -it finpad-api bash

# 运行迁移脚本
python scripts/encrypt_db.py <your-encryption-key>

# 退出容器，在 .env 中设置密钥
echo 'DB_ENCRYPTION_KEY=<your-encryption-key>' >> .env

# 重启服务
docker compose down && docker compose up -d
```

原始明文数据库会备份为 `data/finpad.db.bak.plain`。

**新部署直接启用加密：**

在 `.env` 中设置 `DB_ENCRYPTION_KEY=<your-key>`，首次启动时自动创建加密数据库。

## 🏗️ Tech Stack

| 层 | 技术 |
|----|------|
| Frontend | Next.js 14 + Tailwind CSS + shadcn/ui |
| Backend | Python FastAPI |
| Database | SQLite (WAL) + SQLCipher |
| Deployment | Docker Compose + Nginx |

## 📁 Project Structure

```
finpad/
├── backend/
│   ├── app/
│   │   ├── routers/        # API 路由（auth, transactions, admin...）
│   │   ├── auth.py          # 认证模块
│   │   ├── config.py        # 配置管理
│   │   └── database.py      # 数据库连接 + SQLCipher
│   ├── scripts/
│   │   └── encrypt_db.py    # 数据库加密迁移脚本
│   └── main.py
├── frontend/
│   └── src/
│       ├── app/             # 页面（login, register, admin, settings...）
│       ├── components/      # UI 组件
│       └── lib/             # API 客户端
├── deploy/
│   └── nginx.conf           # Nginx 配置模板
├── docker-compose.yml
└── docs/                    # PRD 文档
```

## License

MIT
