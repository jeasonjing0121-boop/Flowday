# FlowDay Phase 4.4 方案审查 — 备份与恢复系统增强

> 本轮为 **只读代码审查 + 方案设计**：未修改任何代码、未运行实现性测试、未消耗实施预算。
> 当前剩余预算约 **9.25 元**；Phase 4.4 实施上限 **3 元**（拆分方案见第 7 节）。

- 审查日期：2026-11-14
- 审查范围：`src/lib/storage/backup.ts`、`src/lib/data.ts`（sanitize）、`src/lib/storage/{index,db,schema}.ts`、`src/store/AppStore.tsx`、`src/features/settings/SettingsPage.tsx`、现有 smoke/E2E 备份用例
- 结论摘要：现有备份"能用但不够稳"——导出完整、导入前有基本校验、失败不写库；但**缺少格式版本 + 校验和、缺少 ID/引用/字段类型加固、导入与冲突状态未联动、无持久化保护与备份提醒**。建议做一轮"格式 + 校验 + 预检 + 协作"加固（不引入自动备份历史）。

---

## 1. 当前备份/恢复架构审查

### 1.1 导出（当前）

```ts
// src/lib/storage/backup.ts
createBackup(data) => { app: 'FlowDay', schemaVersion: 2, exportedAt, data }
downloadBackup(data) => Blob(JSON.stringify(envelope, null, 2)) → a.download = `flowday-backup-${todayKey()}.json`
```

- 入口：设置页「导出 JSON 备份」、头像菜单导出（`AppShell`）。
- 内容：完整 `AppData`（tasks/projects/habits/habitLogs/settings）+ 应用标记 + 结构版本 + 导出时间。
- 未包含：备份格式版本、校验和、内容统计、revision/是否含未保存修改。

### 1.2 导入（当前）

```
SettingsPage.importFile(file)
  → file.text()（无大小上限）
  → validateBackup(text)
      · JSON 解析失败 → 拒绝
      · 包装格式（app==='FlowDay' 或存在 schemaVersion）→ 版本 ≤2 → sanitizeImportedData
      · 裸 AppData（旧版）→ sanitizeImportedData
  → confirm（覆盖提示，含数量对比）
  → dispatch({type:'data/replace'})
  → AppStore 防抖 180ms → CAS 写入 IndexedDB（Phase 4.3）
```

- 校验失败：不 dispatch、不动数据 ✓
- 校验成功但尚未写入时关闭页面：依赖 pagehide flush（异步 CAS 可能被中断，概率低）
- 写入失败/冲突：走 Phase 4.3 的持久化失败提示或冲突横幅 ✓
- **导入没有检查当前是否处于冲突/待恢复状态**，存在"内存已被替换但无法落库"的中间态。

### 1.3 校验实际覆盖范围（`sanitizeImportedData`）

| 已校验/兜底 | 未校验 / 风险 |
|---|---|
| tasks/habits 必须是数组；无 id/title 的任务被丢弃 | **重复 id 不去重**（React key 冲突、reducer 一次更新多条同 id 任务） |
| title 截断 200；priority 收敛 1–3 | notes 长度无上限；time 仅 `^\d{2}:\d{2}$`（**99:99 可通过**） |
| date 需 `YYYY-MM-DD` | `completedAt` / `createdAt` 任意字符串（**非 ISO 也接受**） |
| completion 布尔化；source 枚举兜底 | `durationMin` 任意正数（可 999999） |
| habits 需 id/name；weeklyTarget 收敛 1–7 | habitLogs 只检查 habitId 存在，**date 未校验格式**；**重复打卡不去重** |
| 孤儿 habitLogs 被丢弃 | projects 仅校验 id/name，color 不校验；**task.projectId 不校验引用是否存在** |
| settings 与默认值合并 | **settings 各字段无类型校验**：`name` 若为数字/对象会直接进入 JSX（可能触发 React 渲染错误），`theme` 非法值会写入主题逻辑 |

### 1.4 与多标签 CAS 的协作（现状）

- 导入 = `dispatch(data/replace)`，随后走正常保存 → CAS 比对 revision：
  - 成功 → 广播，其他标签页同步/提示 ✓
  - 冲突 → 横幅，草稿保存 ✓（但导入的"覆盖"意图与冲突提示会叠加，用户需要理解两层含义）
- 数据已替换到内存但未落库时：刷新会回到旧数据（导入"看起来成功又消失"）。
- 导出时若本页有未保存修改（dirty），导出的是**内存数据**（包含未保存修改），但文件没有标记，用户无法分辨。

### 1.5 恢复路径与持久化保护

- 误删/浏览器清理 IndexedDB 后：唯一恢复路径是用户此前手动导出的 JSON 文件（`设置 → 导入`）。
- 没有 `navigator.storage.persist()` 申请，浏览器在存储压力下可能清理 IndexedDB（Chrome 对未持久化站点可能 evict）。
- 没有"上次备份时间"提醒；没有清空前的安全备份。
- 跨设备：导出的 JSON 可携带到其他设备导入（当前格式已可用），但缺少校验和与格式版本，跨设备/跨版本传递时更容易出现"看似成功、数据异常"。

---

## 2. 已发现的问题与风险等级

| # | 问题 | 影响 | 等级 |
|---|---|---|---|
| B1 | 备份无格式版本 + 无校验和 | 文件损坏/被修改时无法识别；跨设备传输错误不可检测 | **高** |
| B2 | 导入文件无大小上限（`file.text()` 无限制） | 超大文件导致页面内存飙升/卡死 | **高** |
| B3 | 重复 task id 不去重 | React key 冲突、勾选/编辑同时影响两条记录、数据错乱 | **高** |
| B4 | settings 字段无类型校验 | 恶意/损坏备份可让 `name` 变成对象 → React 渲染错误、页面白屏 | **高** |
| B5 | 导入不检查冲突/待恢复状态 | 内存替换但保存被暂停，用户以为导入成功，刷新后回滚 | **中高** |
| B6 | `time`/`completedAt`/`createdAt`/`habitLogs.date` 校验不严 | 非法时间进入时间线/统计（`99:99`、无效 ISO） | **中** |
| B7 | `durationMin` 无上限、notes 无长度限制 | 异常数据导致布局/性能问题 | 中 |
| B8 | 导出文件名只有日期（同一天重复导出覆盖） | 用户误以为覆盖了旧文件（浏览器可能自动改名，行为不一致） | 中 |
| B9 | 导入成功后若持久化失败/被清理，无明确"未保存"提示 | 用户误判数据已安全落地 | 中 |
| B10 | 未申请持久化存储、无备份提醒 | 浏览器清理后无近期备份可用（恢复路径依赖用户自觉） | 中 |
| B11 | 旧版裸 AppData 仍可导入（无版本/来源标记） | 任意含 tasks/habits 的 JSON 都可能被接受（社会工程/误选文件） | 低–中 |
| B12 | 无自动备份/历史 | 误操作后无法回退（但自动备份有复杂度和隐私成本） | 低（本轮不引入） |

---

## 3. 推荐的 Phase 4.4 实施方案（R1：备份格式加固 + 导入预检 + 安全协作）

> 原则：只做"数据安全 + 可解释"的最小闭环；不引入自动备份历史、不改 IndexedDB 架构、不加依赖。

### 3.1 新备份格式（向后兼容）

```jsonc
{
  "app": "FlowDay",
  "formatVersion": 1,          // 新增：备份信封版本
  "schemaVersion": 2,          // 数据结构版本（现有）
  "exportedAt": "2026-11-14T13:00:00.000Z",
  "revision": 12,              // 可选：导出时的数据版本（仅诊断）
  "dirty": false,              // 可选：导出时是否有未保存修改
  "counts": { "tasks": 123, "habits": 3, "habitLogs": 88, "projects": 3 },
  "checksum": { "alg": "sha-256", "value": "hex..." },   // 可选：数据段校验和
  "data": { /* AppData */ }
}
```

- **校验和**：对 `JSON.stringify(data)`（紧凑序列化，导出时计算）做 SHA-256（`crypto.subtle.digest`），hex 存储。导入时重新序列化 `data` 并比对；**不一致直接拒绝导入**（不提供"强制导入"开关，避免损坏数据入库）。
- 非安全上下文（`crypto.subtle` 不可用，如局域网 http）时**省略 checksum** 并在文件中标记 `checksum: null`；导入侧对无校验和文件给出"未校验"提示但仍允许导入（兼容旧文件）。
- **兼容旧文件**：无 `formatVersion` 的包装格式、以及裸 `AppData`（旧版导出）继续支持，但在导入预览中明确标记"旧格式/无校验和"。

### 3.2 校验加固（集中在 sanitize 层，供备份/迁移/DB 读取共用）

1. **结构**：`app==='FlowDay'`（新格式必须）；`formatVersion <= 1`；`schemaVersion <= CURRENT`；文件大小上限（默认 20 MB，超限直接拒绝且不解析）。
2. **去重**：tasks/habits/projects 按 `id` 去重（保留首条，统计丢弃数）；habitLogs 按 `habitId+date` 去重。
3. **引用完整性**：`projectId` 不存在对应项目 → 置空（计入 warnings）；`habitLogs.habitId` 不存在 → 丢弃（现有行为）。
4. **字段类型/范围**：
   - settings 白名单：`name` 字符串（≤64）、`theme ∈ light|dark|system`、`weekStart ∈ 0|1`、`aiEnabled/demoData` 布尔；非法值回落默认。
   - `time`：`HH:mm` 且小时 00–23、分钟 00–59，否则置空。
   - `completedAt`/`createdAt`：`Date.parse` 有效才保留（completedAt 无效则清空；createdAt 无效用当前时间）。
   - `durationMin`：clamp 5–1440。
   - `notes`：截断 5000 字符；`title` 保持 200。
   - `habitLogs.date`：`YYYY-MM-DD` 校验。
   - `projects.color`：`#RRGGBB` 校验，否则用默认色。
5. **返回摘要**：`{ data, stats: { tasks, habits, habitLogs, projects, duplicatesRemoved, droppedInvalid, warnings[] } }`，供导入预览与 Toast 使用。

### 3.3 导入流程改造（预检 + 协作保护）

```
选择文件
 → 大小检查（≤20MB）
 → validateBackupDetailed()
     · 失败 → Toast 明确原因（不进入确认）
     · 成功 → 打开「导入预览」玻璃弹窗：
         文件：格式 v1 / 导出时间 / 校验和状态（已校验/未校验/旧格式）
         备份内容：任务 N / 习惯 N / 打卡 N / 项目 N
         数据修正：去重 X、丢弃 Y、告警摘要（可展开）
         当前内容：任务 N / 习惯 N（将被覆盖）
         若本页有未保存修改：红色提示「本页存在未保存修改，导入会丢弃它们」
     → 用户点「覆盖导入」
 → 冲突状态检查：若 sync.status !== 'idle' → 拒绝并提示先处理冲突/草稿
 → dispatch(data/replace) → 正常 CAS 保存 → Toast
```

- **预览弹窗**复用现有玻璃 `Modal` 风格；按钮：`取消` / `覆盖导入`（danger）。
- **冲突保护**：`useApp().sync.status` 非 idle 时禁用导入按钮并说明原因。
- **落库确认**：导入后监听一次保存结果（AppStore 已暴露 `storage.revision` 变化）：若 2 秒内 revision 未前进，Toast 提示"导入尚未写入本地数据库，请检查存储空间/冲突提示"（轻量，不新增全局状态机）。
- **导出改进**：文件名 `flowday-backup-YYYY-MM-DD-HHmm.json`；导出后记录 `localStorage['flowday.lastExportAt']`，设置页显示「上次导出：X 天前」；导出 Toast 带数量。

### 3.4 持久化保护与恢复路径（不引入自动备份）

- 首次进入设置页（或首次导出时）调用一次 `navigator.storage.persist()`（失败静默），并显示状态：
  - 「存储已申请持久化（浏览器不会自动清理）」/「未获持久化，浏览器可能在存储紧张时清理数据」
- 设置页「数据」区显示：当前 schema v2 / revision / 上次导出时间 / 持久化状态。
- **清空前**：确认弹窗文案增加"建议先导出备份"；提供「导出后再清空」快捷按钮（导出 + 清空两步，仍需用户确认），不做自动后台快照。
- **不引入自动备份历史**（原因见 3.5）。
- 跨设备迁移：文档说明"导出 JSON → 另一设备导入"；新格式带校验和/格式版本，跨设备更可靠。

### 3.5 为什么本轮不做自动备份/备份历史

- 自动备份需要额外的存储位置与容量策略：放入 IndexedDB 需新增 store（架构变更 + 配额翻倍 + 清理策略），放入 localStorage 受 5MB 限制且与 IndexedDB 生命周期绑定，放到文件系统需要 File System Access API（浏览器支持/权限差异大）。
- 自动下载文件会打断用户（多次下载/被拦截）。
- 结论：本轮先确保"手动备份可靠 + 用户知道何时该备份 + 存储不易被清理"；若后续需要历史，再单独评估"独立备份数据库 + 保留 N 份 + 容量上限"。

### 3.6 与多标签 CAS 的协作（明确规则）

| 场景 | 行为 |
|---|---|
| A 导入，B 同时编辑 | A 的导入保存 CAS 冲突 → A 横幅；B 不被静默覆盖；A 可重新加载/覆盖/导出 |
| 导入前本页 dirty | 预览红色提示，导入会丢弃未保存修改（需确认） |
| 导入时本页 conflict | 拒绝导入，提示先解决冲突 |
| 导入后未落库 | 2 秒 revision 未变 → 明确 Toast |
| 导出时 dirty | 文件名/内容标记 dirty，提示"包含未保存修改" |
| 导出/导入时其他标签页 | 依靠既有广播与 revision 校验（无需改通知层） |

---

## 4. 文件修改清单（预估，实施阶段）

### 修改

| 文件 | 内容 |
|---|---|
| `src/lib/storage/backup.ts` | 新信封格式（formatVersion/checksum/counts/revision/dirty）、`validateBackupDetailed`（大小/版本/校验和/摘要）、文件名带时间、导出记录 `lastExportAt`、`persist` 相关辅助可选 |
| `src/lib/data.ts` | `sanitizeImportedData` 加固：去重、settings 白名单、time/date/duration/notes/color 校验、项目引用校验；返回 warnings（通过新函数或附加字段，保持旧调用兼容） |
| `src/lib/storage/schema.ts` | 备份格式版本常量（`BACKUP_FORMAT_VERSION = 1`）；如需暴露 `revision` 读取辅助 |
| `src/features/settings/SettingsPage.tsx` | 导入预览弹窗、冲突状态禁用、未保存修改警告、上次导出时间、持久化状态、清空前置导出入口 |
| `src/components/UI.tsx` | 若预览需要新弹窗样式，复用现有 `Modal`（预计无需改） |
| `src/tests/smoke.test.ts` | 新增校验/去重/类型兜底/校验和/旧格式兼容等单测 |
| `scripts/e2e.mjs` | 更新导出断言（新格式字段）、导入预览流程、冲突禁用、校验和校验失败拒绝 |

### 新增

| 文件 | 内容 |
|---|---|
| `scripts/e2e-backup.mjs`（可选，推荐） | 备份专项 E2E：导出→校验和/格式、导入合法/旧版/篡改/重复ID/版本过高、清库后跨设备恢复、导入时冲突保护 |
| `docs/phase4.4/PHASE4.4-R1-REPORT.md` | 实施报告 |

### 不改

`src/types.ts`、`src/store/reducer.ts`、`src/lib/storage/{db,index,sync,recovery,legacy}.ts`、IndexedDB 结构、R1/R2 渲染优化、UI 主题样式、`package.json`（无新依赖）。

---

## 5. 兼容性与数据安全方案

| 场景 | 方案 |
|---|---|
| 旧备份（无 formatVersion / 裸 AppData） | 继续可导入；预览标记"旧格式/无校验和"；不因缺少校验和而拒绝 |
| 未来版本备份（formatVersion/schemaVersion 更高） | 拒绝并提示升级应用（现有逻辑扩展） |
| 文件被篡改/损坏 | 有 checksum 时必须匹配，否则拒绝；无 checksum 时仅结构校验（标注"未校验"） |
| 超大文件 | 20MB 上限（可在常量中调整），超限不解析 |
| 重复 ID/无效引用 | 导入前规范化（去重/清空引用）并在预览中展示修正数量；不静默改数据 |
| 导入失败 | 失败发生在 dispatch 之前 → 现有数据不变；落库失败 → 明确提示（新增轻量检测） |
| 导入与冲突 | 冲突状态禁止导入；导入后 CAS 冲突走既有横幅/草稿 |
| 浏览器清理 | 申请 persist + 上次导出提醒；用户仍应保留导出文件（文档说明） |
| 跨设备 | 新格式 JSON 携带格式版本/校验和；文档说明迁移步骤 |

**不改变现有数据结构**：`AppData` 字段不变；仅扩展备份信封、并强化 sanitize 的兜底规则（对现有合法数据无影响；对历史非法数据会做规范化，属于预期行为且已有迁移/读取路径复用同一函数，需在回归中验证不改变正常数据）。

---

## 6. 测试计划

### 6.1 单元（smoke，预计 +18~24 项）

1. 新格式导出字段（formatVersion/checksum/counts/exportedAt）
2. checksum 计算与验证一致；篡改 data 后拒绝
3. 无 checksum 文件可导入且标记未校验
4. 旧版裸 AppData 兼容
5. formatVersion/schemaVersion 过高拒绝
6. 重复 task/habit/project id 去重计数正确
7. habitLogs 重复去重
8. projectId 指向不存在项目 → 置空 + warning
9. settings 非法类型（name 对象/theme 非法/weekStart 非法）回落默认
10. time 99:99 → 置空；合法 23:59 保留
11. completedAt/createdAt 非法 ISO → 清空/当前时间
12. durationMin 0/99999 → clamp
13. notes 超长截断
14. habitLogs.date 非法丢弃
15. 超大原始字符串（>上限）拒绝
16. 空数据备份合法（tasks/habits 空数组）

### 6.2 E2E（真实浏览器，settings 页）

1. 导出：下载文件 → 校验 formatVersion=1、checksum 存在且与重算一致、counts 正确
2. 导入合法新格式：预览显示格式/校验和/数量 → 确认 → 数据替换 + revision 前进
3. 导入旧格式：可导入且预览标记旧格式
4. 导入篡改文件（改 checksum 或 data）→ 拒绝，原数据不变
5. 导入重复 ID 文件 → 预览显示去重数量，导入后无重复
6. 导入版本过高 → 拒绝并提示
7. 导入时本页存在冲突 → 导入按钮禁用/提示（多标签场景）
8. 清空数据（模拟浏览器清理：删除 DB + 重新加载）→ 导入备份 → 数据完整恢复（跨设备迁移路径）
9. 导出后设置页显示"上次导出时间"
10. （可选）持久化状态展示

### 6.3 回归

- `tsc --noEmit` 0 错误；smoke 全绿（现 125 + 新增）
- 单页 E2E 90 项全绿（备份相关断言更新）
- 多标签 E2E 28 项全绿（导入/清空与 CAS 协作不回归）
- 生产构建 + 生产调试变量扫描 0
- 数据迁移回归：旧 localStorage 迁移、优先级 4→3、回滚副本

---

## 7. 预计费用与 ≤3 元控制方案

| 阶段 | 内容 | 预估（CNY） |
|---|---|---|
| 本审查轮（已发生） | 只读审查 + 文档 | 0.25–0.4 |
| **4.4-A（格式与校验加固）** | backup 新格式/checksum/文件名/lastExport、sanitize 加固、单元测试、导出断言更新 | 1.0–1.4 |
| **4.4-B（导入预检 + 协作 + 验收）** | 预览弹窗、冲突禁用、未保存提示、E2E 备份专项、回归（90+28）、构建、报告 | 0.9–1.3 |
| **R1 合计** | | **1.9–2.7（<3）** |
| 剩余预算 | 9.25 − 本审查 − R1 | 约 **6.2–7.1** |

**费用控制措施**：
1. 两个子阶段各自 ≤1.4 元，任一阶段开始前先评估剩余预算，超过立即停。
2. 单元测试优先（Node，秒级）；E2E 备份专项只写一个脚本、一次跑通（失败重跑不超过 2 次）。
3. 不新增浏览器矩阵；复用现有临时 profile 机制。
4. 不实现自动备份历史（省下设计与测试成本）。
5. 若 checksum 实现受阻（crypto 环境差异），降级为"可选校验和 + 明确提示"，不反复调试。

**超支/拆分条件**：若 4.4-A 结束时估算剩余不足以完成 B（>1.4 元），则暂停并报告；B 可进一步拆为 B1（预览弹窗 + 冲突禁用）与 B2（E2E + 回归 + 报告）。

---

## 8. 需要确认的决策点

1. **checksum 严格性**：有校验和但校验失败时，是否允许"强制导入"？（推荐：**不允许**，直接拒绝，保证安全）
2. **重复 ID 处理**：保留首条并去重（推荐）还是拒绝整个文件？推荐去重并在预览中明确显示数量。
3. **自动备份**：确认本轮**不做**自动备份/历史，只做持久化申请 + 上次导出提醒？（推荐）
4. **导入前未保存修改**：仅警告并由用户确认丢弃（推荐），还是要求先保存/导出？
5. **预览弹窗**：是否可接受新增一个玻璃风格导入预览弹窗（覆盖现有 confirm）？（推荐，信息更透明）

---

## 9. 结论

- 现有备份"能用但不是数据安全级"：缺格式版本/校验和、缺字段类型与引用加固、导入与冲突状态未联动、无持久化保护与提醒。
- 推荐 Phase 4.4 只做 **R1：备份格式加固 + 导入预检 + 安全协作 + 持久化保护/备份提醒**，不做自动备份历史；预估 **1.9–2.7 元**（<3 元上限），可按 A/B 两小步交付。
- **本轮只读审查结束，未修改任何代码，等待验收与决策点确认。**
