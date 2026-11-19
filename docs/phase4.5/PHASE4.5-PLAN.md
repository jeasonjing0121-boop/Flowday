# FlowDay Phase 4.5 实施计划（B–F）

> 依据：`PHASE4.5-A-REPORT.md` 审计结果。原则：最小必要修改、功能与重构分离提交、每子阶段独立提交+报告+停止等待验收。
> 保护对象（任何子阶段不得破坏）：CAS/revision/writerId、BroadcastChannel 同步、草稿恢复、原子导入、SHA-256 校验、R1–R4 性能成果、既有 303 项测试语义。

---

## Phase 4.5-B：架构与代码质量优化（✅ 已完成并**正式关闭** 2026-11-15；详见 PHASE4.5-B-REPORT.md；npm audit 在线执行留待 4.5-F）

**实际执行**：提交 `584300f`（拆分+解耦+rAF 清理）、`515eed9`（+40 架构测试）、`7728e74`（skip 语义修复）、`a79acd3`（bootRef 回归修复）。AppStore 461→250 行；store→components=0；循环=0；210/210 + 90/90 + 14/14 + 29/29×3 轮；性能与 4.2 基线持平。**偏差**：smoke.mjs 未删除（删除提案在 B 报告第 13 节，待批准）；重构期间自引入并修复 2 个回归（skip 消费时机、StrictMode 双初始化），均已留证据。

**目标**：降低 AppStore 复杂度、解除 store→components 耦合、清理死代码；不改变任何外部行为。

**涉及文件**：
- `src/store/AppStore.tsx` → 拆出 `src/store/persistence.ts`（防抖保存/flush/持久化失败降级）、`src/store/syncMachine.ts`（revision/dirty/conflict/external-update 状态机与广播订阅）、`src/store/BootstrapScreen.tsx`（启动屏 UI）；AppStore 保留 Provider 组装与上下文（目标 ≤260 行）。
- `src/components/UI.tsx` / `App.tsx`：Toast 依赖改由 Provider 层注入或上移（消除 store→components 的 useToast/BrandMark 边）。
- ~~删除 `scripts/smoke.mjs`~~ **已执行（`50c2d86`，用户批准；README 同步修正）**。
- 可选：`TaskRows` 卸载时取消挂起 rAF（A5）。

**修改原因**：A1/A2/A4/A5（4.5-A 审计）。

**验收指标**：tsc 0 错误；smoke 170/170；单页 E2E 90/90；多标签 29/29（同步语义零回归）；导入图仍 0 循环且 store→components 边为 0；AppStore ≤260 行；构建体积变化 <±2 kB gzip。

**风险**：状态机搬迁引入同步回归 → 以 29 项多标签 E2E 为闸门，失败即回滚（`git revert`）。

---

## Phase 4.5-C：全局视觉与交互一致性（✅ 已完成，待验收；详见 PHASE4.5-C-REPORT.md）

**实际执行**：9 个提交（`b2aa60b` Token → `e04f93f` 三层玻璃 → `6b8b43a` 组件 → `9f575aa` 页面 → `599397d` 微交互 → `de127a2` 测试 → `8026a90` 材质类共存修复 → `4a4a86a` 深色精修 → `b670a4f` 截图脚本加固）。成果：统一 Token（色彩/状态/排版/间距/圆角/阴影/动效/焦点）；Liquid Glass L1 导航 / L2 内容 / L3 弹窗三层 + 深色独立校准；按钮/输入/弹窗/Toast/空状态/加载态完整状态矩阵；浅深双主题 before/after 各 22 张截图。测试：231/231 + 90/90 + 14/14 + 29/29，构建/扫描/循环零异常。**偏差**：弹窗退出动画未做（P3 留档）；首轮回归因 E2E 硬编码 `.fd-glass` 类名出现 7 项失败，采用"层级类+基类共存"修复（未改断言）。**补充核验（2026-11-15）**：项目无独立页面（记录实际结构 + P2 功能缺口留档）；390/768/1280 三宽度响应式零溢出/零裁切（33 张截图 + JSON 数据）；修复 2 处测试脚本竞态（T8 懒重载、降级 dirty 时序），断言标准未变；最终 231/231 + 90/90 + 14/14 + 29/29。


**目标**：统一空/加载/错误状态语言；补导入预览"校验中"微状态（承接①）；按钮/输入/弹窗尺寸与间距审计对齐；不改设计语言。

**涉及文件**：`src/components/UI.tsx`（EmptyState/Spinner 原语）、`src/features/*`（空状态替换为统一原语）、`src/components/ImportPreviewModal.tsx` + `SettingsPage.tsx`（校验中 skeleton/禁用文件输入）、`src/styles.css`（仅 token 级微调）。

**验收指标**：六类状态（正常/加载/失败/冲突/空/存储异常）在 6 个页面截图核对一致；E2E 90/90 + 备份 14/14 不回归；无新增布局溢出（360–1440 扫描）。

**风险**：视觉改动引发 E2E 选择器失效 → 选择器保持 data-* 锚点不变。

---

## Phase 4.5-D：响应式与无障碍

**目标**：WCAG 2.2 AA 靠拢：`:focus-visible` 环、Modal 焦点陷阱+初始焦点+关闭后焦点恢复、Segmented/开关的 aria 补全、文本对比度核对（ink-3/paper、ink-2/glass）、键盘全流程（Tab/Enter/Esc）E2E。

**涉及文件**：`src/styles.css`（focus-visible token）、`src/components/UI.tsx`（Modal 焦点管理）、`AppShell.tsx`（跳转链接 skip-link 可选）、`scripts/e2e.mjs`（新增键盘用例）。

**验收指标**：键盘可达全部交互（E2E 断言）；焦点环在浅/深主题可见（截图）；对比度不达标项清零或记录豁免理由；既有套件全绿。

**风险**：焦点陷阱影响现有 E2E 点击流 → 陷阱仅在 Modal 打开时启用，关闭即恢复。

---

## Phase 4.5-D：无障碍与全设备适配（✅ 已完成，待验收；详见 PHASE4.5-D-REPORT.md）

**实际执行**：分支 `phase4.5-d-accessibility`，3 个功能/测试提交 + 文档提交。成果：统一 `useDialogFocus`（初始焦点/焦点陷阱/关闭恢复/嵌套栈/滚动露出）、账户菜单键盘化、skip link 与地标语义、5 处缺失标签补齐、校验错误 aria 关联、切换类 `aria-pressed`、Toast `role=status`、图表文本等价、`*-ink` 文本对比度 token（ink-3 3.49→4.89:1）、触控目标 ≥24×24（coarse 40px）、`hover:none` 操作常显。**新增 35 项无障碍 E2E（35/35）**；回归：231/231 + 90/90 + 14/14 + 29/29，构建/扫描/循环零异常。**留档**：NVDA 未安装（用 AX 树+语义断言替代，建议真机补测）；文字缩放以 640px 等价视口近似；1.4.11 装饰性描边豁免。

## Phase 4.5-E：性能与稳定性加固

**目标**：复测 4.2/4.3 基线（10k）确认零回退；新增内存/泄漏探针（长会话导航 50 轮 heap 采样、监听器计数）；真机/有头浏览器补"休眠恢复"验证（承接②，若环境不允许则留档）；可选 bench 生成器抽取（A6）。

**涉及文件**：`scripts/bench-4.2*.mjs`（复用）、新增 `scripts/bench-4.5-leak.mjs`、报告 `docs/phase4.5/PHASE4.5-E-REPORT.md`。

**验收指标**：10k 搜索 ≤200ms、筛选 ≤200ms、勾选 ≤300ms、DOM ≤1,200（与 4.2 目标一致且不劣于基线 +10%）；50 轮导航 heap 增长 <15% 且 GC 后回落；CAS 保存 ≤60ms。

**风险**：性能波动（机器负载）→ 每指标 5 次中位/最大并记录环境负载。

---

## Phase 4.5-E：性能与长期稳定性加固（✅ 已完成，待验收；详见 PHASE4.5-E-REPORT.md）

**实际执行**：分支 `phase4.5-e-performance`（基线 tag `phase4.5-d-accepted`）。新增测试装置：环境无关基准 `bench-4.5e.mjs`、模块级 `probe-4.5e-module.mjs`、内存长跑 `stress-4.5e-memory.mjs`、存储压力/异常注入 `stress-4.5e-storage.mjs`、多标签压力 `stress-4.5e-multitab.mjs`、播种页 `public/bench-blank.html`。结论：端到端无退化（10k prod 搜索 82.1ms / 优先级 26ms / 首帧 28ms / DOM 1135 / 行 44）；虚拟滚动 1k–40k 恒定；内存 501 次操作无泄漏证据；存储压力 9/9、多标签压力 15/15。唯一偏差：模块级 dashboardAggregate 10k 11.4ms vs 基线 6.1ms（1k 一致、跨轮 ±40% 波动、端到端无退化 → 环境差异）。**本轮无产品代码修改**。

**保留至 4.5-F 最终人工核验清单**：① NVDA 真人朗读验证；② 严格 200% 文字缩放；③ 移动端真实虚拟键盘。

## Phase 4.5-F：完整回归、实际环境验证、安全审计与正式交付（✅ 本轮完成，待最终批准）

**实际执行**：分支 `phase4.5-f-final`（基线 tag `phase4.5-e-accepted`）。新增：`scripts/e2e-final-4.5f.mjs`（200% 页面/文字缩放、虚拟键盘模拟、15 步产品走查，共 25 项检查，**25/25 通过**）、`docs/phase4.5/final-checks.json`、`screenshots-f/`（14 张）、`perf-4.5f-prod-10k.json`、`audit-all.json` / `audit-prod.json`。回归：231/90/14/29/35/9/15 + 构建/扫描/循环全绿（多标签在重负载串行跑出现 2 项时序抖动，单独复跑 29/29）。安全：`npm audit` 全部与生产依赖均 **0 漏洞**；XSS/外部资源/密钥扫描 0 命中。人工验证：NVDA 2026.2 已安装并验证其附着读取 FlowDay 的 IA2 对象，但本会话无音频设备（OneCore COMError）→ **语音输出未验证（部分完成）**；200% 缩放（页面/文字）通过；移动端虚拟键盘为视口模拟（真机未验证）。

**最终交付文档**：`PHASE4.5-FINAL-ACCEPTANCE-REPORT.md`。**未合并 main**（等待最终批准）；未新增业务功能；产品代码本轮零改动。

## Phase 4.5-F：完整回归与最终验收

**目标**：全套件回归（smoke/单页/备份/多标签/构建/扫描/截图）、可选 `e2e.mjs` 拆分（A7）、打 tag `phase4.5-accepted`、总报告。

**验收指标**：smoke ≥170、单页 ≥90、备份 ≥14、多标签 ≥29、tsc 0、扫描 0；tag 指向全绿提交；工作区 clean。

**风险**：无功能改动，风险低。

---

## 执行纪律

1. 每子阶段：基线确认（`git status` clean + tag 存在）→ 实施 → 测试 → 独立提交 → 报告 → 停止等待验收。
2. 功能/重构/测试分提交；修复提交正文含原因与验证方式。
3. 任何 P0/P1 发现立即停止并上报。
4. 不升级依赖，除非 `npm audit`（联网执行）报告高危且修复为补丁版本。
5. 承接 P3 中"草稿 3MB"不做（投入产出低，已有提示），其余按上表推进。

---

## 附：Phase 4.5 各子阶段最终状态（4.5-F 收尾时）

| 子阶段 | 状态 | 验收标签/说明 |
|---|---|---|
| 4.5-A Git 基线与审计 | ✅ 已验收 | tag `phase4.4-accepted` 为起点 |
| 4.5-B 架构拆分与解耦 | ✅ 已验收 | 210/210（含 +40 单测） |
| 4.5-C 视觉体系升级 | ✅ 已验收 | 231/231 + 90/14/29 |
| 4.5-D 无障碍与响应式 | ✅ 已验收 | tag `phase4.5-d-accepted`；35/35 a11y |
| 4.5-E 性能与长期稳定性 | ✅ 已验收 | tag `phase4.5-e-accepted`；1k–40k 基准 + 9/9 + 15/15 |
| 4.5-F 最终验收 | **✅ 完成，待最终批准** | 25/25 终验检查；main 未合并 |
| 人工核验清单 | 部分完成 | NVDA 语音输出（环境无音频）未验证；真机键盘未验证；严格 200% 缩放已验证 |

