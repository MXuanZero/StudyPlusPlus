# StudyPlusPlus MVP 验收报告（T10）

> 验收人：qa-dev（独立验收，未修改任何产品源码）
> 验收日期：2026-10-02
> 验收对象：`main` 分支，代码版本 `b234a96`（Lead 修复 P1–P4 后的复验版本）
> 产出提交：验收测试 `e8af1ed`、API smoke `78a7a81`、Lead 修复 `b1c3593`/`87eb81a`/`8bd1811`/`b234a96`、回归用例与报告更新提交（见附录 A）
> 结论：**有条件通过**。P1–P4 已修复并复验；97/97 后端测试、前端构建、生产单端口与 API smoke 全部通过。仅剩 P5（低危字段命名）与浏览器级 E2E 未覆盖，需人工复核。

---

## 1. 验收范围与方法

本次验收覆盖 `docs/04` T10 要求：

1. `.venv/bin/pytest -q` 全量后端测试；
2. `frontend` 生产构建（`tsc -b && vite build`）；
3. 生产单端口：FastAPI 托管 `frontend/dist`，验证 `/`、`/settings`、`/learn/ch05/ch05-03` SPA fallback 与 `/api/v1/health`；
4. `docs/02` 第 5 节 API 契约：二阶仿真三种模式、compare、presets、边界错误、settings、progress、notes、chat Mock SSE 与持久化；
5. 用解析公式独立校验 `docs/03` TC-C01 至 TC-C06（并补充 C07/C08）；
6. 安全与架构检查：真实 Key、前端求解器、Key 写入 localStorage、硬编码供应商；
7. 对照 `docs/01` 第 7 节与 `docs/03` 第 6 节逐条给出结论。

验收原则：**独立复算，不复述实现**；只新增 `scripts/`、`backend/tests/test_acceptance.py`、`docs/05_MVP验收报告.md`，不修改 `backend/app`、`frontend/src`。

### 1.1 环境

| 项目 | 版本 / 说明 |
| --- | --- |
| OS | Linux MXuanUbuntu 7.0.0-34-generic x86_64 |
| Python | 3.14.4（`.venv`） |
| 后端依赖 | FastAPI 0.121.2、SciPy 1.18.1、NumPy 2.5.3、httpx 0.28.1 |
| Node / npm | v24.21.0 / 11.19.0 |
| 数据库 | 验收测试使用临时 SQLite；生产 smoke 使用临时 `STUDY_DATA_DIR` |
| 浏览器 | 无 headless 可用：Playwright 未安装；`firefox --headless` 因 DBus transient scope 报错 |

### 1.2 新增验收资产

| 文件 | 作用 |
| --- | --- |
| `backend/tests/test_acceptance.py` | 31 个独立验收测试：解析公式复算、API 契约、持久化、静态安全扫描、P1–P4 回归 |
| `scripts/smoke_api.py` | 可重复运行的单端口 API smoke，69 项检查，不依赖真实 Key，自动清理临时数据 |
| `docs/05_MVP验收报告.md` | 本报告 |

---

## 2. 验收命令与结果

### 2.1 后端测试

```bash
cd /home/mxuan/WorkSpace/StudyPlusPlus
.venv/bin/pytest -q -rA
```

结果：

```text
97 passed
==================== warnings summary ====================
starlette/testclient.py:51
  DeprecationWarning: The anyio.abc.BlockingPortal alias is deprecated,
  use anyio.from_thread.BlockingPortal instead.
```

- 原有测试 66 个 + 新增验收测试 31 个 = **97 passed**。
- 仅有 1 个来自依赖 `starlette/anyio` 的弃用警告，无项目代码 warning。
- 新增验收测试用临时 SQLite（`monkeypatch app_settings.db_path`），不污染 `data/studyplusplus.db`。

### 2.2 前端构建

```bash
cd /home/mxuan/WorkSpace/StudyPlusPlus/frontend
npm_config_cache="$PWD/../.npm-cache" npm run build
```

结果：`tsc -b && vite build` 成功，**无 TypeScript 错误**（命令包含 `tsc -b`）。

| 产物 | 大小 | gzip |
| --- | --- | --- |
| `dist/assets/index-*.js` | 650.22 kB | 201.71 kB |
| `dist/assets/index-*.css` | 54.26 kB | 13.74 kB |
| `dist/assets/WidgetRenderer-*.js`（Plotly 懒加载 chunk） | 4707.21 kB | 1427.19 kB |
| KaTeX 字体等 | 12–64 kB/文件 | — |

构建耗时约 20.2 s。Plotly 被拆为独立懒加载 chunk，仅进入实验室时加载；Bundle 体积本身仍偏大，见“7. 遗留风险”。

### 2.3 生产单端口与 SPA fallback

```bash
TMP_DATA=$(mktemp -d)
cd backend
STUDY_DATA_DIR="$TMP_DATA" ../.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8123
# 另开终端：
.venv/bin/python scripts/smoke_api.py http://127.0.0.1:8123
```

SPA / 健康检查实测：

| 请求 | 状态 | Content-Type | 说明 |
| --- | --- | --- | --- |
| `GET /` | 200 | `text/html; charset=utf-8` | 返回 dist/index.html（432 B，含 `id="root"`） |
| `GET /settings` | 200 | `text/html; charset=utf-8` | SPA 深链 fallback 正常 |
| `GET /learn/ch05/ch05-03` | 200 | `text/html; charset=utf-8` | SPA 深链 fallback 正常 |
| `GET /api/v1/health` | 200 | `application/json` | `status=ok, version=0.1.0, llm_mode=mock` |
| `GET /api/v1/nonexistent` | 404 | `application/json` | `{"detail":{"code":"NOT_FOUND",...}}`，API 未被 SPA 吞掉 |

`scripts/smoke_api.py` 结果：**PASS: all 69 checks passed**，覆盖 SPA、health、curriculum/content、compute 三模式、compare、presets、settings、progress、notes、chat Mock SSE 与持久化。

### 2.4 性能抽测

对运行中的生产服务连续请求 30 次 `POST /api/v1/compute/second-order/simulate`（1001 点）：

```text
min=11.5ms  median=12.6ms  p95=17.6ms  max=18.5ms
compare(4 组)=42.1ms
```

后端计算 P95 远低于 PRD 500ms 要求。前端收到数据后的图表渲染 < 300ms 属于浏览器指标，本次未覆盖。

### 2.5 Lead 修复项复验（P1–P4）

| 问题 | 修复 commit | 复验方法 | 结果 |
| --- | --- | --- | --- |
| P1 统一 422 错误体 | `b1c3593` | 6 类非法请求：progress status、空笔记、空白聊天、temperature=9、n_points 字符串、额外字段 | 全部 422 且 `detail={"code":"VALIDATION_ERROR","message":...,"errors":[...]}`，不再返回 detail 数组 |
| P2 无阻尼 diagnostics | `87eb81a` | `step, ζ=0, ωn=1`，`t_end=20` 与 `t_end=60` | 两次均为 `["系统无阻尼，响应持续等幅振荡，不会收敛到稳态"]`，不再出现“增大 t_end” |
| P3 失败流空 assistant | `8bd1811` | 配置假 Key + `httpx.MockTransport` 返回 401，流开始前报错 | SSE `meta → error`；history 仅 `[user]`，无空 assistant 行（回归用例 `test_failed_stream_removes_empty_assistant_placeholder`） |
| P4 前端 DEV 求解器 | `b234a96` | `grep` 前端源码与 dist；`npm run build` | `frontend/src/mocks/secondOrder.ts` 已删除；src/dist 均无 `generateMockSimulation` / 求解器串；compute 只调用 `/api/v1/compute/*` |

---

## 3. 二阶系统计算独立复算（docs/03 第 6.1 节）

以下“期望值”均由 `math`/解析公式独立计算，不使用 `backend/app/services/second_order.py` 中的实现。

| 用例 | 输入 | 独立解析期望 | API 实测 | 结论 |
| --- | --- | --- | --- | --- |
| TC-C01 | step, ζ=0, ωn=1 | y=1-cos(t)；tp=π；Mp=100%；极点 ±j | max|Δy|=2.4e-14；tp=3.14；Mp=99.9999%；poles ±j | 通过 |
| TC-C02 | step, ζ=1, ωn=1 | y=1-(1+t)e^{-t}；单调无超调 | max|Δy|=2.3e-15；单调；peak_time=null；Mp=0 | 通过 |
| TC-C03 | step, ζ=0.5, ωn=1 | poles=-0.5±j0.8660；tp=3.6276；Mp=16.3034%；ts2=8.0；ts5=6.0 | poles=-0.5±j0.8660；tp=3.63；Mp=16.3033%；ts2=8.076（相对误差 0.95%，<10%）；analytic ts2=8.0/ts5=6.0 | 通过 |
| TC-C04 | step, ζ=0.707, ωn=1 | tp=4.4422；Mp=4.3255% | tp=4.44；Mp=4.3255% | 通过 |
| TC-C05 | initial, ζ=0, ωn=1, y0=1, v0=0 | y=cos(t)，周期 2π | max|Δy|=2.3e-09；y(π)=-0.999993；u 全 0；metrics=null | 通过 |
| TC-C06 | step, ζ=-0.1, ωn=1 | 分类 unstable；极点实部 >0；末端发散；指标 null；diagnostics 提示 | 分类 unstable；极点 +0.1±j0.995；y_end=-2.031；metrics=null；diagnostics=[“系统不稳定…”] | 通过 |
| TC-C07 | impulse, ζ=0.5, ωn=2 | h(t)=ωn²/ωd·e^{-ζωn t}·sin(ωd t) | max 相对误差=6.96e-11；u 全 0；metrics=null | 通过 |
| TC-C08 | step, ωn=0 | 422，`INVALID_OMEGA_N` | 422 `{"detail":{"code":"INVALID_OMEGA_N","message":"自然频率必须大于 0.0 且不超过 10.0"}}` | 通过 |

补充边界（新增验收测试覆盖）：ζ=-0.51/3.01、ωn=0/10.01、y0=±2.01、v0=±2.01、t_end=0/60.01、n_points=199/5001、input_type=ramp 均返回 422 且错误码正确。

### 3.1 Compare / Presets

- `POST /compare` 1–4 组：成功，label、classification 与顺序正确；
- 顶层 JSON 数组兼容形式：成功；
- 5 组：422 `INVALID_COMPARE_RUNS`；
- `GET /presets`：返回 5 个预设，参数与 `docs/03` §4.1.4 完全一致。

---

## 4. API 契约检查（docs/02 第 5 节）

| 模块 | 检查项 | 结果 | 证据 |
| --- | --- | --- | --- |
| 基础 | `GET /api/v1/health` | 通过 | `status=ok, version=0.1.0, llm_mode=mock/live` |
| 课程 | `GET /api/v1/curriculum` 两卷、仅 ch05 available | 通过 | vol1 12 章 / vol2 8 章；仅 ch05 及 5 个 topic 为 available |
| 课程 | 标题与 `Reference/*.md` 一致 | 通过 | 逐章归一化比对：vol1 12/12、vol2 8/8（含“附录A代码汇总与说明”“参考文献”两行） |
| 内容 | `GET /topics/ch05-03` 正文/widgets/prev-next | 通过 | 含 `$$`、`:::details`、`[[widget:`；prev=ch05-02，next=ch05-04 |
| 内容 | planned / 未知 topic | 通过 | ch01-01→404 `TOPIC_NOT_AVAILABLE`；ch05-99→404 `TOPIC_NOT_FOUND` |
| 计算 | step / impulse / initial 三模式 | 通过 | 三种模式均 200；步长/长度/输入序列符合定义 |
| 计算 | 边界错误 | 通过 | 服务层参数错误统一 `{detail:{code,message}}` |
| 进度 | `GET /progress`、`PUT /progress/{topic}`、`GET /progress/{chapter}` | 通过 | 标记 ch05-01 completed，章进度 total=5、completed=1、percent=20.0，与独立计数一致 |
| 笔记 | `GET/POST/PUT/DELETE /notes` | 通过 | CRUD 全通，删除后不再列出 |
| 聊天 | sessions CRUD + Mock SSE meta→delta→done + 消息持久化 | 通过 | 事件顺序 `meta,delta,done`；历史 `[user,assistant]`，内容一致；重启后仍可读；删除级联 404 |
| 设置 | GET/PUT/test/reset | 通过 | 默认 DeepSeek mock；写 mock Key 后脱敏 `****7890`、live；空 Key 保留；reset 恢复默认；`/chat/completions` 幂等归一化为 `/v1` |
| 设置 | Key 不泄露 | 通过 | 响应无 `api_key` 明文字段，明文不出现在响应体；现有 MockTransport 测试覆盖 401/timeout 错误脱敏 |

### 4.1 持久化验证方式

`test_acceptance.py` 在同一个临时 SQLite 上关闭再重新打开 `TestClient(app)`，触发一次新的 lifespan：

- 进度 `ch05-01=completed`、`ch05-03=learning` 保留；
- 章节百分比重新计算正确；
- 笔记更新内容保留；
- 聊天历史保留。

---

## 5. 安全与架构检查

| 检查项 | 方法 | 结果 |
| --- | --- | --- |
| 源码无真实 API Key | `git grep -nE "sk-[A-Za-z0-9_-]{24,}"`（排除测试/依赖） | 未发现真实 Key；测试中的 `sk-...` 均为明显假值且不进入运行路径 |
| 无 `.env` 密钥入库 | `find . -name .env` | 未发现 `.env`，`.gitignore` 已忽略 |
| Key 不返回前端明文 | 检查 settings/health/SSE 响应 | 只返回 `has_api_key`、`api_key_masked`、`key_source`；错误消息经 `sanitize_error_message` 脱敏 |
| Key 不写 localStorage | 扫描 `frontend/src`；检查生产 dist | 设置页/客户端无持久化 Key；`localStorage` 仅 DEV mock chat 用于会话缓存，未存 Key |
| 前端无 numpy/scipy | 扫描 `frontend/src` 与 `package.json` | 无依赖、无 import |
| 前端无求解器（源码 + 构建） | 扫描 `frontend/src`、`package.json`、`frontend/dist/*.js` | `mocks/secondOrder.ts` 已删除；源码与 dist 均无 `generateMockSimulation` / JS 求解器字符串；package.json 无 numpy/scipy |
| 供应商不写死 | 检查设置预设与 `llm.py` | deepseek/openai/ollama/custom 均可配置；Base URL 规范化 |
| CORS | `config.py` | 仅 `127.0.0.1:5173`、`localhost:5173` |

---

## 6. PRD 第 7 节 MVP 验收标准逐条结论

| # | 标准 | 结论 | 说明 / 证据 |
| --- | --- | --- | --- |
| 1 | 打开首页看到两卷目录，能进入第 5 章 | **通过（API/构建）** | curriculum 返回两卷；HomePage/CatalogTree 源码存在；浏览器视觉未复核 |
| 2 | 全部知识点可阅读，公式渲染，推导可折叠 | **部分通过** | 5 个 topic 均返回正文，含 KaTeX/`:::details`/widget 标记；浏览器实际渲染未覆盖 |
| 3 | 拖动 ζ/ωn，曲线/极点/指标 500ms 内联动 | **部分通过** | 后端 P95=17.6ms、前端 150ms debounce + API 调用源码存在；真实滑杆交互未覆盖 |
| 4 | 三种模式结果正确；五类阻尼行为可复现 | **通过（计算）** | TC-C01–C06 + presets；浏览器 UI 未覆盖 |
| 5 | 指标与解析公式误差在容差内 | **通过** | TC-C01–C04 独立复算，ts2 相对误差 0.95% |
| 6 | 任意页面 AI 对话，流式 + 多轮历史 | **部分通过** | 后端 SSE/持久化通过；ChatDock/ChatPanel 源码存在；浏览器交互未覆盖 |
| 7 | 默认 DeepSeek，可切换任意 OpenAI 兼容/Ollama，无写死 | **通过** | settings 四预设 + custom；无单一供应商分支 |
| 8 | 无 Key 时 Mock，学习/可视化不受影响 | **通过** | health mode=mock、test 离线 mock、SSE Mock；compute/content 不依赖 Key |
| 9 | 进度和笔记重启后仍在 | **通过** | 同一 SQLite 重新打开 lifespan 后数据保留 |
| 10 | 白色简洁桌面风格，无移动适配 | **部分通过** | `global.css` 主背景 `#ffffff`、无 `@media` 移动断点；视觉/布局未浏览器复核 |

---

## 7. docs/03 第 6.2 节前端用例与受限项

浏览器级 E2E **未覆盖**，原因：环境无 Playwright；firefox 因 DBus transient scope 无法创建实例。以下均为源码级证据，不得视为浏览器通过：

| 用例 | 源码级证据 | 结论 |
| --- | --- | --- |
| TC-U01 ζ 拖动曲线/极点联动 | `SecondOrderLab` 调后端 simulate；`PoleZeroMap` 渲染 poles | 未覆盖，需人工复核 |
| TC-U02 不稳定预设 | presets 含 unstable；指标不适用分支 | 未覆盖，需人工复核 |
| TC-U03 初始状态 y0/v0、相轨迹 | initial 模式字段与 `PhasePortraitPlot` | 未覆盖，需人工复核 |
| TC-U04 对比两条曲线、图例 | compare API + `defaultCompare` | 未覆盖，需人工复核 |
| TC-U05 连续拖动只发最后一次请求 | `useDebouncedValue(..., 150)` | 未覆盖，需人工复核 |
| TC-U06 导出 CSV 列名/行数 | `SecondOrderLab` 生成 `t,y,u` CSV | 未覆盖，需人工复核 |

其他受限项：

- 前端图表渲染性能（<300ms）、AI 首字延迟：无浏览器环境，未覆盖；
- 真实 LLM 供应商调用：按要求不依赖真实 Key，本环境未测试；现有测试用 `httpx.MockTransport` 覆盖 live 协议路径；
- 真实浏览器视觉/可访问性（WCAG AA、键盘操作）：未覆盖。

---

## 8. 问题处理结果与剩余风险

### 8.1 已修复并复验（resolved）

| 编号 | 问题 | 级别 | 修复 commit | 复验证据 |
| --- | --- | --- | --- | --- |
| P1 | Pydantic 422 不满足统一错误包络 | 中 | `b1c3593` | 6 类非法请求均返回 `{"code":"VALIDATION_ERROR","message","errors"}`；旧 `detail:[...]` 行为已消除 |
| P2 | 无阻尼仍提示“增大 t_end” | 低 | `87eb81a` | `t_end=20/60` 均返回“系统无阻尼，响应持续等幅振荡，不会收敛到稳态” |
| P3 | 流式失败留下空 assistant 行 | 低 | `8bd1811` | 401 且无 delta 时 history 仅 `[user]`；有部分增量时仍保留 partial 内容 |
| P4 | 前端源码含 DEV-only JS 求解器 | 风险 | `b234a96` | `frontend/src/mocks/secondOrder.ts` 删除；源码/生产 dist 均无求解器；所有仿真走后端 |

### 8.2 剩余问题（open）

#### P5（低）脱敏字段命名与任务描述不一致

- 实现返回 `api_key_masked`；`docs/04` T5/T8 描述写作 `masked_api_key`。
- 前端两种字段都兼容，功能不受影响；建议文档或实现统一命名。

---

## 9. 遗留风险与后续建议

1. 统一 P5 脱敏字段命名（低危，文档或实现二选一即可）；
2. 引入 Playwright（或可用 headless 浏览器）补齐 TC-U01–TC-U06、白底视觉与 KaTeX 渲染回归；
3. 前端图表收到数据后 < 300ms 渲染、AI 首字延迟等浏览器指标未测量；
4. Plotly chunk 4.7 MB，建议评估按需加载/轻量绘图方案；
5. 真实供应商连通性需在有 Key 的环境手工验证（本报告按要求不覆盖）；
6. 无真实 Key 的 live 协议路径已由 `httpx.MockTransport` 测试覆盖，但真实网络/鉴权仍需人工抽测。

---

## 10. 验收结论

- **后端**：97/97 pytest 通过，计算正确性经解析公式独立复算；P1–P4 已修复并回归；**通过**。
- **前端**：`npm run build` 成功，无 TypeScript 错误；P4 求解器已移除；**构建通过**。
- **生产单端口**：SPA fallback 与 API 均 200，`smoke_api.py` 69/69；**通过**。
- **API 契约**：compute/settings/progress/notes/chat Mock 全通；P1 统一错误包络已复验；P3 失败流历史无空 assistant；**通过**。
- **安全**：无真实 Key、无 Key 写 localStorage、前端源码与生产构建均无求解器；**通过**。
- **浏览器 E2E**：未覆盖，需人工复核；本轮不伪造通过。
- **剩余**：仅 P5 低危字段命名差异。

**综合：有条件通过。** P1–P4 已处理完毕；浏览器交互与视觉验收需另行人工完成，P5 建议顺手统一命名。


---

## 附录 A：新增文件与提交

| 提交 | 内容 |
| --- | --- |
| `e8af1ed` | `test(acceptance): add independent MVP acceptance tests`（`backend/tests/test_acceptance.py` 初版 29 tests） |
| `78a7a81` | `test(smoke): add repeatable single-port API smoke script`（`scripts/smoke_api.py`，69 checks） |
| `f6986f1` | `docs(acceptance): add MVP acceptance report`（首版报告） |
| `b1c3593` | `fix(api): unify request validation errors into detail envelope`（P1） |
| `87eb81a` | `fix(compute): clarify undamped steady-state diagnostics`（P2） |
| `8bd1811` | `fix(chat): avoid empty assistant bubble when stream fails early`（P3） |
| `b234a96` | `refactor(frontend): remove DEV-only second-order solver fallback`（P4） |
| `4838c15` | `test(acceptance): add P1-P4 regression checks`（`backend/tests/test_acceptance.py` 增至 31 tests） |
| 本次报告更新提交 | `docs(acceptance): update MVP report for resolved P1-P4` |

## 附录 B：关键命令

```bash
# 1. 后端全量测试
cd /home/mxuan/WorkSpace/StudyPlusPlus && .venv/bin/pytest -q -rA

# 2. 前端生产构建
cd frontend && npm_config_cache="$PWD/../.npm-cache" npm run build

# 3. 生产单端口启动（临时数据目录，避免污染 data/）
TMP_DATA=$(mktemp -d)
cd backend && STUDY_DATA_DIR="$TMP_DATA" ../.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8123

# 4. API smoke（69 项）
cd /home/mxuan/WorkSpace/StudyPlusPlus && .venv/bin/python scripts/smoke_api.py http://127.0.0.1:8123
```
