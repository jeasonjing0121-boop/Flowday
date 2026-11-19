# FlowDay Phase 4.5-A 报告 — Git 工程基线与全项目只读审计

> 本阶段仅执行：Git 初始化与基线、敏感内容检查、只读架构/质量/安全/性能审计、本报告与 Phase 4.5 计划。
> **未修改任何应用功能代码**；未重构；未新增功能；未删除任何历史成果。

- 日期：2026-11-14
- 基线来源：Phase 4.4 正式验收版本（170 逻辑 / 90 单页 E2E / 14 备份 / 29 多标签）

---

## 1. Git 仓库状态

| 项 | 值 |
|---|---|
| 仓库 | `flowday/.git`（新初始化） |
| 主分支 | `main` |
| 初始提交 | `1f51f6665fa261ba210425049115c919964da49f`（short: `1f51f66`） |
| 提交信息 | `baseline: FlowDay v0.3.0 Phase 4.4 accepted (IndexedDB + CAS multitab + backup integrity + perf R1-R4)` |
| Tag | `phase4.4-accepted`（附注标签，指向基线提交） |
| 跟踪文件数 | **239** |
| 工作区状态 | 提交时 `git status --porcelain` 为空（clean） |
| 本地身份 | `user.name=FlowDay Maintainer`、`user.email=maintainer@flowday.local`（仅仓库级配置，未动全局） |

### 1.1 .gitignore（完善后）

排除：`node_modules`、`dist`、`build-report`、`.tmp`、`.npm-cache`、`*.log`、`*.tsbuildinfo`、`coverage`、`.env` / `.env.*`（保留 `!.env.example`）、`*.local`、`*.pem`、`*.key`、`.DS_Store`、`.vscode`、`.idea`、一次性补丁脚本 `scripts/_*.py` / `tools/_*.py`。
**未排除**：`docs/**`（全部报告/截图/原始测试数据）、`scripts/**` 正式测试与基准脚本、`package-lock.json`、配置文件。

### 1.2 基线完整性核对

- 已入库关键产物：`package-lock.json`、`README.md`、`docs/phase0…phase4.4` 全部报告与 `e2e-report.json`/`multitab-report.json`/`perf-*.json`、`docs/phase4.4/screenshots/*`、`scripts/e2e*.mjs`、`scripts/bench-*.mjs`、`src/**`、`tools/**`（PDF 生成工具）。
- 已确认排除：`node_modules`、`dist`、`.tmp`、`.npm-cache` 跟踪数均为 0。
- 已用 `git rm --cached` 移出两个一次性补丁脚本（`scripts/_fix_mt10.py`、`tools/_patch_builder.py`，内容已应用完毕，仅本地留痕）。
- 历史成果零删除：基线提交为全新仓库的首次提交，包含全部既有文件（241 暂存 − 2 移除 = 239）。

### 1.3 敏感内容检查

- 全仓扫描（密钥/Token/密码/凭证/长随机串模式）：**未发现真实凭证**。
- 命中项均为 `docs/plan/03-architecture.md` 与合订本中的**密钥管理策略描述**（如"密钥永不进 Git"、Vault 流程），无实际密钥值。
- `src/`、`scripts/`、配置文件二次扫描长随机串：仅注释行误报（已人工核对）。
- 无 `.env*` 文件存在；应用不持有任何 API Key（AI 为本地 mock）。

### 1.4 版本管理规范（自本阶段起执行）

1. 每个阶段开始前确认基线提交存在；子阶段完成 = 独立提交（功能与重构分开）。
2. 提交信息格式：`<type>: <scope> <摘要>`（type ∈ feat/fix/refactor/test/docs/chore/perf）；修复类提交正文写原因与验证方式。
3. 正式验收版本打附注 tag（`phase4.4-accepted`、后续 `phase4.5-accepted` …）。
4. 回归定位：`git bisect` 可用（基线起历史完整）；回滚优先 `git revert`，禁止改写已推送/已验收历史。
5. 不引入分支模型复杂度：单 `main` + tag；实验性改动用本地分支，合回前必须全绿。

---

## 2. 只读架构与代码质量审计

### 2.1 结构与依赖（36 个 src 模块，导入图 DFS）

- **循环依赖：0**（脚本化检测 `scripts/_audit_graph.py`，未入库）。
- 层耦合（跨层边数）：features→lib 27、features→components 19、features→store 8、lib→types 8、store→lib 7、components→lib 4、App→features 6 等，方向总体健康。
- 两处**双向层耦合**（非循环，但值得记录）：
  - `store → components`（2）：`AppStore` 引入 `useToast` 与 `BrandMark`（启动屏）。持久化/同步状态机与展示组件耦合 → 4.5-B 候选：启动屏与 Toast 调用上移或注入。
  - `components → features`（1）：`AppShell` 引入 `TaskEditorModal`（编辑器宿主）。可接受（壳承载全局弹窗），记录在案。
- 过大文件：`store/AppStore.tsx` **461 行**（持久化 + 同步状态机 + 主题 + 启动 + dev 桥）→ 4.5-B 首要拆分对象；`SettingsPage.tsx` 339、`data.ts` 320、`db.ts` 319（存储层内聚，可接受）。
- 重复逻辑：`sortByTime` 仅存于 selectors（内部）与测试参照，src 无重复实现；bench 脚本间的数据生成器重复（仅测试代码，4.5-E 可选抽取）。
- 死代码：`scripts/smoke.mjs`（Phase 0 旧 runner，import esbuild 在 Vite 8 下已不可用，未被任何 npm script 引用）→ 4.5-B 删除候选（需确认）。

### 2.2 TypeScript 质量

- `any`：**0**；`@ts-ignore/@ts-expect-error`：**0**；非空断言滥用：0（仅 `main.tsx` 的 `getElementById('root')!` 单点受控）。
- `eslint-disable` 4 处，全部位于 `AppStore` 的 effect 依赖说明（有意为之、带注释）。
- 隐式转换：sanitize 层显式 `Number()/Boolean()/String()` 收敛，无隐式信任。
- 未处理 Promise：写入路径全部 `.catch` 或 `void` 显式标注；`downloadBackup` 调用点已 `void/then/catch` 覆盖。
- 空值：`readSyncInfo/loadSnapshot/validate*` 均返回可判别联合或 null，调用点判空（测试覆盖）。

### 2.3 React 质量

- 监听器配对：`addEventListener` 11 / `removeEventListener` 11，全部在 effect cleanup 中成对。
- 卸载后异步更新：启动 effect 有 `alive` 标志；`useToday` 清理定时器与监听；`TaskRows` 的 rAF 测量在卸载后最多多一次 no-op setState（React 19 无警告、无泄漏，记录为 P3）。
- 竞态：保存/同步路径以 revision CAS 为权威；预览过期以 writerId 区分；StrictMode 双初始化以共享 Promise 消除（4.3 修复，测试覆盖）。
- memo/useMemo/useCallback：R1–R4 已体系化（TaskRow memo、DispatchContext、分组单遍、deferred）；未发现缺失导致的整页重渲染（4.2 渲染计数证据）。
- 全局状态：AppContext(data)/DispatchContext/Toast/Confirm/TaskEditor 五个上下文，职责单一，无冗余全局。

### 2.4 存储与数据一致性（保护性确认，未改动）

- IndexedDB 事务：CAS 单事务读-比-写；`readStateWithSync` 单事务一致读（4.4 修复）。
- revision 单调 / writerId / BroadcastChannel / 草稿恢复 / 原子导入 / SHA-256：由 29 项多标签 + 14 项备份 E2E 持续保护，本轮零改动。

### 2.5 依赖与安全

- 依赖：运行时 3（react、react-dom、react-router-dom）+ 开发 5（vite、@vitejs/plugin-react、typescript、tailwindcss、@tailwindcss/vite），**无重复/冗余**；均为当前主版本线。`npm audit` 本轮未联网执行（离线缓存环境），列入 4.5-B 行动（联网时执行并记录）。
- XSS：无 `dangerouslySetInnerHTML/innerHTML/document.write/eval`；所有用户文本经 React 转义渲染；无数据驱动的 `href/src`。
- 敏感数据：localStorage/IndexedDB 仅存业务数据与同步元信息；草稿含业务数据（本机、3MB 上限、恢复后清除）；错误信息只含原因类别，不含数据内容。
- 导入/导出边界：20MB 上限、结构白名单、校验和强制（subtle 不可用即拒绝）、去重与引用修正可见。

### 2.6 性能基线引用（4.5-E 将复测对比）

| 指标（10k） | 4.2/4.3 基线 |
|---|---|
| 搜索 UI（生产） | 96 ms |
| 优先级筛选（生产） | 164 ms |
| 勾选端到端（生产） | 223 ms |
| DOM 元素 | 1,129 |
| CAS 整份保存 | 37–47 ms |
| Dashboard 聚合 | 7.8 ms（模块）/ 11.3 ms（页面） |

### 2.7 问题分级汇总（审计新增 + 承接）

| 级别 | 编号 | 问题 | 建议阶段 |
|---|---|---|---|
| P2 | A1 | AppStore 461 行职责过载（持久化/同步/主题/启动/dev 桥） | 4.5-B |
| P2 | A2 | store→components 耦合（useToast/BrandMark） | 4.5-B |
| P2 | A3 | 无 `:focus-visible` 样式；Modal 无焦点陷阱/初始焦点/焦点恢复 | 4.5-D |
| P3 | A4 | `scripts/smoke.mjs` 死代码 | 4.5-B（确认后删除） |
| P3 | A5 | TaskRows 卸载后可能残留一次 rAF no-op setState | 4.5-B（可选清理） |
| P3 | A6 | bench 脚本数据生成器重复 | 4.5-E（可选抽取） |
| P3 | A7 | `e2e.mjs` 1051 行单文件 | 4.5-F（可选拆分） |
| P3 | 承接① | 导入预览校验期无加载微状态 | 4.5-C |
| P3 | 承接② | 真实设备休眠恢复未验证 | 4.5-E（真机/有头补测或留档） |
| P3 | 承接③ | 草稿 3MB 上限 | 留档（有明确提示，投入产出低） |
| P3 | 承接④ | 无 Git 仓库 | **本阶段已解决** |

**P0/P1：0。**

---

## 3. 当前测试基线（tag `phase4.4-accepted`）

| 套件 | 结果 |
|---|---|
| `tsc --noEmit` | 0 错误 |
| `npm test`（smoke） | 170/170 |
| 单页 E2E | 90/90 |
| 备份专项 E2E | 14/14 |
| 多标签 E2E | 29/29 |
| 生产构建 | CSS 44.74 kB（gzip 8.78）/ JS 379.15 kB（gzip 117.11） |
| 调试变量扫描 | 0 命中 |

---

## 4. 交付物

- 本报告：`docs/phase4.5/PHASE4.5-A-REPORT.md`
- 阶段计划：`docs/phase4.5/PHASE4.5-PLAN.md`
- Git：基线提交 `1f51f66` + tag `phase4.4-accepted`；本报告与计划将作为独立 docs 提交（`docs: phase 4.5-A audit & plan`）
- 审计辅助脚本（本地留痕，gitignore）：`scripts/_audit_graph.py`

停止开发，等待验收。
