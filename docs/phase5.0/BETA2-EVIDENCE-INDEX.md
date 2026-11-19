# FlowDay 5.0-a Beta.2（Android）· 截图与验证证据索引

> 全部证据均由脚本自动采集，位于 `docs/phase5.0/lg-evidence/`。
> 采集脚本：`scripts/lg-capture.mjs`（截图 / 溢出 / 滚动帧）、`scripts/lg-anim-capture.mjs`（动画帧）、`scripts/lg-contrast-capture.mjs`（对比度探针）。
> 浏览器：Edge headless（Chromium 同源渲染引擎，与 Android WebView 同为 Blink）。

---

## 1. 修复前 / 修复后对比

| 场景 | 修复前 | 修复后 |
|---|---|---|
| 桌面 · 今日（浅色） | `before/light-desktop-today.png` | `after/light-desktop-today.png` |
| 桌面 · 今日（深色） | `before/dark-desktop-today.png` | `after/dark-desktop-today.png` |
| 桌面 · 任务 / 项目 / 日历 / 习惯 / 设置 | `before/{light,dark}-desktop-*.png` | `after/{light,dark}-desktop-*.png` |
| 账户菜单（展开态） | `before/light-desktop-menu.png` | `after/light-desktop-menu.png` |
| 新建任务弹窗（展开态） | `before/light-desktop-modal.png` | `after/light-desktop-modal.png` |
| 移动端 · 今日 | `before/light-m390-today.png` | `after/light-m390-today.png` |

## 2. 移动端各尺寸截图（验收要求 320/360/375/390/412/432）

`after/{light,dark}-m{320,360,375,390,412,432}-{today,tasks,settings}.png`
- 每个尺寸 × 深浅 × 3 张主页面 = 36 张；另有 412/432/360 的溢出与可访问性检查记录（`lg-capture-report.json`）。
- 结论：**全部尺寸横向溢出检查通过**（`scrollWidth == clientWidth`），修复前 320px 存在 38px 溢出。

## 3. 动画交互（GIF）

| 交互 | 文件 | 说明 |
|---|---|---|
| 底部导航胶囊位移（修复前） | `before/anim/nav_switch_before.gif` | 透明底切换，无形态变化 |
| 底部导航胶囊位移（修复后） | `after/anim/nav_to_tasks.gif` | 胶囊 transform/width 弹簧位移 |
| 账户菜单生长（修复后） | `after/anim/menu_open.gif` | 锚点 origin + scale + blur→0 |
| 弹窗上浮展开（修复后） | `after/anim/modal_open.gif` | 底部上浮 + 轻模糊消散 |
| 分段控件滑动（修复后） | `after/anim/seg_switch.gif` | 指示器位移 + 宽度形变 |

## 4. 可读性实测

- `contrast/probes.json`：42 个探针（header 标题/日期、侧栏标签/说明、卡片标题/正文/次要文字 × 浅深 × 桌面/移动）。
- `contrast/contrast-report.json`：**0 失败，最低 5.03:1**（深色侧栏标签），浅色最低 5.13:1。
- 修复前同口径实测：5 处不达标（深色侧栏 2.75:1、header 日期 4.18–4.36:1）。

## 5. 性能实测

| 文件/指标 | 值 |
|---|---|
| `after/perf.json` | 滚动帧采样 194 帧：avg **16.52ms**、p95 **16.7ms**、长帧(>32ms) **0** |
| `scripts/perf-5a.mjs` | 10k 搜索过滤 9.5ms（基线 90ms）· 10k 保存延迟 322ms（同机 Beta.1 基线 310ms，容差 341ms）· 项目页 10k 渲染 521ms · 项目详情 2500 条 434ms |
| 同机 A/B | Beta.1：294/304/309/318ms ⇒ 中位 ≈ 305ms；Beta.2：301/322/330/336/348/355ms ⇒ 中位 ≈ 332ms（+8.9%，容差内） |

## 6. 回归结果（Beta.2 最终代码）

| 套件 | 结果 |
|---|---|
| 逻辑测试 `npm test` | **369 / 369** |
| 主 E2E `e2e.mjs` | **91 / 91**（含新增"胶囊形态位移"断言） |
| 无障碍 `e2e-a11y.mjs` | **35 / 35**（独立运行 3 次一致） |
| 备份 `e2e-backup.mjs` | 14 / 14 |
| 多标签 `e2e-multitab.mjs` | 29 / 29 |
| 项目 `e2e-projects.mjs` | 30 / 30 |
| 撤销 `e2e-undo.mjs` | 20 / 20 |
| 引导 `e2e-onboarding.mjs` | 16 / 16 |
| 数据安全 `e2e-datasafety.mjs` | 14 / 14 |
| PWA `e2e-pwa.mjs`（需 preview 服务器 4173） | 14 / 14 |
| 性能 `perf-5a.mjs` | 7 / 7 |
| 视觉证据 `lg-capture.mjs` | 73 / 73 |

> 说明：a11y 套件在并发跑其它 E2E/性能任务时出现过一次时序抖动（多浮层脏状态用例依赖防抖窗口），单独运行连续 3 次均 35/35；已记录为已知的测试环境敏感性，非产品缺陷。
