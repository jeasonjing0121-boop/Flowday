# FlowDay Phase 4.3 方案审查 — 多标签页数据一致性

> 本轮为 **Plan 模式审查**：只读分析 + 方案设计，**未修改任何生产代码**、**未运行实现性测试**、**未消耗实施预算**。
> 建议实施阶段：Phase 4.3 R1（预算上限 4 元，见第 8 节拆分方案）。

- 审查日期：2026-11-14
- 审查对象：FlowDay v0.3.0（IndexedDB 单文档架构 + Phase 4.2 R1–R4 优化后）
- 相关文件：`src/store/AppStore.tsx`、`src/lib/storage/{db,index,schema}.ts`、`src/lib/storage/legacy.ts`、`src/features/settings/SettingsPage.tsx`、`src/store/reducer.ts`
- 当前剩余预算：12.5 元；下一实施阶段上限：4 元

---

## 1. 当前架构与写入流程分析（只读确认）

### 1.1 读取/初始化

```
App 启动
  → AppProvider useEffect
  → initializeStorage()（src/lib/storage/index.ts:27）
      → getState()            // 读取 app store 中 key="state" 的整份记录（含 data 全文）
      → migrateStoredState()  // schemaVersion 校验 + 数据规范化
      → 旧数据迁移（若 meta 标记不存在）
  → dispatch(data/replace) → 各标签页各自持有一份独立的内存 AppData
```

### 1.2 写入

```
dispatch(Action)
  → reducer 生成新的 AppData（整份对象）
  → AppStore useEffect([data])（AppStore.tsx:89）
  → 180ms 防抖
  → saveAppData(data)（storage/index.ts:81）
  → putState(data)（db.ts:101）
      → 新建 readwrite 事务（单 store "app"）
      → 整份记录 {schemaVersion, updatedAt, data} 覆盖写 key="state"
  → 页面隐藏/关闭：pagehide / visibilitychange(hidden) 再补写一次（AppStore.tsx:102-116）
```

### 1.3 关键事实

| 项目 | 现状 |
|---|---|
| 数据版本号 / 修订号 | **没有**。`StoredState` 只有 `schemaVersion`（结构版本）与 `updatedAt`（信息性时间戳，不参与比较） |
| 写入前版本校验 | **没有**。`putState` 直接整份覆盖 |
| 跨标签页通知 | **没有**。全仓库无 `BroadcastChannel` / `storage` 事件 / `navigator.locks` 使用 |
| 并发控制 | 无。IDB 事务串行只保证单次写入原子，不保证"读-改-写"不被其它标签页插入 |
| 每标签内存状态 | 独立。打开后不再与库同步（除刷新） |
| 覆盖写入口 | 自动保存、pagehide flush、导入备份、清空数据、载入示例（Settings 的 `data/replace` → 走同一防抖保存） |
| 数据量 | 整份记录 10k 任务 ≈ 2.05 MB；单次整份写 33–54 ms，读取 31–33 ms |
| 写入频率 | 每次"已提交状态变化"一次整份写；连续操作由 180ms 窗口合并 |

**结论：当前是典型的"整份文档 + 最后写入者获胜（LWW）"模型，且没有任何版本校验与跨标签通知，多标签同时使用时存在静默丢数据风险。**

---

## 2. 冲突场景与风险等级

| 编号 | 场景 | 过程 | 后果 | 风险 |
|---|---|---|---|---|
| S1 | 两标签分别编辑不同任务 | A 新建任务 → 写入；B（仍持旧快照）勾选另一任务 → 整份覆盖 | A 的新任务消失 | **高** |
| S2 | 旧标签"苏醒"后写入 | A 编辑后 B 闲置 10 分钟，B 再操作 → 用 10 分钟前的快照覆盖 | A 期间所有修改丢失 | **高** |
| S3 | 导入备份 / 清空数据 | A 导入/清空 → B 仍持旧数据，任意操作即覆盖回去 | 导入结果被回滚 | **高** |
| S4 | 同一任务并发勾选 | A 勾选、B 勾选（同为完成） | 结果语义相同，仅时间戳不同 | 低（但应提示） |
| S5 | 休眠/后台节流 | 标签进入后台，定时器漂移、flush 延迟；返回后直接写入旧状态 | 覆盖其它标签修改 | **中** |
| S6 | 关闭标签页瞬间 flush | 关闭时 flush 与另一标签写入竞争；关闭后无法弹提示 | 静默覆盖或丢失最后一次修改 | **中** |
| S7 | 双标签首次使用 | 两个空标签都从 revision 0 开始，各自写入示例/首条任务 | 先写者被后写者覆盖 | **中** |
| S8 | 仅浏览不编辑 | 标签 A 修改，标签 B 界面停在旧数据（无通知） | 用户看到过期数据 | 中（体验） |
| S9 | 迁移/多标签启动 | 两标签并发 `initializeStorage`，迁移标记竞态 | 重复迁移/数据被覆盖 | 中（需实施时验证） |
| S10 | 导入备份与自动保存交错 | 导入后 B 在 180ms 内写入 | 导入结果被覆盖 | 同 S3 |

> 关键判断：S1–S3 会造成**真实数据丢失且无任何提示**，是本阶段必须解决的核心问题。

---

## 3. 推荐实现方案（v1：冲突检测 + 用户提示，不做自动合并）

### 3.1 数据层：单调 revision + 原子 CAS（Compare-And-Swap）

**不改变 IndexedDB 架构**：不新增 store、不新增索引、不升级 `DB_VERSION`。

- `StoredState` 增加**可选**字段：
  ```ts
  interface StoredState {
    schemaVersion: number;
    updatedAt: string;
    revision: number;      // 单调递增整数，从 1 开始
    writerId?: string;     // 写入者标签页 id（诊断用）
    data: AppData;
  }
  ```
- 在已有的 `meta` store 增加一条轻量记录 `sync:v1`：`{ revision, writerId, updatedAt }`。**读取它只需读一个几十字节的小记录**，避免每次保存都整份读取 2 MB（10k 时 33 ms）。
- **保存（CAS 事务）**：
  ```
  db.transaction(['app', 'meta'], 'readwrite')
    → meta.get('sync:v1')               // 读取当前 revision
    → if stored.revision !== expectedBaseRevision → abort → 返回 conflict
    → app.put(state 记录，revision = base+1)
    → meta.put({revision: base+1, writerId, updatedAt})
  → 事务提交（IDB 对相同 scope 的 readwrite 事务串行执行，读-比较-写在同一事务内原子）
  ```
  IndexedDB 事务隔离保证：两个标签页的 CAS 事务不会交错，只有一个能成功，另一个拿到 conflict。
- 新增对外 API（`storage/index.ts`）：
  - `loadSnapshot(): Promise<{ data, revision, updatedAt }>`
  - `saveAppData(data, { baseRevision, writerId }): Promise<{ ok: true, revision } | { ok: false, conflict: SyncInfo }>`
  - `forceSaveAppData(data, { writerId }): Promise<{ revision }>`（用户确认"以本页覆盖"时使用）
  - `readSyncInfo(): Promise<SyncInfo>`（可见性/恢复时校验）
- 首次写入（空库 / 旧记录无 revision）：revision 视为 0，写入后为 1；**旧记录读取不受影响**（字段可选，缺失按 0 处理）。

### 3.2 状态层（AppStore）状态机

新增状态：

| 状态 | 含义 |
|---|---|
| `baseRevision` | 本标签内存数据对应的库版本（加载/保存成功时更新） |
| `writerId` | 本标签唯一 id（`crypto.randomUUID()` 或随机串） |
| `dirty` | 是否有"尚未成功落库"的本地修改（dispatch 后置 true，保存成功后 false） |
| `syncStatus` | `'idle' \| 'syncing' \| 'conflict' \| 'external-update' \| 'offline-degraded'` |
| `conflict` | 冲突详情 `{ revision, updatedAt, writerId, localSnapshot }` |

保存流程：

1. 防抖触发 → `saveAppData(data, { baseRevision, writerId })`。
2. `ok` → `baseRevision = newRevision`、`dirty = false`、广播 `{type:'saved', revision, writerId, updatedAt}`。
3. `conflict` → **停止自动保存**（`dirty` 保持 true）、`syncStatus='conflict'`、Toast 提示 + 顶部玻璃横幅（复用 `fd-glass` 样式，不新增视觉语言）：
   - **重新加载**：丢弃本页未保存修改，`loadSnapshot()` 后 `dispatch(data/replace)`（默认推荐）
   - **另存为副本**：把本地 `AppData` 导出为 `flowday-conflict-*.json`（复用现有备份结构），然后重新加载
   - **以本页覆盖**：二次确认后 `forceSaveAppData`（明确告知会覆盖其他标签页的数据）
4. 广播接收方（另一个标签）：
   - 若本标签 `dirty === false` 且 revision 落后 → `loadSnapshot()` + `dispatch(data/replace)`（**静默同步**，不覆盖任何人数据）
   - 若本标签 `dirty === true` → `syncStatus='external-update'`、停止保存、显示提示（"另一个标签页已更新数据"），用户选择重新加载/覆盖
5. 每次保存成功后广播；导入/清空等 `data/replace` 也走同一保存路径（并携带 `replaced: true` 标记，接收方即使 clean 也提示"数据已被其他标签页替换"，避免误以为崩溃）。

### 3.3 跨标签通知：BroadcastChannel（推荐）+ 降级

- 频道名 `flowday-sync`；消息只作为**通知**（`{type, revision, writerId, updatedAt}`），**不信任消息内容**，收到后一律以 `readSyncInfo()` 的库内 revision 为准（防止同源页面伪造消息）。
- 支持情况：Chrome/Edge 54+、Firefox 38+、Safari 15.4+ 均支持；同源限制；无需权限；消息不持久（新开标签通过启动读取 revision 兜底）。
- 降级链：
  1. `BroadcastChannel` 不可用 → `localStorage.setItem('flowday.sync.ping', ...)` + `window.addEventListener('storage')`（同源、跨标签、事件驱动）；
  2. 两者都不可用（隐私模式等）→ 仅在 `visibilitychange→visible` / `focus` / `pageshow` 时 `readSyncInfo()` 校验（最终兜底，冲突仍能被检测，只是无实时性）；
  3. 数据层 CAS 始终生效，因此**即使所有通知机制都失效，也不会静默覆盖**（只会延迟发现冲突）。

### 3.4 边界处理

| 场景 | 处理 |
|---|---|
| 页面隐藏/关闭（pagehide flush） | flush 走同样 CAS；冲突时**不写入**，把本地快照写入 `localStorage['flowday.conflict-draft']`（含 baseRevision、时间、数据），下次启动检测到草稿 → 横幅提示"上次关闭时有未保存的修改"（恢复/导出/丢弃三选一） |
| 刷新 | 正常 `initializeStorage`，读取最新 revision；若存在冲突草稿则提示 |
| 休眠恢复 | `visibilitychange→visible` + `focus` + `pageshow` 三重校验 revision：clean 自动同步；dirty 提示 |
| 多标签首次启动 | 两个标签都从 revision 0 开始：先写者成功（revision 1），后写者 CAS 失败 → conflict 提示（避免 S7 静默覆盖） |
| 多标签并发迁移 | 迁移仍由 meta 标记 `legacyMigration:v1` 保护；实施时验证两标签同时初始化的竞态（加"迁移锁"或依赖 CAS 冲突提示） |
| 存储配额/写入失败 | 保持现有行为（停止持久化 + 错误 Toast），冲突与写入失败区分展示 |

### 3.5 明确"不做什么"（v1 范围）

- 不做字段级自动合并、不做 CRDT、不做实体级 diff；
- 不改 `AppData` 结构、reducer 语义、IndexedDB store/索引/版本；
- 不改 Dashboard/虚拟滚动/搜索/备份逻辑（仅接入保存结果与状态提示）；
- 不引入任何第三方依赖。

---

## 4. 备选方案对比

| 方案 | 做法 | 优点 | 缺点 | 结论 |
|---|---|---|---|---|
| **A（推荐）** | revision + meta CAS + BroadcastChannel 通知 + 冲突提示 + 草稿 | 改动小、无架构变更、能防静默覆盖、开销低（每次保存多读一条小记录） | 冲突时需用户选择；整份粒度 | ✅ v1 |
| B | Web Locks API 串行写 + 整份读比较 | 天然序列化写入 | 每次保存多读 2 MB（10k +33 ms）；仍无法避免陈旧内存覆盖（需配合 revision）；Safari 支持较晚 | 可作为 A 的补充（可选加锁） |
| C | 拆分为 tasks/habits/logs/settings 独立 store + 索引 + 逐实体合并 | 天然行级并发 | Phase 4.1 实测列表查询更慢（open 468 ms vs 33 ms）；迁移成本高；违背本轮"不改架构"约束 | ❌ 本轮不做 |
| D | 仅保存前读整份比较 `updatedAt` | 零架构变更 | 仍无法区分"并发"与"内容相同"；每次 +33 ms；S1/S2 无法定位到具体冲突 | ❌ 不如 A |
| E | Service Worker 作为唯一写入者 | 强一致 | 复杂度/可用性风险高（SW 生命周期、离线） | ❌ 过度设计 |

---

## 5. 需要修改 / 新增的文件清单（预估，本轮不实施）

### 5.1 修改

| 文件 | 内容 |
|---|---|
| `src/lib/storage/schema.ts` | `StoredState` 增加可选 `revision` / `writerId`；`migrateStoredState` 兼容缺省 revision（按 0） |
| `src/lib/storage/db.ts` | 新增 `readSyncInfo()`、`saveStateWithRevision(data, baseRevision, writerId)`（app+meta 同一事务 CAS）、`forcePutState()`；保留现有 `getState/putState`（迁移与测试仍用） |
| `src/lib/storage/index.ts` | 对外暴露 `loadSnapshot / saveAppData(v2) / forceSaveAppData / readSyncInfo`；初始化返回 revision；保存失败区分 conflict 与 IO 错误 |
| `src/store/AppStore.tsx` | revision/dirty/conflict/externalUpdate 状态机；BC 订阅与广播；visibility/focus/pageshow 校验；flush 走 CAS；草稿检测与恢复；`data/replace` 后按 force 保存 |
| `src/components/UI.tsx`（或新增 `src/components/SyncBanner.tsx`） | 复用玻璃样式的同步/冲突横幅与三选一操作（不改变现有视觉语言） |
| `src/features/settings/SettingsPage.tsx` | 导入/清空/载入示例在存在其他标签编辑时提示（通过统一保存结果时展示）；导入确认文案补充"其他标签页会收到通知" |
| `src/tests/smoke.test.ts` | 新增 revision/CAS 纯逻辑、冲突结果分支、草稿结构、降级消息解析测试 |
| `scripts/e2e.mjs` | 新增多标签段（或独立 `scripts/e2e-multitab.mjs`，推荐独立脚本，避免主回归变慢） |

### 5.2 新增

| 文件 | 内容 |
|---|---|
| `src/lib/storage/sync.ts` | BroadcastChannel 封装 + localStorage 事件降级 + 订阅回调（统一 `onRemoteChange`） |
| `src/lib/storage/recovery.ts` | 冲突草稿（localStorage）写入/读取/清除 |
| `src/lib/syncState.ts`（可选） | 纯函数状态机（便于单测：`decideOnRemote(revision, baseRevision, dirty)` 等） |
| `scripts/e2e-multitab.mjs` | 双 target（同 profile）多标签真实测试（见第 7 节） |
| `scripts/bench-4.3-sync.mjs` | 保存额外开销、通知延迟、自动同步重载耗时测量 |
| `docs/phase4.3/PHASE4.3-R1-REPORT.md` | 实施报告 |

### 5.3 明确不改

`src/types.ts`（AppData）、`src/store/reducer.ts`、`src/features/tasks/*`（虚拟滚动/R1-R4）、`src/features/today/DashboardPage.tsx`、`src/lib/selectors.ts`、`src/styles.css`、`package.json`（不新增依赖）、IndexedDB `DB_NAME/DB_VERSION/store/index`。

---

## 6. 数据兼容性与迁移风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| 旧记录无 revision | 旧库中 `StoredState` 无 revision 字段 | 读取按 0 处理；首次保存写入 1；不升 `schemaVersion`/`DB_VERSION` |
| 旧版本回退 | 用户回退到 v0.3.0 旧代码 | 旧代码忽略多余字段 → 仍可读写（向后兼容）；但旧代码无冲突保护（需在发布说明中提示不要回退） |
| 备份导入 | 备份文件只含 `AppData`，不含 revision | 导入走 force 路径并广播替换事件；其它标签收到后同步/提示 |
| 草稿丢失 | 关闭时冲突写草稿失败（配额/隐私模式） | Toast 告知；草稿写入失败不阻塞关闭 |
| 迁移竞态 | 两标签同时首次启动触发 legacy 迁移 | 迁移标记 + CAS：后写者冲突提示；测试覆盖 |
| 性能回退 | 每次保存多一次 meta 小记录读 + 一条广播 | 预计 +< 5 ms（meta 记录几十字节）；需实测验证（10k） |
| 冲突提示疲劳 | 双标签频繁交替编辑会多次提示 | v1 每个冲突只提示一次，提供"重新加载"保持同步；v2 再评估自动合并 |

---

## 7. 完整测试计划（实施阶段执行）

### 7.1 单元（smoke，预估 +12~18 项）

1. 旧记录（无 revision）解析为 0；带 revision 记录保持原值；
2. `saveStateWithRevision` 的 CAS 分支：match → 成功 + revision+1；mismatch → conflict 且不写入；
3. 冲突结果结构（revision/updatedAt/writerId）；
4. 草稿写入/读取/清除（兼容损坏 JSON）；
5. 状态机纯函数：clean + 落后 → 自动同步；dirty + 落后 → 提示；revision 相同 → 无动作；
6. 降级消息解析（BC 消息与 storage 事件消息统一格式）。

### 7.2 双标签真实浏览器测试（新脚本 `e2e-multitab.mjs`，CDP 两个 target 共享同一 profile）

| 编号 | 场景 | 断言 |
|---|---|---|
| T1 | A 写 → B（无本地修改） | B 自动同步：DB revision 与 B 内存数据一致，B 显示新任务；记录同步延迟 |
| T2 | A、B 都修改后先后写 | B 保存被拒（conflict）；库中保留 A 的修改；B 显示冲突横幅与三选一 |
| T3 | A、B 在 180ms 防抖窗口内并发写 | 只有一个成功，另一个 conflict；库数据 = 胜者完整快照 |
| T4 | A 导入备份 / 清空数据 | B 收到 replaced 通知并同步/提示；B 不会把旧数据写回（验证 DB 内容） |
| T5 | 刷新 B | B 读取最新 revision 与数据，无冲突提示 |
| T6 | 休眠恢复 | 用 CDP 冻结/隐藏页面后恢复 → B 校验 revision 并同步/提示 |
| T7 | 关闭标签页时有未保存修改（冲突） | 不覆盖库；重新打开出现"草稿恢复"提示 |
| T8 | BroadcastChannel 不可用（init script 置为 undefined） | storage 事件降级工作：T1/T2 仍通过 |
| T9 | BC 与 storage 都不可用 | 仅 visibility/focus 校验也能发现冲突，不静默覆盖 |
| T10 | 并发压力：A/B 各 20 次快速操作 | 无静默丢失；冲突全部被提示；最终库状态可解释（胜者完整快照或序列化成功） |
| T11 | 单标签回归 | 无任何冲突提示；保存/刷新/CRUD/搜索/Dashboard 正常 |

### 7.3 回归与性能

- `tsc --noEmit`、smoke（97+新增）、E2E（90+）、生产构建、生产调试变量扫描（0）。
- 性能：10k 数据下（1）单次保存额外耗时（目标 <5 ms）；（2）通知延迟（目标 <100 ms）；（3）自动同步重载耗时（读 33 ms + 渲染，目标 <400 ms，仅 clean 自动同步时）。
- R1/R2 指标不回退：10k 搜索 ≤ 200 ms、勾选端到端 ≤ 300 ms（沿用同一基准脚本）。

---

## 8. 成本估算与拆分（预算 12.5 元，下一阶段上限 4 元）

| 阶段 | 内容 | 预估费用（CNY） |
|---|---|---|
| 本审查轮 | 只读审查 + 文档（已发生） | **0.3–0.5** |
| Phase 4.3 R1（完整） | 数据层 revision/CAS + AppStore 状态机 + 横幅 + BC + 降级 + 草稿 + 单元测试 + 双标签 E2E + 性能测量 + 报告 | **2.6–3.6** |
| 剩余 | 12.5 − 本审查 − R1 | 约 **8.4–9.6** |

**若实施中预计超出 4 元，立即按以下两小步拆分（各自 ≤2 元）：**

| 拆分阶段 | 内容 | 预估（CNY） |
|---|---|---|
| **4.3-R1a（数据与单页半）** | schema 可选字段、db CAS 事务、storage API、AppStore revision/dirty/conflict 状态、冲突横幅（重新加载/导出副本/强制覆盖）、单元测试、单标签回归 | 1.3–1.8 |
| **4.3-R1b（跨标签与验收）** | BroadcastChannel + storage 事件降级 + 可见性校验 + 草稿恢复、双标签 E2E（T1–T10）、性能测量、报告 | 1.2–1.7 |
| 合计 | | **2.5–3.5** |

**超支触发条件（暂停并请示）**：双标签 E2E 因 CDP 多 target 问题重跑 ≥3 次；或发现必须调整 IDB 结构/迁移逻辑；或单轮预估将超过 4 元。

> 风险提示：多标签 E2E 依赖 CDP `Target.createTarget` 与共享 profile 的 IndexedDB，若实现中发现测试环境限制，将以"单元测试 + 双 target 简化用例"降级覆盖，并在报告中说明。

---

## 9. 需要你确认的 4 个决策点（会影响实施细节）

1. **冲突默认行为**：推荐"阻止覆盖 + 三选一提示"（默认不自动覆盖）。是否需要额外提供设置开关（如"冲突时自动以后写覆盖"）？建议 v1 不提供。
2. **关闭页面时的冲突**：无法弹窗，只能落草稿、下次打开提示。是否接受？
3. **自动同步时机**：clean 标签页收到通知后**立即静默同步**（推荐，体验最好），还是仅提示"有新数据·点击刷新"？建议立即同步。
4. **草稿存放位置**：`localStorage`（简单、跨标签共享、上限约 5MB，10k 任务约 2MB，可接受）；如需更大容量可放 IndexedDB 的 meta store（但关闭时写入同样是异步）。建议 v1 用 localStorage。

---

## 10. 结论

- 当前架构存在**真实且无法察觉的多标签数据覆盖风险**（S1–S3 高危），根因是"整份文档 + 无 revision + 无跨标签通知"。
- 推荐 **v1：revision + meta CAS 原子保存 + BroadcastChannel 通知（含 storage 事件/可见性降级）+ 冲突提示（重新加载/导出副本/强制覆盖）+ 关闭草稿**；不改变 IndexedDB 结构与 AppData、不新增依赖、不破坏 R1–R4 与现有功能。
- 实施预估 **2.6–3.6 元**（上限 4 元内），若超出按 R1a / R1b 两小步拆分（各 ≤2 元）。
- **本轮到此停止，未修改任何代码，等待验收与决策点确认。**
