# Phase 5.0-B · B3 实施报告：键盘与弹窗治理

> 阶段：**B3（已完成，未构建 APK、未合并 main、未打 Tag、未进入 B4）**
> 分支：`phase5.0-a` · 基线：`ae846f102192cfdabe91f12ce5025bfc2713fc06`（B2 验收通过版本）

---

## 1. 修改文件清单与原因

| # | 文件 | 类型 | 修改内容 | 对应 B1 P1 |
|---|---|---|---|---|
| 1 | `src/components/UI.tsx` | 前端 | Modal 改为**三段式**：`.fd-modal-head`（固定）/ `.fd-modal-body`（唯一滚动区）/ `.fd-modal-foot`（固定操作栏）；新增"聚焦输入框自动可见"逻辑（`focusin` + 320ms 后二次校正）；Confirm 面板加 `fd-confirm-panel` 视口约束 | **P1-2** footer 不固定 |
| 2 | `src/styles.liquid-glass.css` | 前端 | 新增 `--fd-kb`（键盘占位）；底部导航 `bottom` 去掉 ime 项、键盘态整体滑出；内容预留去掉 ime 项；新增 `.fd-modal-overlay/.fd-modal-panel/.fd-modal-head/.fd-modal-body/.fd-modal-foot/.fd-confirm-panel` 样式 | **P1-1/3** |
| 3 | `src/lib/insets.ts` | 前端 | 从 `visualViewport` 推导键盘占位 `--fd-kb`（>80px 才判定为键盘）与 `data-lg-kb`；焦点变化后多采样；后台时清零；**值不变不写变量**（避免整页样式失效） | **P1-3** 双重位移 |
| 4 | `scripts/b3-verify.mjs` | 测试 | 新增 B3 验收套件（99 项）：T1–T10 场景 | 交付证据 |

> 未改动：业务逻辑/数据结构/CAS/IndexedDB/备份恢复、B2 的 Insets 单一真源（`window.__lgApplyInsets` + `--lg-safe-*` + 拉取/重发机制原样保留）、PWA 注册逻辑、Liquid Glass 材质体系（B4 范围）。

---

## 2. 弹窗布局改造说明（三段式）

```
.fd-modal-overlay   position:fixed; inset:0; display:flex; align-items:flex-end;
                    padding-bottom: var(--fd-kb)          ← 键盘覆盖多少就抬多少
  .fd-modal-panel   display:flex; flex-direction:column;
                    max-height: calc(var(--fd-vvh) - var(--lg-safe-top) - 16px)
    .fd-modal-head  flex: 0 0 auto                            ← 固定标题栏（不滚动）
    .fd-modal-body  flex: 1 1 auto; min-height:0; overflow-y:auto;
                    overscroll-behavior: contain;
                    scroll-padding-block: 16px 104px           ← 唯一滚动区
    .fd-modal-foot  flex: 0 0 auto; border-top; 半透明渐变       ← 固定操作栏
                    padding-bottom: 12px + max(0, safe-bottom − kb)
```

要点：
1. **Footer 永不随内容滚动**：`flex: 0 0 auto` + 面板 `overflow: hidden`，只有 Body 滚动。
2. **键盘态高度自适应**：面板 `max-height` 由 `--fd-vvh`（visualViewport 高度）推导，键盘弹出后自动变矮，不会超出可视区。
3. **安全区不重复**：footer 的 `safe-bottom` 部分用 `max(0, safe − kb)` 抵消——键盘打开时系统导航条区域已被键盘覆盖，不再额外留白。
4. **短表单/长表单同一实现**：短表单面板自然收缩（只有 max-height 上限）；长表单只有 Body 出现滚动条。
5. **桌面端不变**：`min-width 640px` 下居中、`max-width:520px`、圆角恢复 30px（`--lg-r-l3`）；移动端保持上圆角 + 贴底。
6. 未隐藏任何按钮、未缩小字号、未降低对比度。

---

## 3. 键盘适配实现说明

### 3.1 为什么不再用原生 `--lg-ime` 做布局

B1 审计的 P1-3「双重位移」根因：`adjustResize` 已把 WebView 布局视口压缩，而 `--lg-ime` 又额外把底栏/内容向上抬一次 → 视觉上位移两次。

B3 改为**单一推导**：

```
--fd-kb = max(0, window.innerHeight − visualViewport.height − visualViewport.offsetTop)
          且仅当 > 80px 才视为键盘（否则视为地址栏收缩/滚动抖动）
```

| 系统行为 | innerHeight | vv.height | `--fd-kb` | 结果 |
|---|---|---|---|---|
| `adjustResize` 生效（压缩布局视口） | 变小 | 同步变小 | **0** | 系统已完成位移，弹窗不再额外抬升 → **无双重位移** |
| 覆盖式键盘（edge-to-edge，布局视口不变） | 不变 | 变小 | **= 键盘高度** | 弹窗按差值上移 → Footer 不被遮挡 |

`--lg-ime` 仍由原生写入并保留为遥测/兼容值，**但不再参与任何布局计算**（内容预留与底栏定位都已移除该因子）。

### 3.2 键盘过程采样

键盘弹出是动画（约 250–400ms）。除 `visualViewport` 的 `resize`/`scroll` 事件外，在**输入类控件**（input/textarea/select/contenteditable）获得焦点后于 0/90/220/380/620ms 追加采样，保证动画结束后 `--fd-kb` 收敛到真实值。

### 3.3 底部导航键盘行为

- 键盘弹出（`data-lg-kb="1"`）：导航 `translateY(165%)` + `opacity:0` + `pointer-events:none`，**滑出屏幕**，不再被 ime 顶到屏幕中部；
- 键盘关闭：恢复原位置（`bottom = safe-bottom + 12px`），进入/退出均有 240ms 过渡；`prefers-reduced-motion` 下无过渡；
- 键盘态导航隐藏后，内容预留不再包含 ime（避免底部出现一大块空白），页面滚动行为不受影响；
- B2 的 Insets 机制（拉取/重发/安全区变量/实测导航高度）完全保留，未改动。

### 3.4 聚焦可见性

Modal 内 `focusin` → 计算面板可见带 `[panel.top, min(panel.bottom, innerHeight) − footerHeight − 12]`，若焦点元素超出则 `scrollIntoView({block:'center'})`，并在 320ms 后（键盘动画结束、`--fd-kb` 到位）再校正一次。

### 3.5 性能保护

`--fd-kb/--fd-vvh` 的写入做了**变化检测**：值不变时不写 `documentElement` 的自定义属性（否则每次 focus 都会让 10k 行列表整页样式失效）。焦点采样也仅对输入类控件触发。

---

## 4. 各场景实测结果（B3 验收 99/99 全通过）

> 键盘为**可编程 visualViewport stub 模拟**（非真机；真机验证见 §6）。所有断言基于 `visualViewport` 几何而非"是否看起来对"。

### T1–T6 主场景

| 场景 | `--fd-kb` | 可视底边 | 面板底 | Footer 底 | 保存按钮底 | 保存可见 |
|---|---|---|---|---|---|---|
| T1 无键盘 | 0 | 2121\* | 844 | 843 | 783 | ✅ |
| **T2 键盘 320** | **320** | **524** | **524** | **523** | **511** | ✅ |
| T4 长表单（字体 150%）+ 键盘 | 320 | 524 | 524 | 523 | 511 | ✅ |
| T6 键盘收起 | 0 | 844 | 844 | 843 | 783 | ✅ |

\* T1 中 `visualViewport.height` 在无键盘时返回 stub 初始值（页面高度），断言只用到 `panel/footer` 的绝对位。

- **T2 附带断言**：底部导航"不再上浮到屏幕中部"通过（`opacity<0.05` 或 `top ≥ vvH`）；Body 成为独立滚动区；无横向溢出。
- **T3 逐字段聚焦可见**（6 个字段）：全部 `visible=true`，且都在 Footer 上沿之上（footTop=462）。
- **T5 连续切换焦点 3 轮（9 次）**：违规 0 次。
- **T6**：键盘收起后导航恢复 `opacity=1`；面板回到正常尺寸。

### T7 宽度 × 键盘矩阵（4 宽度 × 2 状态 = 8 组，全部通过）

| 视口 | kb | 面板底 | Footer 底 | 保存按钮底 | 保存可见 |
|---|---|---|---|---|---|
| 320×640 | 0 | 640 | 639 | 579 | ✅ |
| 320×640 | 320 | 320 | 319 | 307 | ✅ |
| 360×800 | 0 | 800 | 799 | 739 | ✅ |
| 360×800 | 320 | 480 | 479 | 467 | ✅ |
| 390×844 | 0 | 844 | 843 | 783 | ✅ |
| 390×844 | 320 | 524 | 523 | 511 | ✅ |
| 412×915 | 0 | 915 | 914 | 854 | ✅ |
| 412×915 | 320 | 595 | 594 | 582 | ✅ |

### T8 手势 vs 三键（+键盘）

| 导航方式 | 键盘态保存可见 | 键盘收起后导航底边距 |
|---|---|---|
| 手势（bottom inset 0） | ✅ | 12px = 0 + 12 ✓ |
| 三键（bottom inset 48） | ✅ | **60px = 48 + 12** ✓ |

### T9 旋转 / T10 前后台

| 场景 | 结果 |
|---|---|
| 横屏 844×390 无键盘 | 保存可见 ✅ |
| 横屏 844×390 + 键盘 200 | 保存可见 ✅ |
| 进入后台（visibilitychange=hidden） | `--fd-kb` 立即清零 ✅（无残留占位） |
| 回到前台 | 面板/Footer 仍在视口内 ✅ |

### 汇总指标

- **保存按钮可见率：16 / 16 = 100%**
- Footer 被键盘遮挡：0 次
- 聚焦后不可见：0 次
- 横向溢出：0 次

---

## 5. 修复前后截图

**键盘态（390×844，键盘 320）**

![修复前 / 修复后](phase-b3-evidence/compare-keyboard-footer.png)

- 左（B1 采集，修复前）：弹窗单层滚动，Footer 跟着内容滚走 → 保存按钮落在视口之外（实测 bottom=665 > 视口 544）；底部导航被 `--lg-ime` 顶到屏幕中部（top=72）。
- 右（B3 采集，修复后）：Header 固定、Body 独立滚动、**Footer 固定贴住键盘上沿**（底 523 ≤ 可视 524），保存按钮完整可见；底部导航已滑出屏幕。

**长表单 + 字体 150%**

![长表单对比](phase-b3-evidence/compare-longform.png)

更多截图（`docs/phase5.0/phase-b3-evidence/`）：`T1-no-keyboard`、`T2-keyboard-open`、`T3-focus-last-field`、`T4-long-form-150`、`T6-keyboard-closed`、`T7-{320,360,390,412}-{nokb,kb}`、`T8-{gesture,3button}-kb`、`T9-{nokb,kb}`。

---

## 6. 原有测试回归结果

| 套件 | 结果 |
|---|---|
| **B2 验收 `b2-verify.mjs`（67 项，不得退化）** | **67 / 67** ✅ |
| **PWA `e2e-pwa.mjs`（preview 构建）** | **14 / 14** ✅ |
| B3 验收 `b3-verify.mjs` | **99 / 99** ✅ |
| 逻辑 `npm test` | **369 / 369** ✅ |
| 主 E2E `e2e.mjs` | **91 / 91** ✅ |
| 无障碍 `e2e-a11y.mjs` | **35 / 35** ✅ |
| 备份 / 多标签 / 项目 / 撤销 / 引导 / 数据安全 | 14 / 29 / 30 / 20 / 16 / 14 ✅ |
| 视觉/溢出 `lg-capture.mjs` | **73 / 73** ✅ |
| 性能 `perf-5a.mjs` | 保存延迟 3 次 346/347/353ms（同机 B2 基线 350ms，容差 385ms）✅；滚动 p95 **16.7ms**、长帧 **0** ✅ |

**关于性能测量**：该指标在单次运行内样本波动 ±40ms（同一轮出现过 320–366ms）。B3 与 B2 做了同会话 A/B（B2 350ms vs B3 中位 347ms），差异在噪声内；同时 B3 期间发现并修掉了一个可归因开销（focus 时无条件写 CSS 变量导致整页样式失效），已改为变化检测。

**关于既有 4.5-F 最终验收脚本**：`scripts/e2e-final-4.5f.mjs` 在 **B2 基线（`ae846f1`）上就已经是 19/25**（6 项失败，涉及 D0–D6 之后演进的交互），与 B3 无关，故不作为本阶段回归门槛；已在报告中如实记录。

---

## 7. 尚未解决的问题与风险

| # | 问题/风险 | 说明 | 计划 |
|---|---|---|---|
| 1 | **真机未验证** | 无 adb 设备 + B 阶段禁止构建 APK；键盘行为全部为 visualViewport 模拟 | B5 构建后在 vivo X200s 实测：三键/手势 × 键盘 × 字体 × 旋转 |
| 2 | 键盘高度判定阈值 80px | 极端场景（超小键盘/悬浮键盘）可能不判定为键盘 | 真机确认；必要时按平台参数化 |
| 3 | 部分输入法（如搜狗）会改变 visualViewport 行为 | 未验证 | B5 真机用 2–3 种输入法测 |
| 4 | `adjustResize` 与覆盖式键盘的判定依赖 WebView 行为 | 已用数学方式消除双重位移，但不同厂商 WebView 差异仍需真机确认 | B5 |
| 5 | B1 剩余 P2（横屏左右 insets 已修；`text-size-adjust` 已加）之外的次要项 | 无 | — |
| 6 | Liquid Glass 视觉（B4） | 本阶段未触碰 | B4 |

---

## 8. Git

| 项 | 值 |
|---|---|
| 产品代码修改 | 3 个文件（`UI.tsx`、`styles.liquid-glass.css`、`insets.ts`） |
| 测试新增 | `scripts/b3-verify.mjs` + 证据目录 |
| 构建 APK / 合并 main / 打 Tag | **均未执行** |
| 基线 | `ae846f102192cfdabe91f12ce5025bfc2713fc06` |
| **B3 提交 SHA** | 见提交结果（`phase5.0-a`） |

**B3 已完成，停止开发，等待人工验收。未进入 B4。**
