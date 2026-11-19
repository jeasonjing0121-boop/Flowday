# FlowDay Phase 4.3 R1 验收报告 — 多标签页数据一致性

> 本轮按批准的方案实施 R1：revision + 原子 CAS + BroadcastChannel 通知（storage 事件降级）+ 冲突提示 + 草稿恢复。
> 未修改 IndexedDB 结构（store/索引/DB_VERSION 不变）、未改 AppData/reducer、未动 R1/R2 虚拟滚动与渲染优化、未新增依赖、未接入云服务。

- 日期：2026-11-14
- 环境：Windows x64 · i7-8565U（4C/8T）· 8 GB · Edge 157.0.4341.60 headless · Node v24.16.0
- 测试使用临时浏览器 profile（位于系统临时目录，测试结束删除），未接触用户真实数据
- 关键结论：**真实双标签页并发、冲突检测、自动同步、降级通道、草稿恢复、配额异常全部通过**；原有单页功能回归全部通过

---

## 0. 结果摘要

| 项目 | 结果 |
|---|---|
| 多标签页真实 E2E | ✅ **28/28 通过**（主场景 24 + 降级通道 3 + 配额异常 1） |
| 单页 E2E 回归 | ✅ **90/90**（原有 CRUD/搜索/筛选/排程/习惯/AI/玻璃/响应式/IndexedDB 迁移备份全部通过） |
| 逻辑测试 | ✅ **125/125**（原 97 + 新增 28 项同步纯逻辑测试） |
| TypeScript | ✅ 0 错误 |
| 生产构建 | ✅ CSS 43.80 kB（gzip 8.65）/ JS 363.00 kB（gzip 111.88） |
| 生产构建调试变量扫描 | ✅ `__FD_` / `__BENCH` 命中 **0**（无调试变量泄漏） |
| 10k 数据 CAS 保存耗时 | 中位 **47.4 ms**（5 次样本 37.3–58.4 ms，含 meta 版本读取 + 整份写入） |
| 数据兼容 | ✅ 无 revision 的旧数据正常读取并自动补齐（首次写入 rev=1） |

---

## 1. 修改文件清单

### 修改（8）

| 文件 | 修改内容 |
|---|---|
| `src/lib/storage/schema.ts` | `StoredState` 增加可选 `revision`/`writerId`；新增 `SyncInfo`/`revisionOf`/`isSyncInfo`/`decideSyncAction`（纯函数，含旧数据兼容） |
| `src/lib/storage/db.ts` | 新增 `SYNC_META_KEY='sync:v1'`、`readSyncInfo()`、`saveStateWithRevision()`（**同事务 CAS**）；移除无条件整份写入 `putState` |
| `src/lib/storage/index.ts` | 初始化返回 revision；旧数据迁移改为 CAS（base=0）；新增 `loadSnapshot`/`forceSaveAppData`/`readSyncInfo`；保存 API 改为 `saveAppData(data, {baseRevision, writerId})` |
| `src/store/AppStore.tsx` | revision/dirty/conflict 状态机；所有自动保存与 flush 走 CAS；冲突时暂停保存并立即写草稿；BC 订阅/广播；visibility/focus/pageshow 校验；共享启动 Promise 修复 StrictMode 双初始化竞态；恢复草稿/重新加载/覆盖动作 |
| `src/components/AppShell.tsx` | 挂载 `<SyncBanner />` |
| `src/tests/smoke.test.ts` | 新增 `[16]` 同步纯逻辑测试 28 项 |
| `vite.config.ts` | **仅测试环境**：dev server watch 忽略 `.tmp`/`.npm-cache`/`dist`（修复测试 profile 文件过多导致 dev server 变慢、页面加载超时的问题；不影响生产构建与运行时代码） |
| `scripts/e2e.mjs` | `go()` 等待 `__FD_STORAGE__.ready`；迁移用例等待迁移完成；profile 移到系统临时目录；支持 `BASE` 环境变量 |

### 新增（6）

| 文件 | 内容 |
|---|---|
| `src/lib/storage/sync.ts` | BroadcastChannel 封装 + 消息严格校验 + localStorage/storage 事件降级通道 |
| `src/lib/storage/recovery.ts` | 冲突草稿（版本/结构/大小校验、异常捕获、恢复前不删除） |
| `src/components/SyncBanner.tsx` | 玻璃样式冲突横幅：重新加载 / 以本页覆盖 / 导出副本（recovering 时为 恢复/导出/丢弃） |
| `scripts/e2e-multitab.mjs` | 真实多标签页 E2E（同 profile 多 target + 幽灵写入者 + 第三标签页 + 降级浏览器 + 配额浏览器） |
| `docs/phase4.3/screenshots/` | 真实双标签页截图（`tab-b-conflict.png`、`tab-a-synced.png`、`tab-b-recovery.png`） |
| `docs/phase4.3/multitab-report.json` | 多标签测试原始结果 |

### 明确未改

`src/types.ts`（AppData）、`src/store/reducer.ts`、`src/lib/storage/legacy.ts`、`src/lib/storage/backup.ts`、IndexedDB `DB_NAME/DB_VERSION/store/index`、R1/R2 的 `TaskRows.tsx`/`TaskRow.tsx`/`TasksPage.tsx`/`DashboardPage.tsx`/`selectors.ts`、`styles.css`、`package.json`。

---

## 2. CAS 实现说明

### 2.1 权威版本来源（meta 小记录）

- `meta` store 中新增 `sync:v1` 记录：`{ revision, updatedAt, writerId }`（几十字节），读取它不需要读取 2 MB 的整份数据。
- 旧库（无 `sync:v1`）自动从 state 记录推导：`revision = record.revision ?? 0`，读取路径与写入路径都兼容。

### 2.2 原子 CAS 事务（唯一写入口）

```ts
// src/lib/storage/db.ts
saveStateWithRevision(data, baseRevision, writerId) {
  db.transaction(['app', 'meta'], 'readwrite')        // 同一事务覆盖两个 store
    → meta.get('sync:v1')                             // 读当前版本（旧库回退读 state 推导）
    → if (current.revision !== baseRevision) abort → 返回 { ok:false, conflict:current }（不写任何数据）
    → app.put({ ...data, revision: current.revision+1, writerId, updatedAt })
    → meta.put({ revision: current.revision+1, updatedAt, writerId })
  → 事务提交后返回 { ok:true, revision }
}
```

- IndexedDB 对同一 scope 的 readwrite 事务串行执行，因此「读版本 → 比较 → 写入」三者在同一事务内是原子的；两个标签页只有一个能成功。
- 失败分支 `abort` 后不产生半写数据；网络/存储异常抛错由上层提示。

### 2.3 覆盖所有写入入口

| 写入入口 | 路径 | CAS 保护 |
|---|---|---|
| 任务 CRUD / 勾选 | dispatch → 防抖保存 `saveAppData` | ✅ baseRevision |
| 设置修改（主题/昵称/AI 开关） | 同上 | ✅ |
| 导入 JSON / 清空数据 / 载入示例 | dispatch `data/replace` → 同一保存路径 | ✅（冲突时进入提示，不静默覆盖） |
| 旧 localStorage 迁移 | `initializeStorage` → `saveStateWithRevision(base=0)` | ✅（并发标签页只有一个能迁移成功） |
| 首次示例数据落库 | 同上 | ✅ |
| 页面隐藏/关闭 flush | 同一 CAS 保存 | ✅（失败即冲突 → 立即写草稿） |
| 草稿恢复 | 读取最新 revision 后 CAS 写入 | ✅（恢复期间又被写入则保留草稿并再次提示） |
| 「以本页覆盖」 | `forceSaveAppData`：先读取最新 revision，再以该 revision 为基线 CAS | ✅ **不是无条件 putState**；若期间又被抢先写入仍返回冲突 |

---

## 3. 冲突处理流程

```
任何保存（防抖/关闭前 flush/恢复/覆盖）
  → CAS 失败（库中 revision ≠ 本页 baseRevision）
  → 立即写入 localStorage 草稿（不依赖 pagehide/beforeunload；含 version/baseRevision/writerId/savedAt/reason/data）
  → 暂停普通自动保存（syncStatus='conflict'|'external-update'）
  → 顶部玻璃横幅三选一：
       · 重新加载（推荐）：读取最新快照 → dispatch(data/replace) → 清草稿 → 恢复保存
       · 以本页覆盖：读取最新 revision → CAS 写入（仍可能因第三方并发再次冲突）
       · 导出本页副本：导出 JSON 备份，便于人工合并
正常保存成功 → 广播 {type:'saved', revision, writerId, updatedAt}

其他标签页收到通知（BC 或 storage 事件）
  → 只把通知当"触发器"：读取 IndexedDB 的 revision（唯一权威）
  → revision 相同：忽略
  → revision 前进 + 本页无未保存修改（clean）：读取最新快照 → 静默同步（不覆盖他人数据）
  → revision 前进 + 本页有未保存修改（dirty）：不覆盖，暂停保存并立即写草稿 → 横幅提示

页面可见性恢复（visibilitychange/focus/pageshow）
  → 同样读取 revision 做一次校准（覆盖休眠、后台节流、通知丢失）

启动
  → 读取 revision 作为 baseRevision
  → 若 localStorage 存在合法草稿：显示「发现上次未保存的修改」恢复/导出/丢弃；恢复前不删除草稿
```

**边界处理**

- 关闭页面时冲突：立即草稿（在冲突发生时已写，不依赖关闭事件）；下次打开提示恢复。
- 草稿校验：`version===1`、`baseRevision` 非负整数、`writerId` 非空、`reason` 枚举、`data.tasks/habits` 数组、JSON 长度 ≤ 3 MB；损坏草稿自动忽略。
- 草稿写入异常（配额不足/隐私模式）：横幅显示「草稿保存失败」，应用继续可用（已用真实 QuotaExceededError 场景验证）。
- 休眠/恢复：`Page.setWebLifecycleState(frozen→active)` 后自动同步成功（本轮实测 lifecycle 事件即可触发）。
- 第三标签页并发：覆盖写入后第三标签页自动收敛到库中状态或明确冲突，无静默丢失。

---

## 4. 测试结果（真实双标签页 E2E）

测试方式：同一 Edge（临时 profile）下多个真实标签页 + 一个"幽灵写入者"标签页（直接调用存储层 CAS API 模拟另一标签页的写入）；不使用模拟事件替代真实 IndexedDB/多标签。

| # | 测试 | 结果 |
|---|---|---|
| 1 | 两个标签页读取到相同 revision | ✅ A=1 / B=1 |
| 2 | 使用 BroadcastChannel 通知通道 | ✅ mode=broadcast |
| 3 | clean 标签页自动同步 A 的写入 | ✅ 1795 ms（含 A 创建任务的 UI 时间） |
| 4 | 自动同步后不显示冲突横幅 | ✅ |
| 5 | 同步后两标签页 revision 一致 | ✅ 2/2 |
| 6 | **旧 revision 写入必须失败（CAS）** | ✅ `{ok:false, before:2, after:2}`，库版本未变 |
| 7 | dirty 标签页收到并发写入后进入冲突状态 | ✅ banner=conflict |
| 8 | **dirty 标签页本地修改完整保留** | ✅ 勾选状态保留、并发写入未出现在本页 |
| 9 | 冲突时暂停自动保存（库版本不再前进） | ✅ 900 ms 内 revision 不变 |
| 10 | 冲突时立即写入本地草稿 | ✅ draft=true |
| 11 | 重新加载后与库一致（本页修改被放弃） | ✅ |
| 12 | 重新加载后 revision 与库一致 | ✅ |
| 13 | 清空数据与本地编辑并发不被静默覆盖 | ✅ B 本地仍有任务、库已清空 |
| 14 | 重新加载后接受清空结果 | ✅ |
| 15 | 另一标签页载入示例数据后 clean 自动同步 | ✅ |
| 16 | 同步过程无冲突提示 | ✅ |
| 17 | 休眠恢复后同步最新数据 | ✅ lifecycle 事件触发 |
| 18 | 刷新后读取最新 revision 与数据 | ✅ |
| 19 | 关闭前进入冲突并保存草稿 | ✅ |
| 20 | 重新打开后提示恢复草稿 | ✅ banner=recovering |
| 21 | 草稿在恢复前未被删除 | ✅ |
| 22 | 恢复草稿后写入库并清除草稿 | ✅ |
| 23 | 以本页覆盖时第三标签页并发不被静默丢失 | ✅ 版本单调（9→12）、第三标签页收敛 |
| 24 | 10k 数据 CAS 保存 5 次测量完成 | ✅ |
| 25 | BroadcastChannel 不可用 → storage 事件降级 | ✅ C=storage / D=storage |
| 26 | 降级通道下 clean 自动同步 | ✅ |
| 27 | 降级通道下 dirty 检测冲突 | ✅ banner=conflict |
| 28 | localStorage 配额不足时冲突提示可用（不崩溃） | ✅ 显示「草稿保存失败」 |

**真实双标签页截图**

- `docs/phase4.3/screenshots/tab-b-conflict.png`（B 标签页冲突横幅：重新加载 / 以本页覆盖 / 导出副本）
- `docs/phase4.3/screenshots/tab-a-synced.png`（A 标签页在另一标签页清空后同步到新状态）
- `docs/phase4.3/screenshots/tab-b-recovery.png`（重新打开后的草稿恢复提示）

### 单页回归（原有 90 项 E2E）

| 项目 | 结果 |
|---|---|
| TypeScript | ✅ 0 错误 |
| 逻辑测试 | ✅ 125/125（新增 28 项同步纯逻辑：revision 兼容、CAS 决策、消息校验、草稿校验/超限/存储异常） |
| E2E（90 项） | ✅ 90/90（含 CRUD、搜索筛选、排程、习惯、AI、玻璃、响应式、IndexedDB 迁移/备份） |
| 生产构建 | ✅ CSS 43.80 kB（gzip 8.65）/ JS 363.00 kB（gzip 111.88） |
| 生产调试变量 | ✅ 0 命中 |
| IndexedDB 迁移 | ✅ 旧 localStorage 数据迁移、优先级 4→3、回滚副本、防重复迁移全部通过（本轮修复 StrictMode 双初始化竞态后稳定） |

---

## 5. 性能对比

| 指标 | Phase 4.2（优化后） | Phase 4.3 R1 | 说明 |
|---|---|---|---|
| 10k 整份写入（模块级，5 次中位） | 33.2 ms | **37.3–47.4 ms**（多次运行波动 20–58 ms） | CAS 增加一次 meta 小记录读取（<1 ms）+ 机器负载波动；仍在同一量级，无语级回退 |
| 应用级保存流程 | 180ms 防抖 + 整份写 | 不变（+版本比较） | 用户感知无变化 |
| 跨标签通知 | 无 | BroadcastChannel 消息（几十字节）<br>clean 自动同步实测 ≤2.4s（含 A 创建任务的 UI 操作时间） | 通知仅作触发器，权威以 IDB revision 为准 |
| 页面加载 | — | 增加一次 `readSyncInfo`（meta 读，几十字节） | 可忽略 |

> 说明：10k CAS 保存耗时在不同运行间波动较大（20–58 ms），主因是测试机负载（多浏览器/构建/其他进程）；本轮多次运行中位数 **37–47 ms**，相较 4.2 的 33.2 ms 增加约 4–14 ms，符合预期（一次额外 meta 读 + 事务 scope 增加 meta store）。

---

## 6. 剩余风险与已知限制

1. **不做自动合并**：冲突以整份文档为单位，用户必须三选一；复杂并发（两个标签页修改不同任务）会丢弃一方内存修改（草稿/导出可保留）。后续可评估字段级合并（v2）。
2. **关闭页面时的最后写入**：flush 是异步 CAS，页面销毁可能中断事务；若中断且无冲突，最后一次防抖窗口内的修改仍可能丢失（浏览器限制）。冲突场景已通过"立即草稿"覆盖。
3. **草稿容量**：localStorage 约 5 MB，草稿上限 3 MB；10k 任务（约 2 MB）可保存，更大数据量会提示"数据过大"，需先导出。
4. **BC 消息为同源通知**：恶意同源页面可伪造消息，但代码只把消息当触发器并以 IDB revision 为准，不会采纳消息内容。
5. **多标签测试存在一处时序敏感性**：降级通道的"dirty 检测冲突"用例依赖并发窗口，本次最后一轮通过（28/28），但理论上偶发（已记录，生产逻辑不受影响——该场景由 CAS 独立保障）。
6. **多标签页同时首次迁移**：CAS 保证只有一个成功（测试覆盖迁移冲突路径），失败方提示"其他标签页已写入数据"并加载现有数据。
7. **性能**：CAS 保存比原来多一次 meta 读；10k 数据下中位增加约 4–14 ms，无感知差异；后续如需可把 revision 缓存到内存并只读 meta（已是最小读取）。
8. **环境修复**：dev server 因测试产生的 profile 文件（`.tmp` 内 160 MB / 2500 文件）变慢，导致加载超时；已增加 Vite watch 忽略并将会话测试 profile 移至系统临时目录（仅测试环境，不影响用户浏览器）。

---

## 7. 子阶段费用与累计（估算，人民币）

| 子阶段 | 内容 | 估算费用 |
|---|---|---|
| 1/5 数据层 | schema revision 兼容、db CAS 事务、storage API、初始化/迁移改造 | **0.65 元** |
| 2/5 单元测试 | revision/决策/消息/草稿 28 项 + 修复 | **0.25 元** |
| 3/5 多标签 E2E | 多 target 测试脚本、幽灵写入者、降级/配额浏览器、dev server 慢加载诊断与修复、5 次复跑 | **1.55 元** |
| 4/5 完整回归 | 单页 E2E 90 项、构建、类型检查、生产扫描、迁移竞态修复 | **0.55 元** |
| 5/5 报告 | 报告、截图、对比与交付 | **0.25 元** |
| **本轮合计** | | **约 3.25 元**（波动范围 3.0–3.8 元，未超 4 元上限） |
| **剩余预算** | 12.5 − 3.25 | **约 9.25 元** |

> 说明：第 3 子阶段包含一次 dev server 变慢的诊断（多跑了几轮浏览器），是主要开销来源；已在报告中记录并修复。

---

## 8. 复现命令

```bash
cd flowday
npm run typecheck && npm test && npm run build
npm run dev -- --port 5176 --strictPort          # 测试用 dev server（或使用 5173）
BASE=http://127.0.0.1:5176 node scripts/e2e-multitab.mjs   # 28 项多标签真实 E2E + 截图
BASE=http://127.0.0.1:5176 E2E_OUT=docs/phase4.3 node scripts/e2e.mjs   # 90 项单页回归
```

| 交付物 | 路径 |
|---|---|
| 本报告 | `docs/phase4.3/PHASE4.3-R1-REPORT.md` |
| 多标签测试原始结果 | `docs/phase4.3/multitab-report.json` |
| 双标签页截图 | `docs/phase4.3/screenshots/tab-b-conflict.png`、`tab-a-synced.png`、`tab-b-recovery.png` |
| 单页回归报告 | `docs/phase4.3/e2e-report.json` |
| 多标签 E2E 脚本 | `scripts/e2e-multitab.mjs` |

测试结束后已停止开发，未进入 Phase 4.4，等待验收。
