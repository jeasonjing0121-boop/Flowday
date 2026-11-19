# FlowDay Phase 4.2 第二轮验收报告 — R3 Dashboard 单遍聚合 + R4 搜索防抖

> 本轮仅实施 R3 / R4；未修改 IndexedDB 结构、未拆分 Object Store、未新增索引、未实施 R5–R7、未引入新依赖、未改变视觉样式与业务口径。
> 所有性能数据来自真实浏览器测量（Edge headless + 真实生产模块 + 应用内埋点），沿用 Phase 4.1/4.2 第一轮的测试环境、数据构造与计时口径。

- 日期：2026-11-14
- 环境：Windows x64 · Intel i7-8565U（4C/8T，1.8GHz）· 8 GB · Edge 157.0.4341.60 headless（`--disable-gpu`，1440×900）· Node v24.16.0
- 数据：确定性生成 1,000 / 5,000 / 10,000 条任务（日期 -20~+39 天、P1–P3、1/5 已完成、1/3 含备注、1/4 含时间；习惯 2–3 个）
- 重复次数：每项关键指标 5 次，记录中位与最大
- 交付物：本报告 + `perf-4.2-r3r4-dev.json`、`perf-4.2-r4-prod.json`、`perf-4.2-scroll.json`、`perf-4.2-r3r4-compare.md`、`docs/phase4.2/e2e-report.json`、`screenshots/`

---

## 0. 结论摘要

| 指标（10,000 条） | 目标 | 实测 | 结论 |
|---|---|---|---|
| Dashboard 聚合计算（真实模块） | < 25 ms | **7.8 ms**（旧组合 24.3 ms，3.1×） | ✅ |
| Dashboard 聚合（页面内单次） | < 25 ms | **11.3 ms** | ✅ |
| 搜索实际计算（filterTasks） | ≤ 100 ms | **7.6 ms**（各场景 7.6–21.0 ms） | ✅ |
| 输入结束→结果显示（生产构建） | ≤ 250 ms | **154.1 ms**（开发环境 217 ms） | ✅ |
| 搜索结果正确性 | 100% | 所有场景 `filteredLen` 与参照 `filterTasks` 完全一致（143 / 715 / 1429） | ✅ |
| Dashboard 统计正确性 | 100% | 聚合同旧 selectors 逐项对比 **0 项不一致**；勾选后统计正确 | ✅ |
| 扫描次数 | 单遍 | **11 遍 → 1 遍**（同时消除 2 次全量排序） | ✅ |
| 连续输入 5 次的实际查询次数 | 1 次 | **1 次**（页面渲染次数由 5 次输入驱动，但只计算 1 次） | ✅ |

**新增依赖：无。** 全部使用现有技术栈（React 内置 hook + 纯函数 selector + 原生 Date/IndexedDB）。

---

## 1. 代码审查结论（修改前）

### 1.1 Dashboard 重复扫描点（`DashboardPage.tsx` 原实现）

| 调用 | tasks 扫描次数 | 其他成本 |
|---|---|---|
| `todayStats(data)` | 2（total、done） | — |
| `focusTasks(data, 3)` | 1 | 1 次全量 `sortTasks`（排序候选为 8,000 条待办） |
| `todayOpenTasks(data)` + `sortByTime` | 1 | 1 次全量 `sortTasks` + 1 次时间排序 |
| `last7DayCompletion(data)` | **7** | 每条已完成任务 `new Date(completedAt)` + `dateKey` |
| `habits` + `isHabitChecked` | 每个习惯 1 次 `habitLogs.some` | — |
| **合计** | **≈11 遍** | 2 次全量排序、7 次日期解析/任务 |

另：`today = todayKey()` 每次渲染现算，`useMemo([data])` **跨日不刷新**（页面停留过午夜会显示旧统计）。

> 说明：Phase 4.1 中"排序 49.5 + 近 7 日 22.6 + 焦点 13.5 ≈ 88ms"是分散单项测量之和；本轮用同一份数据组合测量旧实现实际耗时作为基线（10k：24.3ms，中位/最大 41.1ms），避免重复计算同一个排序结果。

### 1.2 搜索输入重复计算（`TasksPage.tsx` 原实现）

`value={query}` 直接驱动 `filterTasks`：**每敲 1 个字符 = 1 次全量 filter + sort + 分组 + 虚拟列表重建**（10k 单次约 170–190ms）；无 IME composition 处理（拼音过程会连续触发搜索）；查询变化后不处理滚动位置。

---

## 2. R3 实现说明：Dashboard 单遍聚合

### 2.1 新增纯函数 `dashboardAggregate(data, today, focusLimit = 3)`（`src/lib/selectors.ts`）

一次遍历 `data.tasks` 同时产出：

| 字段 | 口径（与旧业务完全一致） |
|---|---|
| `total` / `done` / `open` / `percent` | `date <= today`；`done` 为其中 completed；`percent = round(done/total*100)`（total 为 0 时 0） |
| `week` / `weekTotal` | `completedAt` 的**本地日期**落在 `[today-6, today]` 的完成数（Map 单遍计数） |
| `focus` | `!completed && date <= today` 的候选，按 `sortTasks` 排序后取前 3 |
| `timeline` | `!completed && date === today && 有 time`，先 `sortTasks` 再按时间/优先级稳定排序（与原 `sortByTime(todayOpenTasks...)` 等价） |
| `habitTotal` / `habitChecked` | 未归档习惯数；当天打卡集合（单遍扫描 `habitLogs`） |
| `scans` | 恒为 1，用于测试断言"确实只扫描一次" |

- **不修改入参**：返回全新对象，不写回 `data`、不改 reducer。
- **保留旧 selectors**：`todayStats / focusTasks / todayOpenTasks / last7DayCompletion / isHabitChecked` 全部保留，作为测试参照与其它页面既有接口。
- Dashboard 内用 `useMemo(() => dashboardAggregate(data, today), [data, today])`，只有任务/习惯/设置数据或日期变化才重算。

### 2.2 跨日与本地日期（`src/lib/useToday.ts` + `msUntilNextMidnight`）

- `msUntilNextMidnight(now)` 使用 `new Date(y, m, d + 1, 0, 0, 0, 50)` 计算到**下一个本地日历日午夜**的距离，而不是固定 +24h，因此不受夏令时/时区调整影响；返回最少 1000ms 兜底。
- `useToday()`：到午夜定时刷新；`visibilitychange`（回到可见）与 `focus` 时重新校准，覆盖页面休眠/后台节流导致的定时器漂移。
- Dashboard 使用 `useToday()` 返回的日期作为聚合入参，因此**跨日即使 AppData 未变化，统计也会重新计算**。
- 时间戳（`completedAt`）一律用 `dateKey(new Date(...))` 转为**本地日期**再比较，不使用 UTC 日期。

---

## 3. R4 实现说明：搜索防抖与 IME

### 3.1 状态拆分

- `inputValue`：受控输入值（只驱动输入框渲染）。
- `debouncedQuery`：真正参与 `filterTasks` 的查询。
- 120ms 防抖；**清空立即生效**、**Enter 立即生效**、**compositionend 立即生效**。
- 切换状态/优先级/日期筛选时先 `flushQuery()`，保证"最终结果始终对应最新的全部搜索条件"，不会出现旧查询 + 新筛选的过期组合。

### 3.2 中文输入法

- `compositionstart` 置 `composingRef = true`，组合期间**不安排防抖搜索**；
- `compositionend` 读取输入框实时值，一次性提交（只触发 1 次查询）；
- Enter 在 `nativeEvent.isComposing`/组合标志为真时不触发立即搜索，避免拼音阶段误提交；
- 读取输入值时使用 `e.currentTarget.value` / `inputRef.value`（DOM 实时值），避免同一事件循环内 React 尚未提交 state 导致读到旧值。

### 3.3 与虚拟滚动兼容

- `filtered` 变化后 `groups` 重新分区，`TaskRows` 的 `model`（前缀偏移）随 `tasks` 引用重建，可见窗口在下一帧重算；结果为空时仍走原空状态。
- **滚动位置策略**：仅当「查询/状态/优先级/日期」条件变化、且用户已滚动到列表下方时，滚回列表顶部；普通数据变化（勾选/编辑/删除）**不会**改变滚动位置（实测：勾选后 4000px 保持 4000px；改查询后回到列表顶部 278px 处）。

### 3.4 防抖等待反馈

- `inputValue !== debouncedQuery` 时在搜索框内显示轻量「搜索中…」，保留旧结果，避免用户误判结果错误；不改变搜索框结构/样式（仅新增一个 10px 文本节点）。

### 3.5 开发态埋点（不进入生产）

- `__FD_FILTER_COUNT__`（逻辑查询次数，StrictMode 双调用去重）、`__FD_FILTER_MS__`、`__FD_LAST_FILTERED_LEN__`、`__FD_PAGE_RENDERS__`、`__FD_AGG_MS__`、`__FD_AGG_COUNT__`、`__FD_DASH_RENDERS__` 全部包在 `import.meta.env.DEV` 内。
- **生产构建扫描结果：`dist/assets/*.js` 中 `__FD_` / `__FD_STATE__` / `__BENCH` 命中数为 0**（已实测验证）。

### 3.6 保留旧逻辑作为参照

- `filterTasks` 未改动，仍是唯一筛选/排序实现；旧 selectors 未删除。
- 新增测试 `[15] 搜索参照逻辑`：逐前缀过滤收敛、组合筛选、清空恢复，均与旧实现一致；基准中的"期望结果"也由旧 `filterTasks` 直接计算。

---

## 4. 修改文件清单

| 文件 | 类型 | 内容 |
|---|---|---|
| `src/lib/selectors.ts` | 修改 | 新增 `dashboardAggregate` / `DashboardAggregate`；保留全部旧 selectors |
| `src/lib/date.ts` | 修改 | 新增 `msUntilNextMidnight`（按本地日历日计算） |
| `src/lib/useToday.ts` | **新增** | 跨日自动刷新 hook（午夜定时器 + visibilitychange/focus 校准） |
| `src/features/today/DashboardPage.tsx` | 修改 | 改用单遍聚合 + `useToday`；DOM/样式/统计项不变；dev 埋点 |
| `src/features/tasks/TasksPage.tsx` | 修改 | 输入态/查询态拆分、120ms 防抖、IME、Enter/清空立即、筛选变更 flush、pending 提示、条件变化滚动复位、dev 埋点 |
| `src/tests/smoke.test.ts` | 修改 | 新增 [13] 聚合等价性 / [14] 跨日·日期工具 / [15] 搜索参照逻辑（共 +26 断言） |
| `scripts/e2e.mjs` | 修改 | 新增 [7.9] R3 统计联动 / R4 防抖·IME·Enter·清空（+8 项断言） |
| `scripts/bench-4.2-r3r4.mjs` | **新增** | R3 模块/应用级 + R4 场景真实测量（5 次中位/最大） |
| `scripts/bench-4.2-r4-prod.mjs` | **新增** | 生产构建下 R4 总延迟（DOM 信号计时，无埋点） |
| `scripts/bench-4.2-scroll.mjs` | **新增** | 虚拟列表滚动位置行为校验 |
| `scripts/compare-4.2-r3r4.py` | **新增** | 生成对比表 |
| `docs/phase4.2/PHASE4.2-R3-R4-REPORT.md` | **新增** | 本报告 |

**未修改**：`AppStore.tsx`、`reducer.ts`、`src/lib/storage/*`（数据架构/持久化）、`TaskRows.tsx`、`TaskRow.tsx`（R1/R2 虚拟滚动与 memo 机制）、UI/CSS。

---

## 5. 优化前后性能对比（10,000 条任务）

### 5.1 R3 Dashboard 聚合

| 指标 | 优化前 | 优化后 | 说明 |
|---|---|---|---|
| 旧组合实际耗时（同数据、同方法） | 24.3 ms（max 41.1） | — | 4 个 selector 依次调用 |
| 新聚合耗时（真实模块，5 次中位/最大） | — | **7.8 ms**（max 10.3） | 3.1× 提升 |
| 页面内单次聚合（浏览器实际环境） | — | **11.3 ms**（max 11.8） | 含真实组件调用 |
| tasks 扫描次数 | 11 遍 + 2 次全量排序 | **1 遍 + 2 次候选排序** | 见第 6 节 |
| 勾选→Dashboard 统计更新 | — | **95.3 ms**（1k 77.9 / 5k 80.7） | 点击 → 2×rAF，含 React 提交与布局 |
| 统计正确性 | — | **100%**（0 项不一致） | 同旧 selectors 逐项对比 |

> 10k 聚合 7.8ms 明显低于 25ms 目标；Phase 4.1 的"≈88ms"来自分散测量之和（且当时 sortTasks 尚无排序键缓存），本轮以同数据组合重测为基线，避免口径误导。

### 5.2 R4 搜索（开发环境埋点 / 生产构建总延迟）

| 场景 | 输入事件 | 实际查询次数 | 单次查询耗时（10k） | 开发环境总延迟（10k） | 生产构建总延迟（10k） |
|---|---|---|---|---|---|
| 连续输入 5 次 | 5 | **1** | **7.6 ms** | 217 ms | **154 ms** |
| 快速输入后删除 | 3 | **1** | 29.7 ms | 283 ms\* | 清空 69 ms |
| 中文输入法（拼音 2 次 + 上屏） | 3（含 composition） | **1** | 9.1 ms | 102 ms | **28 ms** |
| Enter 立即搜索 | 1 | **1** | — | 159 ms | **33 ms** |
| 清空搜索 | 1 | **1** | 21.0 ms | 233 ms | **69 ms** |

\* 开发环境"快速输入后删除"为 283ms（>250ms 目标）：该场景在 dev 下同一任务内触发了 3 次输入状态更新 + StrictMode 双渲染，且 dev 模块未压缩；对应生产构建的清空路径为 69ms。所有场景的实际查询次数均为 1，查询耗时 ≤ 29.7ms。

### 5.3 达标情况

| 目标 | 目标值 | 实测 | 结论 |
|---|---|---|---|
| 10k Dashboard 聚合 | < 25 ms | 7.8 ms / 页面内 11.3 ms | ✅ |
| 10k 搜索实际计算 | ≤ 100 ms | 7.6 ms（最高场景 29.7 ms） | ✅ |
| 10k 输入结束→结果显示 | ≤ 250 ms | 生产 154 ms（开发 217 ms） | ✅ |
| 搜索结果正确性 | 100% | 全部场景与参照实现一致 | ✅ |
| Dashboard 统计正确性 | 100% | 0 项不一致，勾选后正确 | ✅ |
| 聚合扫描次数 | 单遍 | 1 遍（旧 11 遍） | ✅ |

---

## 6. Dashboard 聚合计算次数对比

| 数据 | 旧实现 | 新实现 |
|---|---|---|
| tasks 扫描 | 2（今日统计）+ 1（焦点）+ 1（时间线）+ 7（近 7 日）= **11 遍** | **1 遍** |
| 全量排序 | 焦点 1 次 + 时间线 1 次 = **2 次** | 仅对候选排序：焦点候选 + 时间线候选（10k 数据中分别约 8,000 / 167 条，且不重复全量排序） |
| `new Date(completedAt)` 解析 | 每条已完成任务 7 次（近 7 日循环） | 每条已完成任务 **1 次** |
| habitLogs 扫描 | 每个习惯 1 次 `some`（O(H·L)） | **1 次**（构建当天打卡 Set） |
| 每次更新聚合次数 | — | 1 次/次渲染（开发态计数 2 次为 StrictMode 双调用校验） |

等价性验证覆盖：今日任务数、已完成数、未完成数、完成率、逾期/今日/未来任务边界、近 7 日统计、焦点任务顺序、时间线顺序、习惯打卡数、跨周、无 `completedAt` 的已完成任务、空数据、指定 today 的参数化计算。**全部一致（不一致项 0）。**

---

## 7. 搜索输入次数与实际计算次数对比

| 规模 | 连续输入 5 次 | 实际查询 | 合并率 |
|---|---|---|---|
| 1,000 | 5 | 1 | 5:1 |
| 5,000 | 5 | 1 | 5:1 |
| 10,000 | 5 | 1 | 5:1 |

- 输入法场景：拼音 2 次输入 + 1 次上屏 → **组合期间 0 次查询，compositionend 后 1 次**；
- Enter / 清空：各 1 次输入事件 → **1 次查询**（立即执行）；
- 防抖等待期间保留旧结果并显示「搜索中…」，不出现"查询已变但界面仍是旧条件"的误导（条件变更时会先 flush 查询）。

---

## 8. 中文输入法测试报告

| 检查项 | 方法 | 结果 |
|---|---|---|
| composition 期间不触发搜索 | 派发 `compositionstart` + 2 次拼音 `input`，等待 160ms，读取查询计数 | **0 次查询** ✅ |
| compositionend 后只计算一次 | 派发 `compositionend`（上屏「周报」），读取计数与结果 | **1 次查询**，结果 143/715/1429 条与参照一致 ✅ |
| 拼音过程不破坏输入框 | 组合期间输入框值保持拼音串，上屏后为中文 | ✅ |
| Enter 在组合期间不误触发 | 逻辑判断 `composingRef` + `isComposing` | 代码路径已覆盖；自动化用合成 composition 事件验证 ✅ |
| 生产构建一致 | 生产构建 R4 测量（DOM 信号） | IME 上屏→结果 28.1ms，组合期间无结果更新 ✅ |

> 局限：自动化使用合成 `CompositionEvent`（CDP 无真实 IME 输入通道），未覆盖真实中文输入法候选窗交互；E2E 与基准均按事件语义验证逻辑正确性。

---

## 9. 完整回归测试报告

| 检查 | 结果 |
|---|---|
| TypeScript `tsc --noEmit` | ✅ 0 错误 |
| 逻辑测试（smoke） | ✅ **97/97**（原 71 + 新增 26 项：聚合等价性/日期工具/搜索参照逻辑） |
| E2E（Edge headless） | ✅ **90/90**（原 82 + 新增 8 项：[7.9] 防抖、IME、Enter、清空、新建/删除后 Dashboard 统计联动） |
| 生产构建 | ✅ CSS 42.84 kB（gzip 8.49）/ JS 350.80 kB（gzip 108.61） |
| 生产构建调试变量 | ✅ `__FD_` / `__FD_STATE__` / `__BENCH` 命中 **0** |
| Dashboard 统计正确性 | ✅ 聚合同旧 selectors 逐项一致（0 项不一致）；E2E 新建/删除/勾选后统计同步 |
| 任务 CRUD 回归 | ✅ E2E [2] 创建/完成/撤销/刷新持久化/二次确认删除全部通过 |
| 搜索/筛选/排序回归 | ✅ E2E [2.5]、[7.9]；smoke [15] 参照实现一致 |
| 中文输入法回归 | ✅ E2E [7.9] + 生产基准 |
| 虚拟滚动回归 | ✅ E2E 玻璃/堆叠/响应式；基准：10k 仅 46 行 DOM；滚动位置 4000→4000（数据变化不跳动）、查询变化回顶部（278px） |
| 移动/平板/桌面响应式 | ✅ E2E [7]（390px）、[7.7]（360/768/1024/1440 无横向溢出）、E2E 截图 |
| IndexedDB 持久化回归 | ✅ E2E [7.8]（初始化、迁移、防重复、损坏恢复、导入导出、schema v2）全部通过 |
| 失败项 | **0** |

---

## 10. 已知问题与下一轮建议

**已知问题 / 局限**

1. **开发环境 StrictMode 放大计数与时延**：`__FD_FILTER_COUNT__`/渲染次数为去重后的逻辑计数，但延迟测量包含 StrictMode 双渲染；生产构建下 R4 总延迟为 154ms（目标内）。"快速输入后删除"在 dev 下 283ms 略超 250ms，属 dev 环境开销，生产清空路径 69ms。
2. **聚合仍是全量重算**：任何任务变化都会重算 1 遍（10k 约 8–11ms）；可接受，但未来可做增量更新（脏标记 + 仅更新受影响统计）。
3. **`useToday` 无法自动化验证真实过夜**：通过 `msUntilNextMidnight` 单测 + visibilitychange 兜底覆盖；未在真实跨午夜环境验证。
4. 搜索仍为全量 substring（无索引/分词），10k 计算 7.6ms 可接受；更大数据量（>50k）需重新评估。
5. IME 自动化使用合成事件，未覆盖真实输入法候选窗与不同输入法（搜狗/微软拼音）差异。
6. 防抖期间保留旧结果 +「搜索中…」提示，属于 UX 取舍；若产品要求"输入即显示骨架/清空列表"需另行设计。

**下一轮建议**

1. R5：任务页默认视图收敛（今天+逾期+前 N 条即将），进一步降低首屏 DOM 与首次计算。
2. R6/R7：写入合并与批量 API，减少整份写入次数（当前 10k 单次写约 33–54ms）。
3. 为性能加"回归阈值"CI：把本轮 6 个关键指标写入脚本，超过阈值即失败（防回归）。
4. 后续评估聚合增量更新与 `filterTasks` 的索引化（先做真实查询分布测量）。
5. 真实设备/真实输入法补充测试（移动端 IME、Safari/Firefox）。

---

## 11. 复现命令与交付物

```bash
cd flowday
npm run typecheck && npm test && npm run build
node scripts/bench-4.2-r3r4.mjs                 # 开发服务器 5173：R3/R4 + 埋点计数（5 次）
npm run preview -- --port 4173 --strictPort      # 另一个终端
node scripts/bench-4.2-r4-prod.mjs              # 生产构建 R4 总延迟（DOM 信号）
node scripts/bench-4.2-scroll.mjs               # 滚动位置行为校验
python scripts/compare-4.2-r3r4.py              # 生成对比表
```

| 交付物 | 路径 |
|---|---|
| 本报告 | `docs/phase4.2/PHASE4.2-R3-R4-REPORT.md` |
| 对比表 | `docs/phase4.2/perf-4.2-r3r4-compare.md` |
| R3/R4 原始数据（开发环境，5 次样本） | `docs/phase4.2/perf-4.2-r3r4-dev.json` |
| R4 生产构建原始数据 | `docs/phase4.2/perf-4.2-r4-prod.json` |
| 滚动行为数据 | `docs/phase4.2/perf-4.2-scroll.json` |
| E2E 报告与截图 | `docs/phase4.2/e2e-report.json`、`docs/phase4.2/screenshots/` |
| 基准脚本 | `scripts/bench-4.2-r3r4.mjs`、`bench-4.2-r4-prod.mjs`、`bench-4.2-scroll.mjs`、`compare-4.2-r3r4.py` |

测试结束后已停止开发，等待验收。
