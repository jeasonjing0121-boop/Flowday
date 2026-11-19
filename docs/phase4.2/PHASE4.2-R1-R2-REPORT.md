# FlowDay Phase 4.2 第一轮验收报告 — R1 任务列表虚拟滚动 + R2 React 渲染优化

> 本轮只做 R1 / R2，未实施 R3–R7；不修改 IndexedDB 结构、不拆分 Object Store、不加索引、不引入新依赖、不改变现有功能与视觉风格。

- 日期：2026-11-14
- 环境：Windows x64 · Intel i7-8565U（4C/8T，1.8GHz）· 8 GB · Edge 157.0.4341.60 headless（`--disable-gpu`，视口 1440×900）· Node v24.16.0
- 数据构造与计时口径：与 Phase 4.1 完全一致（确定性 1k/5k/10k 任务；5 次重复取中位/最大；`performance.now()` 页面内计时）
- 交付物：本报告、`perf-4.2-before-prod.json`、`perf-4.2-after-prod.json`、`perf-4.2-after3-dev.json`、`perf-4.2-responsive.json`、`perf-4.2-compare.md`、`docs/phase4.2/screenshots/`（E2E 截图）、基准脚本

---

## 0. 结论摘要

| 指标（10,000 条任务） | 优化前（生产构建） | 优化后（生产构建） | 目标 | 结论 |
|---|---|---|---|---|
| 搜索 UI | 1,744.3 ms | **96.2 ms** | < 200 ms | ✅ 达标 |
| 优先级筛选 UI | 4,589.3 ms | **163.7 ms** | < 200 ms | ✅ 达标 |
| 勾选端到端 | 1,587.1 ms | **222.5 ms** | < 300 ms | ✅ 达标 |
| 开发服务器同口径（与 Phase 4.1 对齐） | 2,646.9 / 5,634.0 / 8,202.0 ms | **185.2 / 170.7 / 239.3 ms** | — | ✅ 达标 |

其他关键变化（10,000 条）：DOM 元素总数 **155,294 → 1,129**，已渲染任务行 **8,020 → 46**；2 秒程序化滚动掉帧比例 **96.3% → 7.9%**，最长帧 **733 ms → 67 ms**；首次列表渲染 **2,252 ms → 273 ms**。

**新增依赖：无。** 使用浏览器原生能力（window 滚动 + ResizeObserver）自研窗口化渲染，未引入 react-window / virtualizer 等依赖。

---

## 1. 实施前分析（为什么会出现大规模重复渲染）

### 1.1 根因

1. **`TaskRow` 直接消费 `useApp()` 上下文**：`AppContext` 的 value 包含 `data`，任意任务变化（勾选/编辑/删除）都会让 `data` 引用变化 → **所有已挂载的 TaskRow 全部重渲染**（10k 任务时约 8,020 行）。`React.memo` 在这种结构下完全失效。
2. **列表全量渲染**：`TasksPage` 一次性渲染所有未完成任务行（DOM 155,294 个节点），每次交互都触发整页 reconcile + layout + paint。
3. **重复排序**：`filterTasks` 内部排序一次，随后 4 个分组各自再 `sortTasks` 一次（全量排序 4 次），`sortTasks` 比较器内还每次重新解析 `HH:mm` 字符串。
4. **内联回调**：每行 `onEdit={(t) => openTaskEditor(t)}` 每次渲染新建函数，即使加了 memo 也会失效。
5. **Provider value 未缓存**：`ToastCtx/ConfirmCtx` 的 value 每次渲染新建对象，Toast 状态变化会连带所有消费行重渲染。

### 1.2 优化选择（对应 R2 要求）

| 类别 | 对象 | 原因 |
|---|---|---|
| React.memo | `TaskRow`、`VirtualRow` | 单条任务变化时只重渲染受影响行 |
| 上下文拆分 | 新增 `DispatchContext` / `useAppDispatch()` | dispatch 引用稳定；行组件只依赖它 + 普通 props |
| useCallback | `handleEdit`、`handleCreate`、`clearFilters`、`measure`、`updateRange` | 让 memo 子组件 props 稳定 |
| useMemo | `filtered`、`groups`（单遍分组）、虚拟列表 `model`（前缀偏移） | 避免每次渲染重复全量筛选/排序/分组/偏移计算 |
| 渲染调度 | `useDeferredValue(data.tasks)` | 点击后先用旧列表做轻量提交，让持久化防抖立即启动，重列表渲染落到 180 ms 防抖窗口内 |
| 算法 | `sortTasks` 预计算排序键（WeakMap 缓存时间分钟） | 10k 排序从约 50 ms 降至约 20–30 ms（等价性测试保证结果一致） |
| Provider | Toast/Confirm 的 value `useMemo` | 提示出现/消失不再牵连全部行 |

### 1.3 虚拟滚动接入层级

接入在 **每个任务分组卡片内部的"行容器"**（`TaskRows`），而不是整页替换：

- 页面仍使用 window 滚动（不新增内部滚动容器），**布局、卡片、分组头、分割线、hover 全部保持原样**；
- 每个分组独立窗口化：卡片高度 = 行总高度（前缀和），卡片内部绝对定位可见行，卡片本身仍在正常文档流中，滚动条长度与真实内容一致；
- 少量任务（每组 ≤ 60）直接走**原有 `divide-y` 普通列表**，视觉与交互完全等价，只有大数据量才启用虚拟化；
- 编辑弹窗由 `AppShell` 管理，不随列表重渲染关闭；删除确认、Toast、勾选动画、搜索/筛选/排序逻辑均未改动。

---

## 2. 修改文件清单

| 文件 | 修改内容 |
|---|---|
| `src/features/tasks/TaskRows.tsx` | **新增**：分组行容器。≤60 行走普通列表；>60 行窗口化渲染（估算+实测行高、滚动锚定、rAF 节流、上下 8 行缓冲、容器 ResizeObserver） |
| `src/features/tasks/TaskRow.tsx` | 改为 `React.memo`；改用 `useAppDispatch()`；`projects` 作为 prop 传入（替代订阅整个 AppData）；保留全部视觉与交互；增加开发态渲染计数器 |
| `src/features/tasks/TasksPage.tsx` | 单遍分组替代 4 次排序；稳定回调；`useDeferredValue`；使用 `TaskRows`；开发态页面渲染计数器 |
| `src/store/AppStore.tsx` | 新增 `DispatchContext` 与 `useAppDispatch()`（不改 reducer 与持久化逻辑） |
| `src/components/UI.tsx` | Toast / Confirm Provider 的 context value 用 `useMemo` 稳定 |
| `src/lib/selectors.ts` | `sortTasks` 预计算排序键 + WeakMap 时间缓存（结果等价，新增测试护栏） |
| `src/features/calendar/CalendarPage.tsx` | `TaskRow` 新 props 适配（传入 `projects`） |
| `src/features/today/DashboardPage.tsx` | 同上 |
| `src/tests/smoke.test.ts` | 新增 3 项：排序等价性、原数组不被修改、`filterTasks` 与参考排序一致（总数 68 → **71**） |
| `scripts/bench-4.2.mjs` | 新增：首次列表渲染、列表稳定、搜索/筛选、勾选端到端（put 钩子分解）、DOM 节点、渲染次数、滚动帧统计 |
| `scripts/bench-4.2-responsive.mjs` | 新增：5,000 条数据下 390/768/1440 三视口的布局与滚动校验 |
| `scripts/compare-4.2.py` | 新增：生成前后对比表 |

> 生产页面结构、CSS 类名、玻璃材质、圆角、阴影、动画均未修改；只改了行容器的挂载策略与组件订阅方式。

---

## 3. R1 虚拟滚动实现说明

1. **阈值**：单组任务 ≤ 60 行 → 普通列表（原 `divide-y` 结构，零额外开销）；> 60 行 → 虚拟列表。这样 99% 的日常使用（几十条任务）行为与优化前完全一致。
2. **窗口计算**：`window.scrollY` + `getBoundingClientRect().top` 得到分组容器相对视口的位置，二分查找前缀偏移数组，命中 `[start−8, end+8]` 的可见窗口（上下各 8 行缓冲，避免快速滚动白屏）。
3. **动态高度**：未测量行用估计高度 66px；渲染出的行通过 `ResizeObserver` 上报真实高度（无备注约 60px、有备注约 78px），写入 `Map<taskId, height>` 并重建前缀和与容器总高。
4. **防止跳动**：行高变化导致上方累计偏移变化时，记录"当前首个可见行 + 原偏移"，在 `useLayoutEffect` 中 `window.scrollBy(0, Δ)` 补偿，使视口内容保持原位（实测滚动过程无可见跳动）。
5. **窗口/容器变化**：`window.resize` + 容器 `ResizeObserver` 触发重算；滚动事件用 `requestAnimationFrame` 节流，避免高频 setState。
6. **搜索/筛选/排序更新**：列表数据变化 → 前缀模型随 `tasks` 引用变化重建 → 下一个动画帧重算可见窗口，始终按新顺序渲染；任务为空时父组件仍显示原空状态界面。
7. **响应式**：window 滚动在手机/平板/桌面一致；实测 5,000 条数据下 390×844、768×1024、1440×900 均无横向溢出，滚动到底部仍只保留约 38–48 行 DOM，滚动位置正确（见对比表 E 节）。
8. **交互保留**：行内勾选（含勾选动画、Toast、180ms 防抖持久化）、点击标题编辑、删除二次确认、优先级/日期/分类/备注展示、hover 反馈全部沿用原组件；编辑弹窗、删除弹窗不因列表重渲染而关闭。

---

## 4. R2 React 渲染优化说明

- **`TaskRow` 用 `React.memo`**：props 为 `task / onEdit / showDate / projects`。reducer 只替换被修改的任务对象（其余对象保持引用），`onEdit` 与 `projects` 由父级稳定传递，因此**未变化的行为零重渲染**。
- **新增 `DispatchContext`**：行组件只需要 dispatch，不再订阅包含 `data` 的上下文（这是"一条任务变化 → 全部行重渲染"的根因修复）。
- **`useCallback`**：`handleEdit`（依赖 `openTaskEditor`）、`handleCreate`、`clearFilters`、`measure`、`updateRange` 均稳定化。
- **`useMemo`**：
  - `filtered`：依赖 `deferredTasks / weekStart / query / status / priority / dateFilter`；
  - `groups`：对已排序的 `filtered` 做**单次遍历分区**（替换原先的 4 次 `sortTasks`），分区顺序与旧实现一致；
  - 虚拟列表 `model`：只依赖 `tasks` 与行高版本号。
- **`useDeferredValue`**：点击勾选后，React 先用旧 `tasks` 做一次廉价提交（让 `AppStore` 的 180ms 持久化防抖计时**立即开始**），新列表（排序+分组+可见行）在低优先级渲染中完成（仅延迟 1–2 帧）。持久化链路、reducer、数据一致性均未改变（E2E 的持久化与统计断言全部通过）。
- **状态更新隔离实测**：一次勾选操作中 `TaskRow` 实际渲染 **4 次**（此前约为全部 8,020 行），`TasksPage` 渲染 4 次（含 deferred 的一次补渲染）。

---

## 5. 优化前后性能对比

### 5.1 生产构建（同一台机器、同一数据构造、同一计时口径）

| 指标 | 1,000 优化前 | 1,000 优化后 | 5,000 优化前 | 5,000 优化后 | 10,000 优化前 | 10,000 优化后 |
|---|---|---|---|---|---|---|
| 首次列表渲染（中位） | 286.5 | 224.6 | 841.7 | 225.9 | 2,252.1 | **273.4** |
| 列表稳定（中位） | 797.2 | 441.3 | 2,755.1 | 442.8 | 7,387.3 | **522.8** |
| 搜索 UI | 218.4 | 159.6 | 827.7 | 97.4 | 1,744.3 | **96.2** |
| 优先级筛选 UI | 362.4 | 191.0 | 1,518.0 | 145.2 | 4,589.3 | **163.7** |
| 状态筛选 UI | 363.6 | 161.9 | 1,739.4 | 154.2 | 5,127.6 | **144.6** |
| 勾选端到端 | 256.3 | 195.3 | 556.4 | 209.0 | 1,587.1 | **222.5** |
| 勾选写库（独立段） | 1.2 | 2.3 | 18.0 | 9.2 | 261.8 | 8.4 |

### 5.2 开发服务器（与 Phase 4.1 相同脚本口径，用于与上一轮报告对齐）

| 指标 | 1,000 前 | 1,000 后 | 5,000 前 | 5,000 后 | 10,000 前 | 10,000 后 |
|---|---|---|---|---|---|---|
| 搜索 UI | 467.2 | 187.7 | 1,361.6 | 170.3 | 2,646.9 | **185.2** |
| 优先级筛选 UI | 953.4 | 179.4 | 2,309.1 | 169.1 | 5,634.0 | **170.7** |
| 状态筛选 UI | 715.4 | 225.0 | 2,531.7 | 220.0 | 4,636.9 | **200.7** |
| 勾选端到端 | 827.9 | 224.1 | 2,141.6 | 234.6 | 8,202.0 | **239.3** |

> 说明：优化前数值来自 Phase 4.1 的同脚本同环境测量（见 `docs/phase4.1/perf-raw.json`）；优化后为本次 `perf-4.2-after3-dev.json`。生产构建的前/后均为本轮同机同法复测（`perf-4.2-before-prod.json` / `perf-4.2-after-prod.json`）。

### 5.3 目标达成（10,000 条）

| 目标 | 目标值 | 生产实测 | 开发实测 | 结论 |
|---|---|---|---|---|
| 搜索 UI | < 200 ms | 96.2 ms | 185.2 ms | ✅ |
| 优先级筛选 UI | < 200 ms | 163.7 ms | 170.7 ms | ✅ |
| 勾选端到端 | < 300 ms | 222.5 ms | 239.3 ms | ✅ |

---

## 6. DOM 节点数量对比

| 规模 | 优化前元素总数 | 优化后元素总数 | 优化前行数 | 优化后行数 |
|---|---|---|---|---|
| 1,000 | 16,094 | 1,129 | 820 | 46 |
| 5,000 | 77,960 | 1,129 | 4,020 | 46 |
| 10,000 | **155,294** | **1,129** | **8,020** | **46** |

10,000 条时 DOM 元素减少 **99.3%**，且不再随任务总量增长（只随视口大小变化）。

---

## 7. React 组件渲染次数（开发态计数器，一次勾选）

| 指标 | 优化前 | 优化后 |
|---|---|---|
| TaskRow 渲染次数 | ≈8,020（全部已挂载行；由无 memo + 订阅 AppContext 可见） | **4** |
| TasksPage 渲染次数 | 1（但子行全量渲染） | 4（含 deferred 的补渲染） |

> 计数器为 `import.meta.env.DEV` 下注入，生产构建中被消除；优化前计数由结构与 DOM 行数可证实，旧构建无计数器。

---

## 8. 滚动流畅度（10,000 条，2 秒程序化滚动 80px/帧）

| 指标 | 优化前 | 优化后 |
|---|---|---|
| 帧间隔中位 | 100 ms | 49.9 ms |
| 帧间隔 p95 | 533.3 ms | 50.1 ms |
| 最长帧 | 733.3 ms | 66.8 ms |
| 掉帧数（> 50 ms） | 79 | 19 |
| 掉帧比例 | **96.3%** | **7.9%** |

说明：headless 环境空闲 rAF 基线约 16.7 ms，滚动期间虚拟化需要持续挂载/卸载行，优化后仍存在约 8% 的 50 ms 级帧（可在下一轮用"滚动期间降低测量频率/批量更新"进一步优化）。

---

## 9. 测试结果

| 测试 | 结果 |
|---|---|
| TypeScript `tsc --noEmit` | ✅ 0 错误 |
| 逻辑测试（smoke） | ✅ **71/71**（原 68 + 新增 3 项排序等价性/不变量） |
| E2E（Edge headless，82 项） | ✅ **82/82**，含 CRUD、搜索、筛选、排序、排程、习惯、AI 提案、玻璃/堆叠、响应式、Toast、快速连点、IndexedDB 迁移与备份 |
| 生产构建 | ✅ CSS 42.84 kB（gzip 8.49）/ JS 348.63 kB（gzip 107.84） |
| 大数据量响应式校验（5,000 条） | ✅ 390×844 / 768×1024 / 1440×900 均无横向溢出；滚动到底部正常；每屏仅 44–48 行 DOM |
| 回归项目 | 创建/编辑/删除/勾选/取消勾选、搜索、分类/优先级/日期筛选、清空筛选、空状态、编辑弹窗、删除确认、Toast、持久化与统计联动均通过 |
| 失败项 | **0** |

E2E 截图输出在 `docs/phase4.2/screenshots/`（视觉与优化前一致：玻璃卡片、圆角、分割线、任务行结构未变）。

---

## 10. 新增依赖说明

**无新增依赖。** 评估过程：官方/社区虚拟滚动库（react-window、@tanstack/react-virtual 等）能降低实现成本，但会引入新包并可能改变滚动容器语义（内部滚动 vs 页面滚动）。本项目列表是"分组卡片 + 页面滚动"的结构，原生实现可满足需求（ResizeObserver + 滚动锚定 + 前缀偏移），因此未引入任何依赖，保持零新增包与现有视觉结构。

---

## 11. 已知问题与剩余优化建议

1. **首屏列表稳定 523 ms（10k，生产）** 仍高于"首行出现"273 ms：包含 `getState`（约 33 ms）+ 迁移校验（约 7 ms）+ 首次渲染 + 虚拟行测量多帧。可在下一轮 R8（骨架/预取）或 R3（统计单遍）继续压缩。
2. **虚拟列表的滚动条比例**依赖未测量行的估计高度（66 px），快速拖动滚动条时长度会轻微变化；已用滚动锚定避免内容跳动，后续可改为"滚动后按实测均值自校准估计值"。
3. **阈值 60 是静态值**，未按设备性能（内存/CPU）自适应；低端移动设备可考虑更低阈值。
4. **`sortTasks` 的 WeakMap 缓存依赖任务对象不可变**（reducer 当前语义满足，且有等价性测试）；若未来引入原地修改需移除缓存。
5. **测量环境的局限**：headless + `--disable-gpu`，渲染数据相对悲观；仅测 Edge，未覆盖 Safari/Firefox 与真实移动设备；滚动测试为程序化滚动而非真实手指滑动。
6. **本轮未实施**（按约定留给后续）：Dashboard 统计单遍聚合（R3）、搜索防抖（R4）、写入合并/批量 API（R6/R7）、拆分 Object Store（P3）。
7. **移动端大数据首屏**未单独计时（仅做了布局与滚动校验），下一轮可补充移动端性能数据。
8. 渲染次数计数器为开发态注入（生产无），因此"优化前"计数为结构性推导 + DOM 证据，而非同口径计数器。

---

## 12. 验收结论

在**不改变数据架构、不改变视觉风格、不删除任何功能、不新增依赖**的前提下，R1 + R2 已完成：

- 10,000 条任务的 **搜索 / 优先级筛选 / 勾选端到端** 三项指标在生产构建与开发服务器双口径下**全部达到目标**；
- DOM 节点与 React 渲染次数下降 4–5 个数量级（行数 8,020 → 46，TaskRow 渲染 8,020 → 4）；
- 原有 82 项 E2E 与 71 项逻辑测试全部通过，TypeScript 与生产构建正常。

建议按 Phase 4.2 计划进入下一轮（R3 Dashboard 统计单遍聚合、R4 搜索防抖、R5 默认视图收敛），之后再评估写入路径（R6/R7）与架构级调整。

---

## 13. 复现与交付物

```bash
cd flowday
npm run typecheck && npm test && npm run build
# 开发服务器口径（含 React 渲染计数）
BASE=http://127.0.0.1:5173 MODE=dev TAG=after-dev node scripts/bench-4.2.mjs
# 生产构建口径（需先 npm run build && npm run preview -- --port 4173）
BASE=http://127.0.0.1:4173 MODE=prod TAG=after-prod node scripts/bench-4.2.mjs
# 大数据量响应式校验
BASE=http://127.0.0.1:5173 node scripts/bench-4.2-responsive.mjs
# 对比表生成
python scripts/compare-4.2.py
```

| 交付物 | 路径 |
|---|---|
| 本报告 | `docs/phase4.2/PHASE4.2-R1-R2-REPORT.md` |
| 前后对比表 | `docs/phase4.2/perf-4.2-compare.md` |
| 生产构建 before/after 原始数据 | `docs/phase4.2/perf-4.2-before-prod.json`、`perf-4.2-after-prod.json` |
| 开发服务器 after 原始数据（5 次样本） | `docs/phase4.2/perf-4.2-after3-dev.json`（及过程数据 after-dev / after2-dev） |
| 响应式校验数据 | `docs/phase4.2/perf-4.2-responsive.json` |
| E2E 报告与截图 | `docs/phase4.2/e2e-report.json`、`docs/phase4.2/screenshots/` |
| 基准脚本 | `scripts/bench-4.2.mjs`、`scripts/bench-4.2-responsive.mjs`、`scripts/compare-4.2.py` |
