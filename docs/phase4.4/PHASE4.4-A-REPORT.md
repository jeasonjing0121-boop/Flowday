# FlowDay Phase 4.4-A 验收报告 — 备份格式与数据校验加固

> 本轮仅实施 4.4-A：新备份信封 + SHA-256 校验 + 文件大小限制 + 数据校验加固 + 重复 ID 处理 + 旧格式兼容 + 单元测试。
> **未实施 4.4-B**（导入预览弹窗、冲突协作、持久化申请、备份提醒、E2E 专项、完整回归留待 B 阶段）。
> R1 IndexedDB 结构、AppData、reducer、R1–R4 性能优化均未改动；未新增依赖。

- 日期：2026-11-14
- 预算上限：1.4 元；实际估算：**约 0.9 元**（见第 8 节）
- 环境：Windows x64 · Node v24.16.0 · Edge 157 headless

---

## 1. 结论摘要

| 项目 | 结果 |
|---|---|
| 新备份信封（formatVersion/counts/checksum） | ✅ 已实现 |
| SHA-256（`crypto.subtle.digest`）生成与验证 | ✅ 已实现，生成/验证共用同一规范化函数 |
| 文件大小限制（20 MB，UTF-8 字节） | ✅ 超限直接拒绝且不解析 |
| 数据校验加固（去重/类型/范围/引用） | ✅ 已实现，所有修正进入可见 stats/warnings |
| 重复 ID 处理（保留首次，丢弃后续） | ✅ 任务/项目/习惯/打卡均去重 |
| 旧格式兼容（旧信封 / 裸 AppData） | ✅ 可导入，标记为**未校验** |
| 未来格式版本拒绝 | ✅ formatVersion > 1 直接拒绝 |
| 单元测试 | ✅ **141/141**（原 125 + 新增 16 项备份/校验/规范化测试） |
| TypeScript | ✅ 0 错误 |
| 生产构建 | ✅ CSS 43.80 kB（gzip 8.65）/ JS 369.53 kB（gzip 114.08） |
| 生产调试变量扫描 | ✅ 0 命中 |
| 真实浏览器回归（原有 90 项 E2E） | ✅ **90/90**，导入导出流程未破坏 |
| 真实导出文件实测 | ✅ `formatVersion=1`、`checksum` 64 位 hex、`counts` 与数据一致 |

---

## 2. 修改文件清单

| 文件 | 修改内容 |
|---|---|
| `src/lib/storage/backup.ts` | 重写：新信封（formatVersion/counts/checksum）、`canonicalBackupPayload`、`sha256Hex`、`validateBackupDetailed`（大小/格式/版本/校验和/计数/规范化摘要）、`validateBackup` 改为兼容包装（async）、`downloadBackup` 改为 async 并返回校验和状态；`createBackup` 改为 async |
| `src/lib/data.ts` | 新增 `sanitizeImportedDataDetailed`（去重、settings 白名单、时间/日期/ISO/时长/备注/颜色/引用校验、stats+warnings）；`sanitizeImportedData` 保留为兼容包装 |
| `src/features/settings/SettingsPage.tsx` | 导入改为 `await validateBackup(...)`；导出改为 `await downloadBackup(...)` 并按校验和状态提示（成功/不支持 SHA-256） |
| `src/components/AppShell.tsx` | 头像菜单导出改为 `void downloadBackup(...)`（async 适配，行为不变） |
| `src/tests/smoke.test.ts` | 备份断言升级为新格式（`await` + top-level await），新增 16 项：formatVersion/counts/校验和通过/篡改拒绝/未来版本拒绝/旧信封与旧裸格式兼容/大小限制/去重/字段兜底/引用/打卡去重/告警 |

### 未修改

`src/types.ts`（AppData）、`src/store/reducer.ts`、`src/lib/storage/{db,index,sync,recovery,schema,legacy}.ts`、IndexedDB 结构/版本、任务/仪表盘/搜索等 R1–R4 组件、`styles.css`、`package.json`。

---

## 3. 新旧备份格式说明

### 旧格式（Phase 3–4.3 导出）

```jsonc
{ "app": "FlowDay", "schemaVersion": 2, "exportedAt": "…", "data": { /* AppData */ } }
```

以及更早的**裸 AppData**（无信封，`version: 1`）。

### 新格式（4.4-A）

```jsonc
{
  "app": "FlowDay",
  "formatVersion": 1,                 // 新增：备份信封版本（独立于数据结构版本）
  "schemaVersion": 2,                 // 数据结构版本（不变）
  "exportedAt": "2026-11-14T14:00:00.000Z",
  "counts": { "tasks": 9, "projects": 3, "habits": 3, "habitLogs": 9 },
  "checksum": { "alg": "sha-256", "value": "<64 位小写 hex>" },  // 不支持 subtle 时为 null
  "data": { /* AppData 完整内容 */ }
}
```

### 兼容规则

| 文件类型 | 处理 |
|---|---|
| 新格式（formatVersion=1） | 校验 formatVersion/schemaVersion/校验和 → 规范化 → 可导入 |
| 旧信封（有 app/schemaVersion，无 formatVersion/checksum） | 可导入，标记 `checksumStatus='unverified-legacy'`，warning 明示"未做完整性校验" |
| 裸 AppData（无信封） | 可导入，标记旧格式未校验（沿用 4.3 行为） |
| formatVersion > 1 | **拒绝**（提示升级应用） |
| checksum 存在但校验失败 | **拒绝**（决策 1：不提供强制绕过） |
| checksum 存在但环境不支持 `crypto.subtle` | **拒绝**（绝不把文件标记为校验通过），提示在 localhost/HTTPS 导入 |
| checksum 为 null（导出端不支持 subtle） | 可导入，标记 `absent` + warning |

### 校验和规范（生成与验证完全一致）

- **计算范围**：仅 `data` 字段，不包含 app/formatVersion/schemaVersion/exportedAt/counts/checksum（信封元数据被修改不影响数据完整性判定）。
- **规范化**：`JSON.stringify(data)` 紧凑序列化（无空白；对象键按插入顺序；数组顺序保持）——生成与验证都调用同一个 `canonicalBackupPayload()`。
- **摘要**：对上述字符串做 UTF-8 编码后 `crypto.subtle.digest('SHA-256', bytes)`，输出小写 hex。
- **状态语义**：`verified`（已计算并匹配）、`absent`（文件无校验和）、`unverified-legacy`（旧格式）；**不存在"未校验却标记通过"的路径**。

---

## 4. 数据校验规则（`sanitizeImportedDataDetailed`）

### 4.1 文件级

| 规则 | 行为 |
|---|---|
| UTF-8 字节数 ≤ 20 MB | 超限直接拒绝（不 JSON.parse） |
| JSON 合法 / 顶层对象 | 否则拒绝 |
| `app === 'FlowDay'`（信封格式） | 否则拒绝（防误选其他 JSON） |
| formatVersion ∈ [1, 1]（缺失=旧版 0） | 高于当前拒绝 |
| schemaVersion ≤ 2 | 高于当前拒绝 |

### 4.2 记录级

| 实体 | 规则 | 修正方式 |
|---|---|---|
| tasks | `id` 非空字符串、`title` 字符串 | 无效记录丢弃（计入 droppedInvalid） |
| | **重复 id** | 保留首次出现，后续丢弃（`duplicatesRemoved.tasks`） |
| | title > 200 / notes > 5000 | 截断（fixedFields） |
| | `date` 必须 `YYYY-MM-DD` | 否则置为今天 |
| | `time` 必须 `HH:mm` 且 00–23 / 00–59 | 否则置空（`99:99` 被拒绝） |
| | `priority` | 收敛 1–3 |
| | `durationMin` | clamp 5–1440（非数字置空） |
| | `completedAt` / `createdAt` | 必须 `Date.parse` 有效；completedAt 无效置空，createdAt 无效取当前时间 |
| | `projectId` | 必须引用存在的项目；否则置空并计入 `brokenProjectRefs` |
| | `source` | 仅 `ai`/`manual` |
| projects | id/name 必填；**重复 id 去重**；color 必须 `#RRGGBB` | 非法颜色用默认色 |
| habits | id/name 必填；**重复 id 去重**；emoji 截断 8；weeklyTarget 1–7；createdAt 有效 ISO | 兜底 |
| habitLogs | habitId 必须存在；date 必须 `YYYY-MM-DD`；**(habitId,date) 去重** | 无效丢弃/重复去重 |
| settings | `name` 字符串 ≤64；`theme ∈ light/dark/system`；`weekStart ∈ 0/1`；`aiEnabled/demoData` 布尔 | 非法字段回落默认（不再把对象写进 JSX） |

### 4.3 可见摘要（决策 7）

每次规范化返回：

```ts
stats = { tasks, projects, habits, habitLogs,
          duplicatesRemoved: { tasks, projects, habits, habitLogs },
          droppedInvalid, fixedFields, brokenProjectRefs }
warnings: string[]   // 如「重复任务 ID：丢弃 2 条（保留首次出现）」「字段修正：3 处」
```

导入侧（4.4-B 预览）将展示这些统计；本轮已通过单元测试验证摘要正确，不存在静默修正。

---

## 5. 单元测试结果（新增 16 项）

| 测试 | 结果 |
|---|---|
| 备份包含 schemaVersion / formatVersion=1 | ✅ |
| 备份附带 64 位小写 hex 校验和 | ✅ |
| counts 与实际内容一致 | ✅ |
| 合法备份通过校验并还原任务 | ✅ |
| 新格式校验和验证通过（`checksumStatus='verified'`） | ✅ |
| **数据被篡改 → 校验和不匹配并拒绝** | ✅ |
| **未来 formatVersion=2 → 拒绝** | ✅ |
| 旧信封（无 formatVersion/checksum）→ 可导入且标记未校验 | ✅ |
| 旧版裸 AppData → 兼容导入（format='legacy'） | ✅ |
| 高 schemaVersion → 拒绝 | ✅ |
| 非法 JSON / 缺字段 → 拒绝 | ✅ |
| **超大文件（>20MB）→ 拒绝且不解析** | ✅ |
| 重复任务 ID → 保留首次、计入摘要 | ✅ |
| 非法时间 `99:99` / 优先级 9 / 时长 99999 → 规范化 | ✅ |
| 超长备注 → 截断 5000 | ✅ |
| 非法 settings（name 对象/theme 非法/weekStart 5）→ 回落默认 | ✅ |
| 重复项目 ID → 去重 | ✅ |
| 规范化产生可见 warning | ✅ |
| 不存在的 projectId → 置空并计数 | ✅ |
| 非法打卡日期丢弃 + 重复打卡去重 | ✅ |

- **总计：141/141 通过**（原 125 + 新增 16 项；不含原有仍保留的备份/旧数据用例）
- 原有 `parseImportedData` / 旧 localStorage 解析 / 迁移用例全部保持通过

---

## 6. TypeScript 与构建

| 检查 | 结果 |
|---|---|
| `tsc --noEmit` | ✅ 0 错误 |
| `npm run build` | ✅ CSS 43.80 kB（gzip 8.65）/ JS 369.53 kB（gzip 114.08） |
| 生产调试变量扫描（`__FD_/__BENCH`） | ✅ 0 命中 |
| 真实浏览器 E2E（原有 90 项） | ✅ 90/90（导入导出、迁移、备份恢复流程未回归） |
| 真实导出文件实测 | ✅ `formatVersion=1`、`sha-256` 64 hex、counts `{tasks:9,projects:3,habits:3,habitLogs:9}` 与数据一致 |

> E2E 中导入的测试文件是**旧信封格式（无 checksum）**，验证了"旧格式继续兼容且标记未校验"的真实路径。

---

## 7. 兼容性与注意事项

1. **旧备份可导入**：旧信封 / 裸 AppData 均通过，但明示"未校验"；新导出才带 SHA-256。
2. **非安全上下文限制**：`crypto.subtle` 仅在 `localhost`/HTTPS 可用。局域网 http 下导出会得到 `checksum: null`（页面提示"未附加校验和"）；导入带 checksum 的文件会被拒绝并提示在 localhost/HTTPS 导入（不会误报通过）。
3. **规范化规则对旧数据的可见影响**：加载历史数据时，若存在非法 projectId/日期/时间等，会被规范化为安全值（原本也会兜底，但规则更严格）；正常合法数据输出不变。
4. **校验和只覆盖 `data`**：信封元数据（导出时间、counts 等）不参与摘要；counts 不一致会给出 warning，但不影响数据导入（数据本身已被校验和保护）。
5. **未改变**：AppData、reducer、IndexedDB 结构、现有导入的"覆盖确认"交互（4.4-B 才替换为预览弹窗）。

---

## 8. 费用（估算）

| 项目 | 费用 |
|---|---|
| 代码实现（backup/data/Settings/AppShell） | ~0.55 元 |
| 单元测试与调试（含一次 fixture 修正） | ~0.20 元 |
| 构建 + 真实浏览器 E2E 回归 | ~0.10 元 |
| 报告/交付 | ~0.05 元 |
| **4.4-A 合计** | **约 0.90 元（0.8–1.1，未超 1.4 元上限）** |
| 剩余预算（9.25 − 0.9） | **约 8.35 元**（4.4-B 上限 3 元，预估 1.0–1.5 元） |

**未超预算、未自行进入 4.4-B，已停止等待验收。**

---

## 9. 交付物

| 交付物 | 路径 |
|---|---|
| 本报告 | `docs/phase4.4/PHASE4.4-A-REPORT.md` |
| 逻辑测试输出 | `npm test`（141/141，控制台输出） |
| 真实导出样例（E2E 产生） | `.tmp/e2e-download/flowday-backup-2026-11-14.json`（新格式，含 checksum） |
| 既有 E2E 报告 | `docs/phase4.4/e2e-report.json` |
