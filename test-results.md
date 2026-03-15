# FinPad API 测试结果

**测试时间**: 2026-03-15 06:31 UTC  
**后端地址**: http://localhost:8000  
**测试账号**: admin / finpad2026

---

## 测试清单

### 🔧 基础 & 认证

| # | 接口 | HTTP状态码 | 结果 | 说明 |
|---|------|-----------|------|------|
| 1 | `GET /api/health` | 200 | ✅ | 返回 `{"status":"ok","app":"FinPad"}` |
| 2 | `POST /api/auth/login` (正确密码) | 200 | ✅ | 返回 access_token + 用户信息 |
| 3 | `POST /api/auth/login` (错误密码) | 401 | ✅ | 返回 `"用户名或密码错误"` |
| 4 | `GET /api/auth/me` (带token) | 200 | ✅ | 返回用户 id/username/display_name/created_at |
| 5 | `GET /api/auth/me` (不带token) | 401 | ✅ | 返回 `"Not authenticated"` |

### 📊 仪表盘

| # | 接口 | HTTP状态码 | 结果 | 说明 |
|---|------|-----------|------|------|
| 6 | `GET /api/dashboard/summary` | 200 | ✅ | 返回资产总额、本月收支、交易数量、近期交易 |
| 7 | `GET /api/dashboard/trend?months=6` | 200 | ✅ | 返回月度趋势数据(2个月有数据) |
| 8 | `GET /api/dashboard/category` | 200 | ✅ | 返回分类支出统计(9个分类) |

### 💳 交易

| # | 接口 | HTTP状态码 | 结果 | 说明 |
|---|------|-----------|------|------|
| 9 | `GET /api/transactions?page=1&page_size=5` | 200 | ✅ | 返回5条记录，total=194，分页正确 |
| 10 | `GET /api/transactions?search=美团` | 200 | ✅ | 返回4条匹配"美团"的记录 |
| 11 | `GET /api/transactions?platform=支付宝&direction=支出` | 200 | ✅ | 返回84条支付宝支出记录，筛选正确 |
| 12 | `POST /api/transactions` (创建交易) | 405 | ⚠️ | **接口不存在** — 代码中无 POST 路由，仅支持 GET/PATCH/DELETE。交易数据通过数据源同步导入，不支持手动创建 |
| 13 | `PATCH /api/transactions/1` (更新交易) | 200 | ✅ | 成功更新 category 和 note 字段，已验证并回滚 |
| 13b | `PATCH /api/transactions/99999` (不存在) | 200 | 🐛 | **BUG**: 更新不存在的交易返回200而非404，缺少 rowcount 检查 |
| 14 | `DELETE /api/transactions/99999` (不存在) | 404 | ✅ | 正确返回 `"交易记录不存在"` |

### 🏦 账户

| # | 接口 | HTTP状态码 | 结果 | 说明 |
|---|------|-----------|------|------|
| 15 | `GET /api/accounts` | 200 | ✅ | 返回6个账户(支付宝/微信/招行/工行) |
| 16 | `POST /api/accounts` (创建测试账户) | 200 | ✅ | 成功创建，返回 id=7 |
| 17 | `DELETE /api/accounts/7` (删除测试账户) | 200 | ✅ | 删除成功 |

### 📡 数据源

| # | 接口 | HTTP状态码 | 结果 | 说明 |
|---|------|-----------|------|------|
| 18 | `GET /api/sources` | 200 | ✅ | 返回空列表(无数据源) |
| 19 | `POST /api/sources` (创建测试数据源) | 200 | ✅ | 成功创建，返回 id=1 |
| 20 | `POST /api/sources/1/sync` | 200 | ✅ | 返回 `"同步任务已触发"`, status="queued" |
| 21 | `GET /api/sources/1/logs` | 200 | ✅ | 返回空日志列表(新数据源无同步记录) |
| 22 | `DELETE /api/sources/1` | 200 | ✅ | 删除成功 |

### 🏷️ 分类

| # | 接口 | HTTP状态码 | 结果 | 说明 |
|---|------|-----------|------|------|
| 23 | `GET /api/categories` | 200 | ✅ | 返回18个预设分类(含emoji) |
| 24 | `GET /api/categories/mappings` | 200 | ✅ | 返回映射规则列表 |
| 25 | `POST /api/categories/mappings` | 200 | ✅ | 成功创建 支付宝/充值缴费→居住 映射 |

### 📈 报告

| # | 接口 | HTTP状态码 | 结果 | 说明 |
|---|------|-----------|------|------|
| 26 | `GET /api/reports` | 200 | ✅ | 返回报告列表(含分页) |
| 27 | `POST /api/reports/generate?period=2026-03` | 200 | ✅ | 触发报告生成，status="pending"，返回 report_id=1 |
| 28 | `GET /api/reports/1` | 200 | ✅ | 返回完整报告详情(含 raw_data_json，ai_analysis=null) |

---

## 📋 总结

**总测试数**: 28 项  
**✅ 通过**: 25 项  
**⚠️ 接口缺失**: 2 项  
**🐛 Bug**: 1 项

### ⚠️ 接口缺失说明

1. **`POST /api/transactions`** — 交易模块不支持手动创建(POST)。根据代码设计，交易数据仅通过数据源同步导入。这是设计决策而非 bug。但任务清单中要求测试的 "创建测试交易 → 更新 → 删除" 完整 CRUD 流程无法走通。
2. **`DELETE /api/transactions/{id}`** — 由于无法 POST 创建交易，无法测试 "删除刚创建的" 场景。改为测试删除不存在的交易(返回404，行为正确)。

### 🐛 Bug 详情

1. **`PATCH /api/transactions/{tx_id}` 缺少存在性检查**
   - **现象**: 更新不存在的交易 ID(99999) 返回 HTTP 200 `{"message":"更新成功"}`
   - **预期**: 应返回 HTTP 404 `{"detail":"交易记录不存在"}`
   - **根因**: `update_transaction()` 执行 UPDATE SQL 后没有检查 `cursor.rowcount`，与 `delete_transaction()` 的实现不一致
   - **修复建议**: 在 `app/routers/transactions.py` 的 `update_transaction` 函数中加入:
     ```python
     if cursor.rowcount == 0:
         raise HTTPException(status_code=404, detail="交易记录不存在")
     ```

### 💡 其他观察

- 所有需要认证的接口在无 token 时正确返回 401
- `GET /api/categories` 不需要认证(公开接口)，这是合理设计
- 分页参数(page/page_size)工作正常
- 搜索和过滤功能(search/platform/direction)工作正常
- 数据源同步功能为 placeholder(TODO)，仅返回 queued 状态
- 报告生成功能已实现数据聚合，但 AI 分析部分为 TODO(ai_analysis=null)
- 服务器在测试期间曾意外停止，需重启后继续（可能存在进程管理问题）
