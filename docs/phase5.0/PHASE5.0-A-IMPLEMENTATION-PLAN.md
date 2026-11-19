# Phase 5.0-a 实施计划（产品补洞）

> 文档日期：2026-11-17
> 基线：`main` = `d6297ab`（tag `phase4.5-accepted`）、设计分支 = `phase5.0-a`（自 `phase4.6-assessment` 切出）
> 状态：**设计完成，等待开发授权**。本文档不含任何产品代码改动。
> 范围：仅 5 项 —— 项目 CRUD、PWA 安装、Service Worker 离线壳、任务删除撤销、新用户引导。
> 明确不做：提醒通知、重复任务、子任务、全局搜索、AI、云同步。

---

## 0. 设计结论摘要

| 决策点 | 结论 |
|---|---|
| 数据库结构 | **不升级 `schemaVersion`（保持 2）**。仅新增可选字段（`Project.archived/createdAt`、`Settings.onboarded`），缺失即按默认值处理；升级会触发现有「版本过高」拒绝路径，存在被 demo 数据覆盖的风险（见 §3.4） |
| 删除项目 | **只提供一种策略：任务移入「未分类」**（清除 `projectId`），不提供级联删任务；一次 reducer 变更 = 一次 CAS 保存 |
| 归档 | `archived` 布尔标记；任务引用保留；默认列表隐藏，可显式查看/恢复；不改变历史任务 |
| Undo | **立即删除 + 补偿恢复**（不是延迟提交）；8 秒窗口；连续删除仅最后一次可撤销；跨路由保留、刷新/关闭即终结 |
| 删除确认 | **保留现有确认弹窗**，在其后追加撤销 Toast —— 保证 90 项既有 E2E 零回归，同时满足「删除后可撤销」 |
| PWA | manifest + 自研 `sw.js`（无构建插件、无新依赖）：shell 预缓存 + 导航 network-first 回退 + 哈希资源 cache-first；**更新只提示不自动激活** |
| 导航结构 | 桌面侧边栏新增「项目」；移动端底部导航**保持 5 项**，项目入口放在任务页顶部「任务 / 项目」分段 |
| 引导 | 仅「空数据 + 非示例数据 + 未完成过」触发；3 步可跳过；Settings 可重新查看；写入 `settings.onboarded` |

---

## 1. 当前架构与实现位置映射

### 1.1 关键模块地图

| 层 | 文件 | 职责 | 本阶段是否改动 |
|---|---|---|---|
| 类型 | `src/types.ts` | `Task/Project/Habit/Settings/AppData` | ✅ 加可选字段 |
| 数据校验 | `src/lib/data.ts` | `sanitizeImportedDataDetailed`：导入/加载/迁移共用规范化；**settings 为白名单** | ✅ 扩展 project/settings 白名单 |
| 结构版本 | `src/lib/storage/schema.ts` | `CURRENT_SCHEMA_VERSION = 2`；`migrateStoredState` 拒绝高版本 | ❌ 不改 |
| 存储 | `src/lib/storage/{db,index}.ts` | IndexedDB 单文档 + CAS（`saveAppData`/`forceSaveAppData`）+ revision | ❌ 不改 |
| 持久化 | `src/store/persistence.ts` | 180ms 防抖、CAS 冲突、失败降级 | ❌ 不改 |
| 同步 | `src/store/{syncMachine,syncActions,syncTypes}.ts` | 通道、revision 决策、冲突三选一 | ❌ 不改 |
| 状态 | `src/store/AppStore.tsx` | 初始化、自动保存、主题、调试桥 | ⚠️ 仅接入 Undo/Onboarding Provider |
| 动作 | `src/store/reducer.ts` | 8 类 action（无 project 动作） | ✅ 新增 project 动作 |
| 选择器 | `src/lib/selectors.ts` | 排序/分组/统计（纯函数，可单测） | ✅ 新增项目统计与解析 |
| 路由 | `src/App.tsx` | 6 路由 | ✅ 加 `/projects`、`/projects/:id` |
| 外壳 | `src/components/AppShell.tsx` | 桌面侧边栏 + 移动底栏 + 账户菜单 | ✅ 桌面加「项目」 |
| 通用组件 | `src/components/UI.tsx` | `Modal`/`Confirm`/`Toast`/`EmptyState`/`Segmented`/焦点管理 | ✅ Toast 支持动作按钮（向后兼容） |
| 任务行 | `src/features/tasks/TaskRow.tsx` | 勾选/编辑/删除（含确认弹窗） | ✅ 删除接入 Undo |
| 任务虚拟列表 | `src/features/tasks/TaskRows.tsx` | `VirtualRows` 大数据虚拟滚动 | ♻️ 项目详情直接复用 |
| 任务编辑 | `src/features/tasks/TaskEditor.tsx` | 表单（含「分类」下拉，当前只读项目列表） | ✅ 加「＋ 新建项目」 |
| 任务页 | `src/features/tasks/TasksPage.tsx` | 搜索/筛选/分组/空状态 | ✅ 加任务/项目分段入口 + 空状态 CTA |
| 今日页 | `src/features/today/DashboardPage.tsx` | 焦点/进度/7 日/时间线/习惯 | ✅ 空状态 CTA |
| 设置页 | `src/features/settings/SettingsPage.tsx` | 资料/外观/AI/数据/导入导出 | ✅ 加应用与维护分区 |
| 入口 | `src/main.tsx` | 挂载 | ✅ prod 下注册 SW |
| 样式 | `src/styles.css` | Token + 玻璃层级 | ✅ 复用为主，少量新类 |
| HTML | `index.html` | 仅 viewport/theme-color/favicon | ✅ manifest / apple 图标 |
| 静态资源 | `public/` | 仅 `bench-blank.html` | ✅ manifest/icons/sw.js |
| 测试 | `src/tests/smoke.test.ts`（231） | 逻辑测试 | ✅ 追加用例 |
| 测试 | `scripts/e2e*.mjs`（90/14/29/35） | CDP E2E | ✅ 追加 4 套 |

### 1.2 现有约束（设计必须遵守）

1. **唯一写入口**：`saveAppData(data,{baseRevision,writerId})` → 单事务 CAS；任何状态变更都必须走 `dispatch`，不得绕过。
2. **加载即规范化**：`migrateStoredState` → `sanitizeImportedData` 每次读取都会重建数据对象；**新增字段若不在白名单里会被静默丢弃**（这是本阶段最容易踩的坑）。
3. **错误引用处理已有先例**：`sanitizeImportedData` 会把指向不存在项目的 `projectId` 置空并计入 `brokenProjectRefs`，运行时需与之保持一致的降级语义。
4. **Toast 目前无动作**：`toast(text, tone)` 固定 2400ms 自动消失，需扩展出「动作 + 长时长」形态（保持旧行为不变）。
5. **E2E 依赖的稳定选择器**：`[data-fd-toast]`、`[data-fd-confirm]`、`[data-fd-dialog]`、`window.__FD_STATE__`、`window.__FD_STORAGE__`、`window.__FD_SYNC_CHECK__`（DEV 注入）。新功能不得改动这些契约。
6. **dev / preview 差异**：现有 E2E 跑 dev server（5173）；SW 只在生产构建注册，PWA 测试必须另起 preview 服务器。

---

## 2. 项目 CRUD 详细设计

### 2.1 数据模型（最小新增）

```ts
// src/types.ts —— 仅新增可选字段，不改既有字段
export interface Project {
  id: string;
  name: string;
  color: string;
  /** 新增：归档标记，缺省视为未归档 */
  archived?: boolean;
  /** 新增：创建时间（用于稳定排序，缺省回落到 name 排序） */
  createdAt?: string;
}

export interface Settings {
  name: string;
  theme: ThemeMode;
  weekStart: 0 | 1;
  aiEnabled: boolean;
  demoData: boolean;
  /** 新增：是否已完成/跳过上手引导 */
  onboarded?: boolean;
}
```

`AppData.version` 保持 `1`；`CURRENT_SCHEMA_VERSION` 保持 `2`（论证见 §3）。`Task` 不变（`projectId` 已存在）。

### 2.2 校验与规范化扩展（`src/lib/data.ts`）

```ts
// projects 分支追加（保持既有字段处理不变）
const archived = typeof p.archived === 'boolean' ? p.archived : false;
const createdAt = isValidIso(p.createdAt) ? p.createdAt : undefined;
projects.push({ id, name: name.trim().slice(0, MAX_NAME), color, archived, createdAt });
```

- 规则：`archived` 非布尔 → 置 `false`（计数 `fixedFields`）；`createdAt` 非法 → 丢弃该字段（不阻断）。
- `settings` 白名单追加：`onboarded` 仅接受布尔，缺省 `false`。
- 新增统计项（供导入预览展示，**不改变既有字段含义**）：
  - `stats.archivedProjects: number`（信息性统计）
  - 保持 `brokenProjectRefs` 语义不变。

### 2.3 Reducer 动作（`src/store/reducer.ts`）

```ts
| { type: 'project/add'; project: Project }
| { type: 'project/update'; id: string; patch: Partial<Pick<Project,'name'|'color'>> }
| { type: 'project/archive'; id: string; archived: boolean }   // 归档/恢复共用
| { type: 'project/delete'; id: string }                       // 清除关联任务的 projectId（唯一策略）
| { type: 'data/repairOrphanProjects' }                        // 维护：清除未知 projectId
| { type: 'task/add'; task: Task }                             // 复用：Undo 恢复
```

要点：

- `project/delete` **纯函数内一次完成**「移除项目 + 置空关联任务 `projectId`」，保证单次 state 变化 → 单次 CAS 保存，不会出现「项目已删但任务仍引用」的中间态。
- `project/add` 前置：`id` 用 `uid('p')`；`name` 去空白、截断 64；`color` 必须匹配 `^#[0-9a-fA-F]{6}$` 否则回落 `DEFAULT_PROJECT_COLOR`；重复 id 直接忽略（幂等）。
- `project/update` 不改变 `archived/createdAt`，仅 name/color；name 为空时忽略（不产生空名项目）。
- `data/repairOrphanProjects`：单次遍历把 `projectId` 指向未知 id 的任务置空；无变更时**返回原 state 引用**（避免无意义保存）。

### 2.4 选择器（`src/lib/selectors.ts`，纯函数、可单测）

```ts
activeProjects(data): Project[]            // archived !== true，按 createdAt desc → name
archivedProjects(data): Project[]          // archived === true
projectStats(data, projectId): {
  total: number; open: number; done: number;
  percent: number;                          // done / total（total=0 → 0）
  weekDone: number; weekTotal: number;      // 本周（按 settings.weekStart）完成/到期数
}
resolveProject(projects, projectId): Project | undefined   // 未知 id → undefined（UI 降级）
orphanProjectTaskIds(data): string[]       // 指向未知项目的任务 id（维护入口用）
```

`projectStats` 复用现有「单遍聚合」风格，避免多次全量遍历；10k 任务下目标 <5ms（基准测试覆盖）。

### 2.5 页面与交互

#### 路由

```
/projects          → ProjectsPage（列表）
/projects/:id      → ProjectDetailPage（详情）
```

- 桌面：`AppShell` 侧边栏在「任务」之后新增「项目」。
- 移动端：底部导航**保持 5 项不变**；`TasksPage` 顶部新增 `Segmented`「任务 / 项目」（切到项目即导航 `/projects`）。理由：320px 下 6 项底部导航会挤压，且现有 5 项是验收基线。
- 项目详情页顶部提供面包屑「项目 / <名称>」返回列表，移动端可返回。

#### 项目列表页 `ProjectsPage`

- 顶部：标题「项目」+ 计数（活动 N）+ 主按钮「新建项目」。
- 卡片网格（`sm:grid-cols-2 xl:grid-cols-3`），每张卡：
  - 颜色圆点 + 项目名（超长省略，`title` 提供完整名）
  - 进度环（复用 `ProgressRing`，尺寸 44，仅展示百分比）
  - `未完成 N · 已完成 M`
  - 本周：`本周完成 X`（`weekDone`）
  - 操作：编辑（铅笔）/ 归档（箱子）/ 删除（垃圾桶，`aria-label="删除项目 <名>"`）
- 归档区：页面底部可折叠「已归档项目（N）」，默认收起；展开后可「恢复」。
- 空状态：无任何项目且有任务 → 「把已有任务归入项目」引导；完全空 → 「创建第一个项目」CTA。

#### 项目详情页 `ProjectDetailPage`

- 头部：颜色点 + 名称（可点开编辑）+ 归档徽标 + `...` 菜单（编辑 / 归档 / 删除）。
- 概览行：进度环 + `完成率 NN%` + `未完成 N / 已完成 M` + `本周完成 X`。
- 任务区：`未完成`（按现有 `sortTasks`）/ `已完成`（按 `completedAt` 倒序）两组，**直接复用 `TaskRows`（含 `VirtualRows`）**，保证 10k 任务下不退化为全量渲染。
- 主操作：「＋ 新建任务」→ 打开 `TaskEditorModal` 并预填 `projectId`。
- 未知 id：`/projects/<不存在的 id>` → 渲染「项目不存在或已删除」空状态 + 返回列表按钮（不崩溃、不自动跳转）。
- 归档项目详情：顶部玻璃提示条「该项目已归档 · 只读提示」，仍可查看任务、可恢复；新建任务按钮禁用并说明原因。

#### 项目编辑器 `ProjectEditorModal`（新建/编辑共用）

- 字段：名称（必填，≤64，`aria-required`）、颜色（8 个预设色板 `PROJECT_COLORS` + 当前色高亮，单选按钮组 `role="radiogroup"`）。
- 校验：空白名 → 行内错误 + 聚焦标题（沿用 `TaskEditor` 的错误模式与 `aria-invalid/aria-describedby`）。
- 键盘：Enter 提交（名称输入框内）、Esc 关闭；打开时聚焦名称输入框（`data-autofocus`）。
- 保存：`project/add` 或 `project/update`，成功 Toast「项目已创建」/「项目已更新」。

#### 删除项目 `DeleteProjectModal`

- 展示影响范围：`该项目下有 N 个未完成任务、M 个已完成任务`。
- **唯一策略（5.0-a）**：任务保留 → 移入「未分类」（清除 `projectId`）。
- 文案明确：「项目将被删除，N 个任务会保留并移动到「未分类」」。
- 主按钮 danger「删除项目」；`Confirm` 风格焦点管理复用 `useDialogFocus`。
- 归档项目删除：同样规则。

#### 任务编辑器内的快速建项目

- 「分类」下拉下方新增幽灵按钮「＋ 新建项目」→ 打开轻量内联弹窗（名称 + 颜色），创建成功后**自动回填**到当前草稿的 `projectId`，不关闭任务编辑弹窗。
- 下拉结构改为 `optgroup`：`活动项目` / `已归档项目`（仅当当前任务所属项目已归档时显示该项并标注「已归档」）/ `未分类`。
- 若当前任务的 `projectId` 未知（孤儿引用）：显示占位项「未分类（原项目已删除）」并在保存时清除该引用。

### 2.6 归档语义（明确边界）

| 行为 | 未归档项目 | 已归档项目 |
|---|---|---|
| 项目列表默认可见 | ✅ | ❌（折叠区） |
| 任务行显示项目名/色 | ✅ | ✅ + 「已归档」徽标（低对比度文本） |
| 新建任务可选该项目 | ✅ | ❌（除非编辑既有任务） |
| 项目详情可访问 | ✅ | ✅（只读提示，禁新建） |
| 统计（Dashboard/项目统计） | 计入 | 计入历史，但不显示「本周」进行中提示 |
| 删除 | ✅ | ✅ |

### 2.7 未定义 projectId 的安全降级（三层）

1. **加载/导入层**：现有 `sanitizeImportedData` 已置空并计入 `brokenProjectRefs`（保持）。
2. **运行层**：`resolveProject` 返回 `undefined` → UI 视为「未分类」，不抛错、不显示空白色点；`TaskEditor` 显示占位项并在保存时清除。
3. **修复层**：设置页「数据维护」显示 `发现 N 个任务指向不存在的项目` + 按钮「归为未分类」→ `data/repairOrphanProjects`（一次保存）。

---

## 3. Project 数据结构兼容方案

### 3.1 兼容矩阵

| 场景 | 数据 | 处理 |
|---|---|---|
| 旧 IndexedDB（schemaVersion 2，无 archived/onboarded） | 读取 | `sanitize` 补默认值（`archived=false`、`onboarded=false`），无迁移写入 |
| 旧备份（formatVersion 1 / schemaVersion 1–2） | 导入 | 现有 `validateBackupDetailed` 接受；`sanitize` 补默认值；新增统计含 `archivedProjects` |
| 新备份 → 旧应用 | 导入 | 旧 `sanitize` 丢弃未知字段（`archived/onboarded` 丢失，但**结构与引用完整、不损坏**）；已在文档中声明 |
| 旧应用（SW 缓存）读到新数据 | 读写 | 同上：`archived` 被丢弃后项目回到活动态，不损坏数据；由 PWA 更新提示缩短窗口（§4） |
| 重复导入既有项目 id | 导入 | 现有去重逻辑保留首次出现，计数上报 |

### 3.2 备份格式

- `BACKUP_FORMAT_VERSION` 保持 `1`：新增字段是 `data` 内部的可选字段，信封结构未变。
- `CURRENT_SCHEMA_VERSION` 保持 `2`：见 §3.4 论证。
- 校验和：`sha256Hex(canonicalBackupPayload(data))` 对 data 计数 → 新增可选字段会改变校验和，属预期（新旧备份各自自洽）。

### 3.3 为什么不需要 IndexedDB 升级

- 存储是**单文档整份 `AppData`**（`app` store 一个键），不存在「表结构」概念；新增字段只改变文档形状。
- `DB_VERSION` 仅在需要新建 object store / 索引时升级，本阶段无此需求。
- `sanitize` 已承担形状规范化职责，旧文档读入即补默认值。

### 3.4 为什么**不**升级 `CURRENT_SCHEMA_VERSION`（重要）

现状风险：`initializeStorage` 在遇到「版本高于当前」时返回 `{data:null, error}`，而 `AppStore` 随后仍会 `setReady(true)` 并触发自动保存副作用（`controller.requestSave(demoData())`），存在**用示例数据覆盖真实数据**的路径。

因此：

1. 本阶段采用**纯可选字段**策略，不触发「版本过高」分支（`migrateStoredState` 只比较 `schemaVersion` 数字）。
2. 若未来必须升级 schema（如字段语义变更），**前置任务**：先修复初始化失败路径（`persistence=false` 且禁止自动保存），再升级版本号。该修复已登记为 Phase 5.0-b 候选，不在 5.0-a 范围。
3. 该决策会写入阶段报告，避免后续误判为遗漏。

---

## 4. PWA 缓存与更新架构

### 4.1 资源与文件

| 文件 | 说明 |
|---|---|
| `public/manifest.webmanifest` | `name/short_name/id/start_url/scope/display/theme_color/background_color/lang/icons` |
| `public/icons/icon-192.png`、`icon-512.png` | `purpose: "any"` |
| `public/icons/icon-192-maskable.png`、`icon-512-maskable.png` | `purpose: "maskable"`（安全区 ≥80%） |
| `public/icons/apple-touch-icon-180.png` | iOS 主屏图标 |
| `public/icons/icon-source.svg` | 源文件（由现有渐变 favicon 派生），便于重生成 |
| `public/sw.js` | 自研 Service Worker（无构建插件、无新依赖） |
| `index.html` | 追加 `<link rel="manifest">`、apple 图标与 meta |

**图标生成**：使用离线工具（本地 Pillow）从 `icon-source.svg` 的等价渐变光栅化为所需尺寸后提交 PNG；仓库**不引入**任何图片处理依赖。清单中记录尺寸与用途，便于回归检查。

manifest 关键值：

```json
{
  "name": "FlowDay · 把今天安排明白",
  "short_name": "FlowDay",
  "id": "/",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "orientation": "portrait-primary",
  "lang": "zh-CN",
  "theme_color": "#FAF7F2",
  "background_color": "#FAF7F2",
  "icons": [ "...192 any", "...512 any", "...192 maskable", "...512 maskable" ]
}
```

> 顺带修正一处既有不一致：`index.html` 初始 `theme-color` 为 `#FAF7F2`，而 `AppStore` 在主题副作用里改为 `#F5F5F7`/`#000000`。本阶段统一为「浅色 `#FAF7F2`、深色 `#000000`」，manifest 与 meta 同源。

### 4.2 缓存策略矩阵

| 请求 | 策略 | 缓存 | 说明 |
|---|---|---|---|
| 导航请求（`mode === 'navigate'`） | network-first（3s 超时）→ 回退缓存 `/index.html` | `fd-shell-v1` | SPA 路由由前端接管，回退 index 即可保留路由 |
| `/assets/*`（哈希文件名） | cache-first → 未命中则网络并写入 | `fd-runtime-v1` | 内容哈希 → 可长期缓存 |
| `manifest.webmanifest`、`/icons/*` | stale-while-revalidate | `fd-shell-v1` | 图标更新不阻塞启动 |
| 其他**同源 GET** | network-only（不缓存） | — | 避免误缓存数据类响应 |
| 非 GET / 跨域 / `chrome-extension://` | 直接放行 | — | — |
| **明确不缓存** | 备份文件（`Blob` 下载不经过 SW）、任何带 `Authorization` 的请求、`Cache-Control: no-store` 响应 | — | 用户数据与备份永不进入 Cache Storage |

缓存命名：`fd-shell-v1`（外壳）、`fd-runtime-v1`（哈希资源）；版本常量在 `sw.js` 顶部**手动递增**，并写入阶段报告（升级清单）。

### 4.3 更新状态机

```
注册（prod） → install（预缓存 shell，SW 进入 waiting）
     │
     ├─ 无新版本：idle
     └─ updatefound → 新 SW installed
            │
            ├─ 提示条：「发现新版本 · 立即更新 / 稍后」
            │       │（用户点“立即更新”）
            │       └─ worker.postMessage('SKIP_WAITING') → activate → controllerchange → 一次性 reload
            └─ 用户忽略：旧版本继续可用；下次触发检查时再次提示
```

**防循环与逃生舱**：

- `sessionStorage['fd_pwa_reload']` 计数，单会话最多自动 reload 1 次；超过则**不再 reload**。
- 若页面在 5 秒内连续两次 `controllerchange`，判定异常 → `registration.unregister()` + 清空全部 `fd-*` 缓存 + 硬刷新一次（`location.reload()` 前设 `fd_pwa_escape=1`）。
- 更新提示在「存在未保存修改」（`hasUnsavedChanges()`）时降级为「稍后」，不自动打断。

**检查时机**：启动后 3s 首次 `registration.update()`；`visibilitychange` → visible 且距上次 >30min 时检查；手动「设置 → 检查更新」按钮。

**不做自动 `skipWaiting()`**：避免用户在编辑中被强制换版本导致未保存状态丢失。

### 4.4 离线与数据安全

- SW **不接触 IndexedDB**：离线期间数据读写仍由应用自身完成（IndexedDB 在本地，离线可用）。
- 离线启动：`index.html` 已预缓存 → 进入应用壳 → 应用从 IndexedDB 读数据 → 完全可用（除网络相关功能，本阶段无）。
- 备份导出：走 `Blob` + `URL.createObjectURL`，不经过网络与 SW 缓存。
- 冲突/同步横幅等既有机制不受 SW 影响（BroadcastChannel 与 IDB 均在本地）。

### 4.5 浏览器边界（明确声明）

| 平台 | 安装 | 离线 | 更新 |
|---|---|---|---|
| Chrome/Edge（桌面 + Android） | ✅ 安装按钮 / 地址栏图标 | ✅ | ✅ 提示 + 手动激活 |
| Safari（macOS） | ✅「添加到程序坞」 | ✅ | ✅ |
| iOS Safari（16.4+） | ✅「添加到主屏幕」（`display: standalone`） | ✅ | 提示行为受系统限制，可能需重开 |
| iOS 26+ | 添加到主屏默认以应用形态打开 | ✅ | 同上 |
| Firefox 桌面 | ⚠️ 无安装入口（可正常使用网页） | ✅ 缓存生效即可 | ✅ |
| 旧版 iOS（<16.4） | ⚠️ 可添加主屏但不支持 SW 推送/部分能力 | 部分 | 不保证 |

本阶段**不做 Web Push**（`Notification` 权限不申请）。

---

## 5. Undo 与 CAS 兼容方案

### 5.1 设计选择：立即删除 + 补偿恢复

| 备选 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 延迟提交（窗口结束再写库） | 撤销「零成本」 | 关闭/刷新可能丢删除；多标签看到「幽灵任务」；需要 flush 时序保证 | ❌ |
| **立即删除 + 撤销时重新添加（补偿）** | 语义简单、与现有 CAS 天然兼容、刷新/关闭行为确定 | 撤销是一次新写入（revision 前进） | ✅ 采纳 |

### 5.2 状态机

```
删除（确认弹窗后）
  ├─ dispatch({type:'task/delete', id})        → 立即从 UI 移除，经 180ms 防抖 CAS 落库
  ├─ UndoProvider.pending = { task 快照, at, toastId }
  └─ Toast（8s，含「撤销」动作）

撤销（8s 内）
  ├─ 若当前 data 已存在同 id（他标签恢复过）→ 幂等跳过 + info Toast「任务已存在」
  ├─ dispatch({type:'task/add', task: 快照})   → 原 id/原字段/原 completed 状态
  └─ Toast「已恢复」

超时 / 新删除 / 路由变化
  ├─ 超时：清除 pending（删除已成事实）
  ├─ 新删除：pending 被替换（前一次成为最终删除）
  └─ 路由变化：provider 在根层，pending 与 Toast 继续有效
```

### 5.3 边界行为表

| 场景 | 行为 |
|---|---|
| 8 秒内点「撤销」 | 任务以原 id 完整恢复（含标题/备注/日期/时间/优先级/项目/完成态/createdAt） |
| 超时 | 保持删除；Toast 消失 |
| 连续删除 2 个任务 | 仅最后一个是可撤销；先删的那次已成最终删除（Toast 文案切换为「已删除「X」· 撤销」） |
| 路由切换 | 撤销 Toast 仍在（全局 Provider + 全局 Toast 层） |
| 页面刷新 / 关闭标签页 | 删除保留；撤销入口丢失（**明确告知**，不提供跨刷新撤销） |
| 多标签：A 删除后 B 又写入 | A 撤销 → 正常 CAS 保存，revision 前进；若基线已被 B 推进 → 走既有冲突横幅（三选一），**不静默覆盖** |
| 多标签：B 同时删除同一任务 | 双方都删除 → 一致性由 CAS/revision 保证；撤销在任一标签都会恢复该任务，另一标签收到外部更新提示 |
| 存储失败（持久化关闭） | 与现有行为一致：错误 Toast + 持久化禁用；内存态仍可撤销 |

### 5.4 组件改动

- `src/components/UI.tsx`：`ToastProvider` 内部结构扩展

```ts
interface ToastApi {
  toast(text: string, tone?: ToastTone): void;            // 保持原签名（旧调用不受影响）
  toastAction(text: string, opts: {
    actionLabel: string;
    onAction: () => void;
    duration?: number;   // 默认 8000
    tone?: ToastTone;
  }): void;
}
```

- Toast 项增加 `action` 字段，渲染 `<button data-fd-toast-action>`；`role="status"` 与 `[data-fd-toast]` 属性保持不变（既有 E2E 零影响）。
- 长时长 Toast 需 `aria-live="polite"` 保持；动作按钮可获得键盘焦点（Tab 可达），但不抢占当前焦点。
- 新增 `src/store/undoStore.tsx`：`UndoProvider` + `useUndoDelete()`，挂载在 `App.tsx`（`ToastProvider` 内层）。

### 5.5 与现有确认弹窗的关系

保留 `TaskRow` 现有 `confirm`（删除任务？）→ 删除后 Toast 改为带动作的撤销形态。

- 理由：现有 `e2e.mjs` 中存在依赖 `[data-fd-confirm]` 的删除断言，移除确认会破坏「90 项零回归」。
- 收益：移动端误触由确认弹窗拦截，确认后误删由撤销兜底。
- 未来（5.0-b 可评估）：改为「无确认 + 多步撤销历史」。

---

## 6. 新用户引导交互设计

### 6.1 触发条件（全部满足）

```
storage.ready === true
&& data.settings.onboarded !== true
&& !data.settings.demoData
&& data.projects.length === 0
&& data.tasks.length === 0
&& data.habits.length === 0
```

- 有示例数据 → 不弹引导（改用现有示例横幅）。
- 已有任何数据 → 不弹（升级用户不打扰）。
- 引导完成/跳过 → `dispatch settings/update { onboarded: true }`，立即持久化。

### 6.2 三步向导（`OnboardingWizard`）

| 步骤 | 内容 | 操作 | 可跳过 |
|---|---|---|---|
| 1 欢迎 | 一句话定位「把今天安排明白」；说明**数据只存在本机 IndexedDB**（隐私）；提示可随时在设置里重看 | 「开始」/「跳过」 | ✅ |
| 2 建项目 | 项目名（默认建议「工作」）+ 颜色选择（8 色）；右侧预览卡片（玻璃卡） | 「创建并继续」/「暂时跳过」 | ✅ |
| 3 建任务 | 任务标题（默认聚焦）+ 日期（默认今天）→ 自动挂在第 2 步的项目下 | 「完成」/「跳过」 | ✅ |
| 完成 | 「已为你创建 <项目> 和第一条任务」+ 进入「今日」CTA | 「去今日看看」 | — |

- 视觉：复用 `fd-glass fd-glass-modal`、`fd-pop`、Token 圆角/阴影/动效；步骤指示器使用 3 个小圆点（`aria-current="step"`）。
- 无障碍：`role="dialog" aria-modal="true"`、打开聚焦首要素、Tab 循环、Esc = 跳过（明确告知副作用）、完成后焦点归还「新会话/新建」触发点或主区域。
- 非强制：任何一步都可跳过；跳过不阻断后续使用。
- 可重看：设置页「重新查看上手引导」→ 以**回顾模式**打开同一向导（不重置 `onboarded`、不重复写库）。

### 6.3 空状态矩阵

| 位置 | 条件 | 文案与动作 |
|---|---|---|
| 项目列表 | 无项目 | 「还没有项目」+「创建第一个项目」；若已有任务 → 追加「把已有任务归入项目」说明 |
| 任务页 | 无任务 | 「今天想先完成哪件事？」+「新建任务」；若同时无项目 → 次按钮「先建一个项目」 |
| 今日页 | 今日无任务 | 现有空态 + 「新建今日任务」CTA（复用现有快速添加） |
| 习惯页 | 无习惯 | 现有空态 + 「添加第一个习惯」CTA |
| 项目详情 | 项目无任务 | 「这个项目还没有任务」+「在该项目下新建任务」 |

所有空状态使用现有 `EmptyState`（玻璃卡 + 渐变图标），文案遵循「一句说明 + 一个主操作」。

---

## 7. 文件修改清单

### 7.1 新增文件（15）

| 文件 | 行数估算 | 说明 |
|---|---|---|
| `src/features/projects/ProjectsPage.tsx` | ~180 | 项目列表、归档折叠区、空状态 |
| `src/features/projects/ProjectDetailPage.tsx` | ~200 | 详情、统计头、任务列表（复用 TaskRows） |
| `src/features/projects/ProjectEditorModal.tsx` | ~130 | 新建/编辑（名称 + 颜色） |
| `src/features/projects/DeleteProjectModal.tsx` | ~90 | 删除影响说明 + 唯一策略 |
| `src/features/projects/ProjectCard.tsx` | ~80 | 列表卡片（可复用） |
| `src/features/onboarding/OnboardingWizard.tsx` | ~220 | 三步向导 + 回顾模式 |
| `src/store/undoStore.tsx` | ~90 | Undo context/hook/pending 状态 |
| `src/lib/projects.ts` | ~110 | 项目纯函数（stats/resolve/orphan），供选择器与测试复用 |
| `src/lib/pwa/register.ts` | ~120 | SW 注册、更新事件、逃生舱 |
| `src/lib/pwa/cachePolicy.ts` | ~60 | 纯策略函数（可单测；与 sw.js 常量一致性校验） |
| `src/components/UpdateBanner.tsx` | ~80 | 新版本提示条（可访问） |
| `public/manifest.webmanifest` | ~35 | 应用清单 |
| `public/sw.js` | ~180 | 缓存策略 + 更新消息协议 |
| `public/icons/*`（5 个 PNG + 1 SVG） | — | 192/512/any/maskable/apple-touch |
| `docs/phase5.0/PHASE5.0-A-IMPLEMENTATION-PLAN.md` | 本文档 | — |

### 7.2 修改文件（14）

| 文件 | 变更 |
|---|---|
| `src/types.ts` | `Project.archived/createdAt?`、`Settings.onboarded?` |
| `src/lib/data.ts` | projects/settings 白名单扩展；统计项 `archivedProjects` |
| `src/store/reducer.ts` | 新增 5 个 project 动作 + `data/repairOrphanProjects` |
| `src/lib/selectors.ts` | `activeProjects/archivedProjects/projectStats/resolveProject/orphanProjectTaskIds` |
| `src/App.tsx` | 2 条路由 + `UndoProvider` + `OnboardingWizard` 挂载 |
| `src/components/AppShell.tsx` | 桌面侧边栏「项目」入口；版本检查入口（可选） |
| `src/components/UI.tsx` | `toastAction` 扩展（向后兼容）+ Toast 动作按钮渲染 |
| `src/features/tasks/TaskRow.tsx` | 删除 → `useUndoDelete()`（保留确认弹窗） |
| `src/features/tasks/TaskEditor.tsx` | 项目下拉 optgroup + 「＋ 新建项目」内联 + 孤儿引用占位 |
| `src/features/tasks/TasksPage.tsx` | 「任务 / 项目」分段入口；空状态 CTA |
| `src/features/today/DashboardPage.tsx` | 空状态 CTA（引导创建） |
| `src/features/settings/SettingsPage.tsx` | 「应用」分区（安装/检查更新/重看引导）+「数据维护」（孤儿修复） |
| `src/main.tsx` | prod 注册 SW |
| `src/styles.css` | 少量新类（项目卡片/向导步骤/更新条），全部基于既有 Token |
| `index.html` | manifest、apple 图标、theme-color 统一 |
| `src/tests/smoke.test.ts` | 追加约 60 条断言 |

### 7.3 新增测试脚本（4）

`scripts/e2e-projects.mjs`、`scripts/e2e-undo.mjs`、`scripts/e2e-onboarding.mjs`、`scripts/e2e-pwa.mjs`。

> 约束：**不修改**既有 `scripts/e2e*.mjs` 的断言；如需公共工具函数，新增 `scripts/lib/` 内的独立文件，不动现有脚本内部实现。

---

## 8. 测试计划

### 8.1 单元/逻辑（`src/tests/smoke.test.ts`，新增 ≥60 断言）

| 组 | 覆盖 |
|---|---|
| 项目 reducer | add/update/archive/restore/delete；delete 后任务数不变且 `projectId` 清空；未知 id 无副作用；重复 id 幂等；name 空忽略；color 非法回落 |
| 项目选择器 | `activeProjects` 排序（createdAt→name）、`archivedProjects`、`projectStats`（含 total=0 边界、weekStart=0/1 两种）、`orphanProjectTaskIds` |
| 数据兼容 | 旧数据（无 archived/onboarded）→ 默认值；新数据回读保真；`sanitize` 丢弃非法 archived；`brokenProjectRefs` 行为不变；备份导入含 archived 项目 |
| Undo 纯逻辑 | 快照构造/恢复 payload 等价；同 id 已存在时幂等跳过；连续删除替换 pending |
| PWA 策略 | `cachePolicy` 分类（navigate/assets/other/cross-origin）、缓存名常量、`sw.js` 与 `cachePolicy.ts` 常量一致性（读源码字符串断言） |
| 引导判定 | `shouldShowOnboarding()` 六条件组合（尤其 demoData 与已有数据不弹） |

### 8.2 E2E 新增（4 套，约 44 项）

| 套件 | 用例（要点） |
|---|---|
| `e2e-projects.mjs`（~18） | 列表空态→创建；编辑名称/颜色；任务关联；详情统计（未完成/已完成/本周）；完成率变化；归档后活动区消失、归档区可见；恢复；删除（任务保留 + 归未分类，任务总数不变）；删除无任务项目；归档项目详情只读；详情未知 id 空态；键盘全流程（Tab/Enter）；弹窗焦点归还；390px 移动端入口；编辑器「＋ 新建项目」回填；orphan projectId 降级渲染（通过 `__FD_STATE__` 注入） |
| `e2e-undo.mjs`（~10） | 删除后出现带「撤销」的 Toast；点击恢复（id/字段/完成态一致）；8s 超时后不可撤销；连续删除 2 条仅最后可撤销；路由切换后仍可撤销；刷新后删除保留；多标签并发写入后撤销不覆盖他页数据（revision 单调 + 数据一致）；持久化失败时不崩溃 |
| `e2e-onboarding.mjs`（~8） | 清空数据库后首次进入出现向导；跳过 → 不再出现；完成 → 项目+任务存在且 `onboarded=true`；刷新不重复；已有数据不弹；示例数据不弹；设置页重看引导（回顾模式不重置标记）；Esc 跳过 |
| `e2e-pwa.mjs`（~8，**跑 `vite preview`**） | manifest 可访问且 JSON 合法、含 192/512/maskable；SW 注册成功且 `registration.active`；缓存名符合 `fd-*`；离线重载渲染应用壳（`CDP Network.emulateNetworkConditions` 离线）；静态资源命中缓存；`/index.html` 回退保留路由；`updatefound` 提示出现（注入新 SW 版本 stub）；缓存中不含任何备份/API 响应 |

### 8.3 无障碍（追加 ~6 条到既有 a11y 套件或新套件）

向导焦点陷阱/ESC、删除项目弹窗键盘操作、项目卡片为链接且有可访问名称、Toast 动作按钮 Tab 可达、更新提示条 `role="status"` 且不抢焦点、移动端底部导航未因新增入口而拥挤（320px 无溢出）。

### 8.4 性能

- 复用既有 10k 数据集基准：项目页/详情页总渲染时间、`projectStats` 计算 ≤5ms、详情页复用 `VirtualRows`（DOM 节点数与原任务页同量级）。
- 门禁：保存 ≤270ms（较基线 245ms 放宽 10%）、搜索 ≤100ms、构建产物 JS 增量 ≤25kB。

### 8.5 手工验证（专项验收）

- **5 名新用户 × 10 分钟**：完成「创建项目 → 在项目下建任务」成功率 ≥90%（记录路径与卡点）。
- **安装**：Chrome/Edge 桌面安装 → 独立窗口启动；Android Chrome 安装；iOS Safari 添加到主屏。
- **离线**：安装后断网二次启动 → 应用壳可用、本地数据可读写。
- **更新**：发布新构建 → 提示出现 → 立即更新 → 无旧 JS/CSS 残留（DevTools Cache Storage 检查）。
- **数据安全**：升级前后任务/项目/习惯计数一致；旧备份可导入；导出再导入往返一致。

---

## 9. 工期与风险评估

### 9.1 工期（1 名资深前端 + AI 辅助，含自测）

| 阶段 | 内容 | 人日 |
|---|---|---|
| D1 | 类型/校验/reducer/选择器/纯函数 + 单元测试 | 2 |
| D2 | 项目列表/详情/编辑器/删除弹窗 + 路由与导航 + 空状态 | 2.5 |
| D3 | Undo Provider + ToastAction + TaskRow 接入 + 边界用例 | 1.5 |
| D4 | PWA（manifest/icons/SW/注册/更新提示） | 2 |
| D5 | 引导向导 + 设置页入口 + 空状态矩阵打磨 | 1 |
| D6 | 4 套 E2E + a11y 追加 + 性能校验 | 1.5 |
| D7 | 回归修复 + 文档 + 最终验收 | 1.5 |
| **合计** | | **12 人日**（含 20% 缓冲） |

### 9.2 风险清单

| # | 风险 | 影响 | 概率 | 缓解 |
|---|---|---|---|---|
| R1 | 新增字段若漏改 `sanitize` 白名单，加载即丢失 | 功能静默失效 | 中 | 单元测试覆盖「保存→重读」往返；代码评审 checklist |
| R2 | SW 缓存导致旧版本长期存活 | 用户看不到修复 | 中 | 只提示不自动激活 + 手动检查入口 + 逃生舱（§4.3） |
| R3 | 图标光栅化无构建链路 | 安装图标缺失/模糊 | 低 | 离线生成 PNG 并提交；E2E 校验 manifest 图标可访问且尺寸正确 |
| R4 | 移除确认弹窗会破坏既有 E2E | 90 项零回归失败 | 高（若改） | **本阶段保留确认弹窗**，只追加撤销 |
| R5 | 项目详情 10k 任务全量渲染 | 性能回退 | 中 | 强制复用 `TaskRows/VirtualRows`；性能门禁 |
| R6 | 删除项目批量清空 `projectId` 在超大数据下变慢 | 交互卡顿 | 低 | 单次 `map`（10k 约 <5ms）；性能用例覆盖 |
| R7 | 引导误导升级用户（已有数据仍弹出） | 体验事故 | 低 | 六条件判定 + 单测 + 已有数据 E2E |
| R8 | 撤销写入触发多标签冲突横幅 | 用户困惑 | 中 | 文案说明「其他标签页有更新」；沿用既有三选一，不静默覆盖 |
| R9 | dev 下 SW 干扰既有 E2E | 回归噪声 | 中 | SW 仅 `import.meta.env.PROD` 注册；PWA 测试独立 preview 端口 |
| R10 | 移动端 6 项导航拥挤 | 视觉回归 | 中 | 底部导航保持 5 项，项目入口另置 |

### 9.3 回滚策略

- 代码层：本阶段所有变更集中在单一分支 `phase5.0-a`，验收不通过则不合入主线。
- 数据层：无 schema 升级、无破坏性迁移；归档/删除均为可逆操作（删除项目仅解除关联）。
- PWA 层：`sw.js` 版本常量回退即可让客户端恢复旧壳；必要时发布 `unregister` 版本清空缓存。

---

## 10. 验收对照表（对应用户指令 §八）

| 验收项 | 验证方式 |
|---|---|
| 231 逻辑测试零失败 | `npm test`（基线 + 新增 >=60 断言） |
| 90/14/29/35 E2E 零回归 | 原套件全量复跑 |
| 新功能独立 E2E | 4 套新脚本（约 44 项） |
| 新交互键盘/焦点 | a11y 追加 6 条 + 各新套件含键盘用例 |
| TypeScript 0 错误 / 构建成功 | `npm run build` |
| 10k 性能不回退 >10% | 既有基准 + 新增项目页指标 |
| 项目全流程（增改删档恢复） | `e2e-projects` |
| 删除项目不误删任务 | `e2e-projects`「任务总数不变 + 归未分类」 |
| 5 用户 10 分钟 ≥90% | 手工可用性测试记录 |
| 桌面/移动安装 | 手工（Chrome/Edge/Android/iOS） |
| 离线二次启动进壳 | `e2e-pwa` 离线用例 + 手工 |
| 更新后无旧 JS/CSS 残留 | `e2e-pwa` 缓存检查 + 手工 DevTools |
| 离线不破坏本地数据 | 离线用例中断网读写 + 恢复后一致性断言 |
| 撤销完全恢复 / 超时删除 | `e2e-undo` |
| 多标签零静默覆盖 | `e2e-undo` 多标签用例（revision 单调） |
| 引导完成首个项目+任务 | `e2e-onboarding` + 手工 |
| 不重复弹已完成的引导 | `e2e-onboarding` 刷新用例 |
| 可跳过并重新访问帮助 | `e2e-onboarding` 跳过 + 设置重看 |

---

## 11. 交付物（本阶段）

1. 本文档：`docs/phase5.0/PHASE5.0-A-IMPLEMENTATION-PLAN.md`
2. （开发授权后）代码 + 4 套 E2E + 单元测试增量 + 阶段验收报告 `docs/phase5.0/PHASE5.0-A-REPORT.md`

---

## 12. 待确认事项（开发前）

| # | 事项 | 建议 |
|---|---|---|
| Q1 | 移动端项目入口放「任务页分段」（保持 5 项底部导航）是否可接受？ | 建议采纳（320px 下 6 项拥挤） |
| Q2 | 删除项目**不提供**级联删任务（仅移入未分类）是否满足预期？ | 建议采纳（数据安全优先） |
| Q3 | Undo 窗口 8 秒是否合适（可配 5/8/10s）？ | 建议 8s |
| Q4 | 引导是否需要在「载入示例数据」后再次展示？ | 建议不展示（示例数据即引导） |
| Q5 | 是否需要在 5.0-a 内同时修正「初始化失败可能被 demo 数据覆盖」的隐患？ | 建议登记 5.0-b，避免扩大本阶段范围 |
