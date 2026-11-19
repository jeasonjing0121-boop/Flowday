# FlowDay Phase 4.5-D 报告 — 无障碍体验与全设备适配优化

> 分支：`phase4.5-d-accessibility`（基线 `d067a9f`，main 保留 4.5-C 已验收版本）
> 边界遵守：未改 AppData/reducer/IndexedDB/CAS/SyncMachine/PersistenceController；未加业务功能；未引入第三方依赖；未删除/降低任何旧断言；未改 Liquid Glass 设计体系。

- 日期：2026-11-15
- 验证环境：Windows 10 · Edge 157 headless（CDP 键盘/无障碍树）· **NVDA 未安装**（替代验证见第 5 节）

---

## 1. 审计发现的问题（修复前）

### 1.1 静态审计（源码扫描）

| # | 问题 | 证据 |
|---|---|---|
| 1 | 5 个输入控件缺少可访问名称：任务搜索、今日快捷添加、Jing 输入框、日历排程时间/时长 | 静态扫描 |
| 2 | Modal 无 `aria-labelledby`，标题与弹窗未关联；Confirm 同样 | 源码 |
| 3 | **Modal 无焦点陷阱、无初始焦点策略、关闭后不恢复焦点** | 源码 |
| 4 | 账户菜单仅 `aria-expanded`，无键盘展开/关闭/焦点管理 | 源码 |
| 5 | 无 skip link；NavLink 依赖框架默认 `aria-current`（未验证） | 源码 |
| 6 | 任务勾选/习惯打卡为按钮但无 `aria-pressed`；日历日格无选中语义 | 源码 |
| 7 | 校验错误为纯视觉 `<p>`，未与输入关联（无 `aria-invalid/describedby`、无 `role=alert`、失败后不聚焦） | 源码 |
| 8 | 周柱图无可读文本等价物 | 源码 |
| 9 | 文本对比度不足：`--fd-ink-3` 浅色 #86868b 对 paper ≈ **3.49:1**；accent/danger/success 直接作正文色时 <4.5:1（如浅色 accent 对 accent-soft ≈4.17:1） | 计算 |
| 10 | 触控目标过小：任务勾选框 18×18、任务标题按钮高 20、搜索输入高 20（<24 CSS px） | 实测 |
| 11 | 行内编辑/删除按钮在 ≥768px 仅 Hover 显示，**触屏设备无法操作** | 源码 |
| 12 | Toast 容器有 `aria-live=polite` 但条目无 `role=status` | 源码 |
| 13 | 账户菜单 Enter 键双触发（keydown 打开 + 原生 click 再关闭） | 实测 |
| 14 | 删除类操作关闭确认框后焦点落到 `body`（触发元素异步卸载） | 实测 |

### 1.2 键盘实测发现

- 弹窗内 Tab 会跑到背景页面（无陷阱）；
- 关闭弹窗后焦点丢失（无恢复）；
- 菜单无法用 Enter/ArrowDown 打开后保持（双触发）；
- 叠加弹窗（导入预览 + 确认框）关闭后焦点掉到 `body`。

## 2. 修复前后对比

| 项 | 修复前 | 修复后 |
|---|---|---|
| 弹窗初始焦点 | 无策略（首个可聚焦或 autoFocus 偶然） | `[data-autofocus]` > 首个表单控件 > 弹窗容器（`tabIndex=-1`），TaskEditor 聚焦标题 |
| 焦点陷阱 | 无 | Tab/Shift+Tab 循环 + 焦点逃逸自动拉回，仅**最顶层**弹窗处理 |
| 关闭恢复 | 无 | 优先原触发元素；容器/`body` 不算有效目标；异步卸载自动回退到 `[data-fd-main]`；叠加场景归还下层弹窗 |
| 弹窗语义 | role+aria-modal | +`aria-labelledby`（标题）+`aria-describedby`（说明）；确认框改 `alertdialog` |
| 菜单键盘 | 仅鼠标 | Enter/ArrowDown 展开→首项聚焦→↑↓/Home/End 循环→Esc 关闭并归还焦点→Tab 关闭 |
| skip link | 无 | 首个 Tab 出现「跳到主要内容」→ Enter 聚焦 `main` |
| 输入名称 | 5 处缺失 | 全部补齐 |
| 校验错误 | 纯文本 | `aria-invalid`+`aria-describedby`+`role=alert`+失败聚焦输入 |
| 切换语义 | 无 | 勾选/打卡 `aria-pressed`；日历日格 `aria-pressed`+`aria-current=date`+名称含待办数 |
| 周柱图 | 仅视觉 | `role=img` + 「近 7 天完成数：周一 0 件，…」 |
| Toast | 仅容器 polite | 条目 `role=status`（polite 播报，不打断阅读） |
| 三段式选择器 | 无组语义 | `role=group` + `aria-label` + `aria-pressed` |
| 文本对比度 | ink-3 3.49:1 | ink-3 **4.89:1**（浅）/5.78:1（深）；新增 `--fd-accent-ink/--fd-danger-ink/--fd-success-ink` 文本专用色（≥4.5:1） |
| 触控目标 | 最小 18×18 | 全部 ≥24×24；`pointer: coarse` 下主/次按钮 ≥40px |
| Hover-only 操作 | 触屏不可用 | `@media (hover:none)` 下常显 |
| 焦点裁切/遮挡 | 未处理 | `scroll-margin-block:12px` + 弹窗内 `scrollIntoView(nearest)`（虚拟键盘场景） |

## 3. Modal 焦点管理设计（`components/UI.tsx`）

```
useDialogFocus({ open, onClose, fallbackSelector='[data-fd-main]' })
├─ 打开：记录 activeElement → push 到 dialogStack → 初始焦点（data-autofocus > 首个表单控件 > 面板）
├─ 期间：document keydown(capture)
│    ├─ Escape：仅最顶层弹窗处理（stopPropagation）
│    └─ Tab/Shift+Tab：可聚焦列表循环；列表为空时聚焦面板
├─ focusin 守卫：焦点逃逸 → 拉回最顶层弹窗首个可聚焦元素；
│                元素越出视口 → scrollIntoView(nearest)（移动端键盘遮挡）
└─ 关闭：pop 栈 → settle() 落地复核
     ├─ 目标可用（connected+可见+未禁用）→ 聚焦
     ├─ 目标不可用 / 是 body → 聚焦最上层弹窗（叠加场景）
     ├─ 目标随后卸载（≈140ms 复核）→ 回退 [data-fd-main]
     └─ 多次重试（0/80/160/240ms）后仍无目标 → [data-fd-main]
```
- Modal 与 Confirm 共用同一实现（`ConfirmProvider` 的 `alertdialog` 初始焦点落在「取消」，避免误触发破坏性操作）。
- 嵌套：`dialogStack` 数组，只有栈顶弹窗响应按键与逃逸；关闭弹窗仅移除自身。
- 滚动锁：按弹窗计数（嵌套时关闭上层不会提前解锁页面滚动）。

## 4. 键盘操作结果（自动化 + 人工驱动，无鼠标）

| 场景 | 结果 |
|---|---|
| 弹窗初始焦点 / Tab 循环（12 次）/ Shift+Tab 循环（12 次）/ Esc | ✅ |
| 关闭后焦点恢复触发按钮 | ✅ |
| 触发元素卸载后焦点回退 main（不落 body） | ✅ |
| 叠加弹窗：Tab 不落入下层、Esc 关闭上层后焦点回上层弹窗 | ✅ |
| 菜单 Enter 展开→首项→↑↓→Esc 归还焦点 | ✅ |
| skip link → main → 主导航 → Enter 切路由 | ✅ |
| K1 创建任务 / K2 完成与撤销 / K3 编辑标题 / K4 状态筛选 / K5 习惯打卡 / K6 主题切换（全键盘） | ✅ |
| 校验失败：错误播报 + 焦点回到输入 | ✅ |

## 5. 屏幕阅读器验证

- **NVDA 未安装**（`C:\Program Files (x86)\NVDA\nvda.exe`、`C:\Program Files\NVDA\nvda.exe` 均不存在），本环境无法做真人朗读验证。
- **替代验证（已执行）**：
  1. Chromium 无障碍树（`Accessibility.getFullAXTree`）抽检：弹窗暴露 `role=dialog` 且名称为「新建任务」；导航 landmark 名称为「主导航」；存在 5 级标题结构。
  2. 全量语义断言：所有按钮均有可访问名称（含关闭/编辑/删除/账户菜单）；输入控件均有标签或 `aria-label`；错误信息与输入关联；Toast `role=status` + `aria-live=polite`；图表 `role=img` + 文本等价。
- **未覆盖范围（如实声明）**：NVDA/JAWS/VoiceOver 实际朗读节奏、中文标点停顿、表单错误在朗读器中的提示时机未验证；建议在装有 NVDA 的机器上补一次人工朗读。

## 6. WCAG 2.2 AA 检查表（适用项）

> **认证声明**：本表为**自测结果**，不代表通过完整的 WCAG 2.2 AA 认证。未完成的验证事项见第 12 节与第 14.3 节。

| 准则 | 状态 | 说明/证据 |
|---|---|---|
| 1.1.1 非文本内容 | ✅ | 图标均 `aria-hidden` 或有文本标签；图表有文本等价 |
| 1.3.1 信息与关系 | ✅ | 原生 header/nav/main/aside/footer、h1–h2、列表、label/fieldset(group) 语义 |
| 1.4.1 颜色非唯一手段 | ✅ | 优先级含「P1 紧急」文字+色点；状态含文字「已打卡/撤销」；图表含数值标签 |
| 1.4.3 对比度（文本） | ✅ | 浅/深真实渲染采样：h1 16.24/17.65、导航 4.89/6.69、正文 micro 4.89+、主按钮 15.46/19.29（脚本断言 ≥4.5） |
| 1.4.4 缩放 200% | ⚠️ 已测 | 以等价视口 640px 验证无溢出（文本缩放法与页面缩放不完全等价，见第 12 节） |
| 1.4.10 重排（320px） | ✅ | 6 页面 overflow=0（320px） |
| 1.4.11 非文本对比度 | ⚠️ 部分 | 交互控件依赖填充/描边+文字可区分；卡片边框属装饰性，未强制 3:1（记录为已知豁免） |
| 1.4.13 悬停内容可关闭 | ✅ | 行内操作非悬浮弹层；菜单可 Esc 关闭且焦点归还 |
| 2.1.1 键盘 | ✅ | 全部功能键盘可达（K1–K6、菜单、弹窗、导航） |
| 2.1.2 无键盘陷阱 | ✅ | 弹窗陷阱可 Esc 退出；菜单 Tab 关闭 |
| 2.2.2 暂停/停止/隐藏 | ✅ | 无自动播放/闪烁内容；Toast 自动消失但可由 live region 播报 |
| 2.4.1 绕过区块 | ✅ | skip link |
| 2.4.3 焦点顺序 | ✅ | DOM 顺序即视觉顺序（Tab 实测 40+ 元素） |
| 2.4.7 焦点可见 | ✅ | 全局 `:focus-visible` 2px accent + 2px offset；浅/深主题截图验证 |
| 2.4.11 焦点不被遮挡（AA） | ✅ | `scroll-margin-block`；弹窗内 `scrollIntoView(nearest)`；固定导航遮挡已测 |
| 2.5.8 目标尺寸（AA） | ✅ | 全量扫描 ≥24×24（行内文本链接除外）；coarse 指针按钮 ≥40px |
| 3.3.1 错误识别 | ✅ | 错误文案 + `role=alert` + `aria-invalid` |
| 3.3.2 标签或说明 | ✅ | 所有输入有 label/aria-label（含占位提示补充） |
| 4.1.2 名称/角色/值 | ✅ | 按钮有名称；`aria-pressed/aria-expanded/aria-current` 状态可读 |
| 4.1.3 状态消息 | ✅ | Toast 为 polite live region；同步横幅 `role=status` |
| 2.3.3 动画交互（AAA 参考） | ✅ | `prefers-reduced-motion` 全站 0.01ms 兜底（实测弹窗动画 1e-05s） |

## 7. 各屏幕尺寸验证

| 宽度 | 结论 |
|---|---|
| **320** | 6 页面无横向溢出（Reflow 通过）；布局单列 |
| 360 / 390 / 414 | 单页 E2E 响应式块（既有 7 宽度断言）全绿；底部导航可用，焦点环可见 |
| 768 | 平板双列；无挤压；侧栏隐藏/底部 Tab 显示（E2E 断言） |
| 1024 / 1280 / 1440 | 侧栏+顶栏布局；无溢出（E2E 断言 + 4.5-C 回归） |
| 200% 缩放等价视口（640px） | 无内容丢失/无溢出 |
| 横屏手机 | 由 768 断点逻辑覆盖（横屏宽度 667–926 落在底部 Tab 布局范围） |

## 8. 修改文件清单

| 文件 | 修改 |
|---|---|
| `src/components/UI.tsx` | 新增 `useDialogFocus`（初始焦点/陷阱/恢复/嵌套/滚动）；Modal、Confirm 语义与焦点；Segmented 组标签与 `aria-pressed`；Toast `role=status`；EmptyState 图标 `aria-hidden` |
| `src/components/AppShell.tsx` | skip link、main 焦点落点、nav/aside 地标名称、账户菜单键盘交互、菜单 `role=menu/menuitem` |
| `src/components/SyncBanner.tsx` | 文本色改 `text-danger-ink` |
| `src/components/ImportPreviewModal.tsx` | 校验芯片成功色改文本安全色 |
| `src/features/tasks/TaskEditor.tsx` | 移除 autoFocus；标题 `aria-invalid/describedby`；错误 `role=alert` + 失败聚焦；优先级分组标签 |
| `src/features/tasks/TaskRow.tsx` | 勾选 `aria-pressed` + 24×24 命中区；标题按钮 ≥24 高；行内操作 `fd-row-actions` |
| `src/features/tasks/TasksPage.tsx` | 搜索框 `aria-label` + 目标尺寸；状态筛选分组标签 |
| `src/features/today/DashboardPage.tsx` | 快捷输入 `aria-label`；周柱图 `role=img` 文本等价 |
| `src/features/habits/HabitsPage.tsx` | 打卡 `aria-pressed`；文本色安全化 |
| `src/features/calendar/CalendarPage.tsx` | 日格 `aria-pressed/aria-current/aria-label`；分组标签；今天数字用文本安全色 |
| `src/features/calendar/DayTimeline.tsx` | 排程时间/时长 `aria-label` |
| `src/features/assistant/AssistantPage.tsx` | 输入 `aria-label`；链接/状态文本安全色 |
| `src/features/settings/SettingsPage.tsx` | 主题/周起始日分组标签 |
| `src/styles.css` | ink-3 对比度校准；`*-ink` 文本色 token；按钮最小高度（coarse 40px）；`scroll-margin`；skip link；`hover:none` 行内操作常显；错误文本色 |

## 9. 新增测试（独立统计）

**`scripts/e2e-a11y.mjs`：35 项检查全绿**，覆盖需求第 1–17 类：
Modal 初始焦点、Tab/Shift+Tab 循环、Esc、恢复、卸载回退、多层浮层（6）· 菜单键盘与图标名称（4）· 表单错误关联（1）· Toast live region（1）· skip link/导航键盘/路由（4）· reduced-motion（1）· 320 重排（1）· 200% 缩放（1）· 触控目标（1）· AA 对比度（1）· 键盘流程 K1–K6（6）· AX 树抽检（2）· 其他语义断言（6）。
另有既有 `e2e.mjs` 中 7 宽度响应式与玻璃材质断言继续覆盖设备适配。

## 10. 原有回归（最终）

| 项 | 结果 |
|---|---|
| TypeScript | 0 错误 |
| 逻辑测试 | **231/231**（未改动旧断言） |
| 单页 E2E | **90/90** |
| 备份专项 E2E | **14/14** |
| 多标签 E2E | **29/29** |
| 生产构建 | ✅ CSS 49.42 kB（gzip 9.91）/ JS **387.59 kB（gzip 119.97，+1.66 gzip）** |
| 调试变量扫描 | 0 命中 |
| 循环依赖 | 0（43 模块） |
| 新增无障碍 E2E | **35/35** |

## 11. 真实浏览器截图（`docs/phase4.5/screenshots-d/`，11 张）

`light-skip-link-focus`（skip link + 焦点环）· `light-nav-focus-ring` · `light-modal-initial-focus` · `dark-task-toggle-focus` · `dark-modal-initial-focus` · `reflow-320-tasks` / `reflow-320-today` · `width-390/768/1280-tasks` · `mobile-bottom-nav-focus`

## 12. 未解决问题与风险

| 编号 | 级别 | 项 | 说明 |
|---|---|---|---|
| 1 | P2（环境） | 屏幕阅读器真人验证缺失 | NVDA 未安装；已用 AX 树 + 语义断言替代，建议真机补测 |
| 2 | P3 | 1.4.4 文字缩放验证方式 | 采用 640px 等价视口近似（Tailwind 为 px 字号，浏览器文字缩放不改变 px；页面缩放 200% 等价视口减半）；严格文字缩放（浏览器设置）未单独验证 |
| 3 | P3 | 1.4.11 非文本对比度部分豁免 | 卡片/分隔线为装饰性描边（未达 3:1），交互控件均有填充/文字区分；如后续要求严格 AA，可单独提高 line 对比度但会削弱玻璃质感 |
| 4 | P3 | 移动端虚拟键盘 | headless 无法真实唤起软键盘；已用 `scrollIntoView(nearest)` 兜底 + 弹窗 `max-h-[92dvh]`，建议真机验证 |
| 5 | P3 | 弹窗焦点环在滚动容器边缘 | 已加 `scroll-margin-block`，极长内容下仍可能有 1–2px 裁切（视觉无影响） |
| 6 | P3 | 草稿/冲突横幅的读屏节奏 | 冲突横幅 `role=status` 已有；重复冲突时可能连续播报两次（未做去重） |

## 13. Git 提交记录

| 提交 | 内容 |
|---|---|
| `27f614d` | 弹窗焦点管理 + 键盘导航（skip link/菜单/地标/分段组标签） |
| `7fd765c` | 表单与读屏语义 + WCAG 对比度 token + 触控目标 + hover-none 回退 |
| `c851836` | 35 项无障碍 E2E + 证据截图 |
| 本次 docs 提交 | 本报告 + 计划更新 |

分支 `phase4.5-d-accessibility`；main 保留 4.5-C 已验收版本；`phase4.4-accepted` 未改动。

## 14. 最终仓库核验（2026-11-15，纯仓库操作，未修改任何功能代码）

### 14.1 仓库状态

| 项 | 值 |
|---|---|
| 当前分支 | `phase4.5-d-accessibility` |
| HEAD（核验时，完整） | `4c3ac1689971e862fb7929ebee970f98df4b0836`（本次核验文档提交为其**直接后继**，当前值请以 `git rev-parse HEAD` 为准） |
| 工作区 | `git status --porcelain` = **空（clean）** |
| 全仓提交总数 | 27 |
| 保护标签 | `phase4.4-accepted` → `1f51f6665fa261ba210425049115c919964da49f`（未改动） |

### 14.2 本阶段提交记录（`main..HEAD`，共 5 个）

| # | 完整 hash | 说明 |
|---|---|---|
| 1 | `27f614d60212ea73a21a16b3525e435097a63c1a` | 弹窗焦点管理（初始焦点/陷阱/恢复/嵌套栈/alertdialog 语义）+ 键盘导航（skip link、账户菜单键盘、地标、分段组标签） |
| 2 | `7fd765c1779ec865970a62a131cf8ae56cd280d0` | 表单与读屏语义 + WCAG 对比度 token（`*-ink`）+ 触控目标 + `hover:none` 回退 |
| 3 | `c851836b04981466d528d9baa9f42a9c3a117ce6` | 35 项无障碍 E2E + 证据截图 |
| 4 | `f8793c4cb5476f1a6942fe1efd722a0d894fd2d6` | 无障碍审计报告 + 计划状态 |
| 5 | `4c3ac1689971e862fb7929ebee970f98df4b0836` | 回归证据刷新（单页/备份/多标签报告与截图） |
| 6 | `f9311bd4fb948714e50d1980bf9d634166ce64ca`（及其后继文档修正提交） | 本核验记录（补充第 14 节与认证声明，纯文档） |

### 14.3 main 分支与历史保护

- `main` tip：`d067a9fcd5c0390a076ffbb1d2a5a179f418587a`（Phase 4.5-C 验收版 + 交付补充），**是当前 HEAD 的祖先**（`git merge-base --is-ancestor main HEAD` → true）。
- `main` 的 `docs/phase4.5/` 含 `PHASE4.5-A/B/C-REPORT.md`、`PHASE4.5-PLAN.md` 与 4.5-C 截图/数据 —— 4.5-C 已验收版本完整保留。
- 本阶段未合并回 main（按流程等待验收后再决定合并策略）。
- `phase4.4-accepted` 标签仍指向 4.5-B 基线提交，未被改写。

### 14.4 未完成的验证事项（保留，不视为已通过）

1. **NVDA / 屏幕阅读器真人验证**：本机未安装 NVDA，仅以 Chromium 无障碍树 + 语义断言替代；中文朗读节奏、错误提示时机未验证。建议在装有 NVDA 的机器上人工复核主要页面与弹窗。
2. **严格 200% 文字缩放**：本轮以 640px 等价视口近似（页面缩放 200% ↔ CSS 视口减半）；浏览器"仅放大文字"设置下的实际排版未单独验证。
3. **移动端虚拟键盘**：headless 环境无法真实唤起软键盘；已用 `scrollIntoView(nearest)` + `max-h-[92dvh]` 兜底，仍需真机验证输入框不被遮挡。

**结论**：Phase 4.5-D 的自测与回归全部通过，以上三项为环境受限的未覆盖验证，**不构成完整 WCAG 2.2 AA 认证结论**。

### 14.5 本轮核验的变更范围

仅修改本报告（补充 14 节与认证声明），**未改动任何功能代码、测试脚本或既有报告内容**。

