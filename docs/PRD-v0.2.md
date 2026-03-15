# FinPad v0.2 需求文档 — 从能用到好用

> **版本**: v0.2 | **基线**: v0.1.0（已上线 fin.5666.net） | **目标**: 数据流畅导入 + UI 品质提升 + 核心功能补齐
> **飞书文档**: https://www.feishu.cn/docx/Yf4HdVAIgo2o60xBHB2cq40hnTy

## 一、版本目标

v0.1 完成了"能跑通"，v0.2 的目标是**让产品真正能日常使用**。聚焦三件事：

1. **数据进得来** — 手动 CSV 导入，不依赖邮箱
2. **看得舒服** — UI 从"开发者原型"升级到"产品级界面"
3. **用得顺手** — 筛选、批量操作、预算等核心交互补齐

---

## 二、UI 升级方案

### 2.1 现状问题

**v0.1 UI 问题清单：**
- 页面布局过于稀疏，信息密度低
- 缺少侧边导航栏，顶部导航不够直观
- 表格样式简陋，缺少悬停态、斑马纹
- 颜色体系不统一，缺少品牌感
- 空状态页面只显示"暂无数据"，没有引导
- 移动端完全没适配

**v0.2 UI 升级目标：**
- 采用左侧边栏 + 右侧内容区经典布局
- 统一色彩体系（主色、语义色、中性色）
- 所有列表/表格增加微交互（hover、选中态）
- 空状态配插图 + 行动引导
- 卡片化信息展示，提升信息层级
- 基础响应式支持（平板 + 手机）

### 2.2 技术方案

| 组件 | 方案 | 说明 |
|------|------|------|
| 组件库 | shadcn/ui（保持） | 扩展：Select、Popover、Calendar、Progress、Skeleton、Tooltip、Command、Checkbox |
| 图表库 | Recharts（保持） | 增加多月趋势折线图、分类环比柱状图 |
| 图标库 | Lucide React（保持） | 统一图标风格 |
| 日期选择 | shadcn Calendar + date-fns | 日期范围筛选器 |
| 表格增强 | @tanstack/react-table | 排序、多选、列可见性、虚拟滚动 |
| Toast | Sonner（已有） | 操作反馈统一 |
| 文件上传 | react-dropzone | 拖拽上传 CSV/Excel |

### 2.3 布局改造

v0.1：顶部导航栏 → 页面内容区
v0.2：左侧边栏（Logo + 导航 + 用户） → 右侧内容区（面包屑 + 页面）

**侧边栏导航项：**
- 📊 Dashboard（首页）
- 💳 交易记录
- 📥 数据导入（新增）
- 💰 预算管理（新增）
- 📈 分析报告
- ⚙️ 设置

---

## 三、功能需求

### P0 — 核心功能（必须完成）

#### 3.1 手动 CSV/Excel 导入

**目标**：用户可直接上传从支付宝/微信导出的 CSV 或 Excel 文件，系统自动识别平台并解析入库。

**前端交互：**
1. 新增 `/import` 页面
2. 拖拽上传区域（支持 .csv、.xlsx 文件）
3. 上传后展示预览表格（前 10 行）
4. 自动识别平台类型，用户可手动修正
5. 确认导入 → 显示导入结果（新增/跳过/失败数量）
6. 导入历史记录列表

**后端 API：**
- POST `/api/import/upload` — 上传文件，返回预览 + 识别结果
- POST `/api/import/confirm` — 确认导入，执行解析入库
- GET `/api/import/history` — 导入历史列表

**平台识别逻辑：**
- 支付宝 CSV：检测表头包含"交易号"、"商家订单号"
- 微信 Excel：检测表头包含"微信支付账单"
- 招行 PDF：检测文件名或内容关键词
- 工行 PDF：同上

**数据库变更：**
```sql
CREATE TABLE import_logs (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL DEFAULT 1,
    filename TEXT NOT NULL,
    platform TEXT,
    file_size INTEGER,
    total_records INTEGER DEFAULT 0,
    created_records INTEGER DEFAULT 0,
    skipped_records INTEGER DEFAULT 0,
    failed_records INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    error_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);
```

#### 3.2 交易列表增强

**筛选增强：**
- 日期范围：快捷按钮（今天/本周/本月/近3月）+ 自定义范围
- 分类筛选：下拉多选（18 个分类）+ 搜索
- 金额范围：最小/最大 + 快捷选项（<100 / 100-500 / 500-1000 / >1000）

**批量操作：**
- 表格行前复选框
- 顶部：全选 / 批量改分类 / 批量删除
- 确认弹窗防误操作

**侧边栏详情（Sheet 抽屉）：**
- 点击行 → 右侧滑出详情面板
- 可直接编辑分类和备注
- 保存后自动刷新列表

**后端变更：**
- GET `/api/transactions` 增加 date_from、date_to、category、amount_min、amount_max
- PATCH `/api/transactions/batch` — 批量更新
- DELETE `/api/transactions/batch` — 批量删除

#### 3.3 Dashboard 空状态 + 数据增强

**空状态引导：**
- 无数据时引导卡片："还没有账单数据"
- 行动按钮：「导入 CSV」「配置邮箱同步」

**数据增强：**
- 本月 vs 上月对比百分比标签
- 最近 6 个月收支趋势折线图
- 分类饼图 hover 显示金额和笔数
- 最近交易可点击跳转详情

### P1 — 体验提升

#### 3.4 预算管理

- 新增 `/budget` 页面
- 按分类设月度预算
- Dashboard 增加预算进度卡片（进度条 + 百分比）
- 超支高亮警告
- 历史月份执行情况

```sql
CREATE TABLE budgets (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL DEFAULT 1,
    category TEXT NOT NULL,
    monthly_amount REAL NOT NULL,
    enabled BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, category),
    FOREIGN KEY (user_id) REFERENCES users(id)
);
```

#### 3.5 分类规则引擎

- 修正分类后提示"应用到同类交易？"
- 规则管理页面
- 规则优先级：自定义 > 系统默认

```sql
CREATE TABLE category_rules (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL DEFAULT 1,
    match_type TEXT NOT NULL,
    match_value TEXT NOT NULL,
    target_category TEXT NOT NULL,
    priority INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);
```

#### 3.6 趋势图表增强

- 默认 6 个月收支趋势（可切换 3/6/12）
- 分类支出环比柱状图
- 报告页增加可视化图表

### P2 — 锦上添花

- 3.7 数据导出（CSV / Excel / PDF）
- 3.8 多账户资产看板
- 3.9 移动端基础适配
- 3.10 同步状态可视化

---

## 四、UI 设计规范

### 色彩体系
- 主色：#2563EB（蓝）— 按钮、选中态、链接
- 收入色：#16A34A（绿）— 收入金额、正向趋势
- 支出色：#DC2626（红）— 支出金额、超支、删除
- 警告色：#F59E0B（琥珀）— 预算接近、同步异常
- 中性色：Slate 色阶

### 间距和字号
- 页面外边距：px-6 py-6（桌面）/ px-4 py-4（移动）
- 卡片间距：gap-4（紧凑）/ gap-6（宽松）
- 正文：text-sm（14px）
- 标题：text-lg/text-xl
- 金额：text-2xl font-bold（大额）/ text-base font-medium（列表）

### 交互规范
- 所有可点击元素有 hover 态
- 表格行 hover 高亮
- 破坏性操作需二次确认
- 异步操作有 loading + toast
- 数据加载显示 Skeleton

---

## 五、页面结构（v0.2）

```
/login           # 登录页
/                # Dashboard（增强版）
/transactions    # 交易列表（筛选 + 批量 + 侧边栏）
/import          # 数据导入（新增 ⭐）
/budget          # 预算管理（新增 ⭐）
/reports         # 分析报告
/settings        # 设置
```

---

## 六、技术依赖新增

| 包名 | 用途 | 阶段 |
|------|------|------|
| @tanstack/react-table | 高级表格 | P0-C |
| react-dropzone | 拖拽上传 | P0-B |
| date-fns | 日期工具 | P0-C |
| react-day-picker | Calendar 依赖 | P0-C |
| python-multipart | 文件上传 | P0-B |
| openpyxl | 读取 Excel | P0-B |

---

## 七、开发计划

| 阶段 | 内容 | 优先级 | 预估 |
|------|------|--------|------|
| P0-A | UI 架构升级：侧边栏 + 组件扩展 + 色彩 + 骨架屏 | 🔴 P0 | 1 session |
| P0-B | 手动 CSV 导入：上传 + 预览 + 确认 + 历史 | 🔴 P0 | 1 session |
| P0-C | 交易列表增强：筛选 + 批量 + 侧边栏 | 🔴 P0 | 1 session |
| P0-D | Dashboard 增强：空状态 + 6月趋势 + 对比 | 🔴 P0 | 1 session |
| P1-A | 预算管理 | 🟡 P1 | 1 session |
| P1-B | 分类规则 + 图表增强 | 🟡 P1 | 1 session |
| P2 | 导出 + 资产看板 + 移动端 + 同步可视化 | 🟢 P2 | 1-2 sessions |
| QA | 回归测试 + 部署 | — | 1 session |

---

## 八、验收标准

1. 用户可上传支付宝/微信 CSV → 一键入库
2. 交易列表支持日期、分类、金额三维筛选
3. 可批量选中交易并修改分类
4. Dashboard 有数据展示 6 月趋势，无数据展示导入引导
5. 预算设置后 Dashboard 显示执行进度
6. UI 为侧边栏布局，视觉一致性达到产品级
7. 所有操作有 loading 态和 toast 反馈
