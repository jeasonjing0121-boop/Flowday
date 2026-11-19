# Phase 5.0-B · B1 审计报告：Android 原生系统窗口与 Insets

> 阶段：**B1（仅审计，未修改任何产品代码）**
> 分支：`phase5.0-a` · 审计基线 commit：`01e3799`
> 审计日期：2026-11-18
> 结论：**B1 不通过。** 复现出 4 个 P0、3 个 P1 级系统窗口/布局缺陷，其中包括你反馈的「底部导航遮挡任务卡片」的精确成因（28px 固定缺口）与「系统状态栏/导航栏压住应用内容」的精确成因（Insets 管线一次性推送丢失）。

---

## 0. 方法与边界（必须先说清楚）

| 项 | 状态 |
|---|---|
| 本机真机测试 | **无法执行**：`adb devices` 空；CPU 虚拟化固件关闭（`VirtualizationFirmwareEnabled=False`、SLAT=False），模拟器无法运行 |
| 本报告的数据来源 | **Chromium 无头浏览器 + 移动视口模拟 + 原生 Insets 注入模拟**（Blink 与 Android WebView 同渲染引擎，但**不等于真机**） |
| 结论可信度 | 布局几何、CSS 计算、代码路径缺陷 = **确定**（可复算）；真机厂商差异（WebView 版本、Insets 值、`adjustResize` 实际行为）= **待真机确认** |
| 产品代码改动 | **0 处**（仅新增审计脚本 `.tmp/audit-*.mjs` 与证据/报告文档） |
| APK 构建 / main 合并 / 打标签 | **均未执行** |

证据文件：`docs/phase5.0/phase-b1-audit/`
- `audit-measurements.json`（全场景原始测量）
- 截图：`A-390-no-insets-top/bottom`、`A2-390-vars-unset-real-device-state`、`B-390-3button-top/bottom`、`D-844x390-landscape`、`E-keyboard-before/after`、`F-font130`、`G-{320,360,390,412}-tasks`

---

## 1. 审计结论摘要

| # | 缺陷 | 级别 | 状态 |
|---|---|---|---|
| B1-01 | **原生 Insets 只有"一次性推送"，且推送发生在 JS 钩子定义之前 → 设备上安全区变量恒为 0** | **P0** | 确认（代码 + 实测） |
| B1-02 | **底部安全区被重复计算**（导航条 `padding-bottom` + `bottom` 偏移各加一次）→ 内容被应用导航遮挡 28px | **P0** | 确认（实测 28px） |
| B1-03 | 安全区缺失时应用底部导航沉到底部 12px → 被系统导航栏（三键 48dp）覆盖约 36dp | **P0** | 确认（实测） |
| B1-04 | 安全区缺失时应用头部距顶 12px → 被系统状态栏（24–30dp）覆盖 | **P0** | 确认（实测 header.top=12） |
| B1-05 | 键盘弹出时导航栏随 `--lg-ime` 上浮到屏幕中部（实测 top=72，视口 544），并遮挡内容 | P1 | 确认（模拟） |
| B1-06 | 弹窗底部「保存/取消」在键盘展开后不可见（footer 在滚动内容内，按钮 bottom=665 > 视口 544） | P1 | 确认（模拟） |
| B1-07 | 系统字体放大 150% 时导航实际高 140px，而内容预留固定 144px（96+safe）→ 遮挡 56px | P1 | 确认（模拟） |
| B1-08 | 横屏左/右安全区未应用到导航与头部（`inset-x-3`、`px-3`），三键横屏右侧栏可能压住导航 | P2 | 推导（待真机确认） |
| B1-09 | 缺少 `-webkit-text-size-adjust`、`overscroll-behavior`、`visualViewport` 处理 | P2 | 确认（代码缺失） |
| B1-10 | 启动瞬间状态栏图标按「浅色主题」预设，深色主题设备可能闪错 | P2 | 确认（代码逻辑） |
| B1-11 | 桌面/平板侧栏 `fixed top-3`、底部导航 `inset-x-3` 忽略安全区（刘海横屏/三键横屏） | P2 | 确认（代码） |

**验收标准对照（当前全部未达标）**：
状态栏不遮挡 ❌ · 系统导航区适配 ❌ · 应用导航不遮挡任务 ❌（三键 28px）· 无需手动缩放 ✅（缩放已禁用，但见 §4.9 待复核）· 无意外横向滚动 ✅（320–412 实测 0 溢出）· 卡片与弹窗完整显示 ⚠️（键盘态不完整）· 键盘不遮挡输入/确认 ❌ · 多尺寸布局 ✅（几何层面）· Liquid Glass 视觉 ❌（见 §7）· 业务回归 ✅（B0 已测）· Web/PWA 无回归 ✅ · 新 APK 未构建（本阶段禁止）。

---

## 2. P0 根因链条（按代码定位）

### B1-01 Insets 管线：一次性推送 + 钩子未就绪 + 去重锁

**代码位置**
- `android/app/src/main/java/app/flowday/beta/MainActivity.java:88-93`（`setOnApplyWindowInsetsListener` → `dispatchInsets` → `requestApplyInsets`）
- `MainActivity.java:106-130`（`dispatchInsets`：`lastTop/lastBottom/...` 去重 + `evaluateJavascript` 一次性发送）
- `src/lib/liquidGlass.ts:118-136`（`window.__lgApplyInsets` 在 **JS bundle 执行后**才定义）
- `src/styles.liquid-glass.css:66-69`（`--lg-safe-*` 默认 `env(...)`，Android WebView 中为 0）

**时间线（实测，本机 Chromium）**

| 时刻 | 事件 | 观察值 |
|---|---|---|
| t≈0 | Activity `onCreate` → `requestApplyInsets` → 原生推送 Insets | —（设备上发生，模拟无法观测） |
| t≈83ms | 页面 `interactive` | `typeof window.__lgApplyInsets === 'undefined'`；`--lg-safe-top` 未被 JS 设置 |
| **t≈1534ms** | **JS bundle 执行，钩子才被定义** | `__lgApplyInsets === 'function'` |
| t≈1856ms | `document.readyState === 'complete'` | — |

→ 原生唯一一次推送发生时，接收函数不存在；`evaluateJavascript` 无接收方，静默丢弃。
→ 之后 `lastTop/lastBottom` 已写入，**相同 Insets 永不再发**（`:107` 去重）。
→ 页面重载（开发热更、WebView 重建、进程恢复）会清空 JS 变量，而原生侧去重锁仍在 → **再也不恢复**。

**真机表现**：`--lg-safe-top/bottom = 0px` → 头部 12px（被状态栏压住）、导航距底 12px（被系统导航栏压住）。这与真机反馈完全一致。

**实测（模拟"推送丢失后的真实运行态"，未调用钩子）**

```
--lg-safe-*: computed 0px（inline 未设置）
header.top = 12     nav.bottom = 832 / 844    nav.height = 64
main.padding-bottom = 96px
env(safe-area-inset-top/bottom) = 0px / 0px   ← Android WebView 也不能靠 env() 兜底
```

### B1-02 底部安全区重复计算（"遮挡任务卡片"的精确成因）

**代码位置**
- `src/styles.liquid-glass.css:233-236`：`.tabbar-liquid { padding-bottom: calc(6px + var(--lg-safe-bottom)); }`
- `src/styles.liquid-glass.css:716-718`：`nav { bottom: calc(var(--lg-safe-bottom) + var(--lg-ime) + 12px); }`
- `src/styles.liquid-glass.css:526-528`：`.lg-main-mobile { padding-bottom: calc(96px + var(--lg-safe-bottom)); }`

**几何推导**
- 导航占用高度 = 自身高度(56 + 6 + safe) + 底部偏移(12 + safe) = **74 + 2·safe**
- 内容预留 = **96 + 1·safe**
- 差额 = 预留 − 占用 = **22 − safe**

**实测（390×844，DPR=2）**

| 场景 | safe-bottom | 导航 top | 导航高 | 内容预留 | 内容底部 | **遮挡** |
|---|---|---|---|---|---|---|
| 无 Insets | 0 | 768 | 64 | 96 | 748 | 0（余 20px） |
| **三键导航** | **48** | **672** | **112** | **144** | **700** | **28px（P0）** |
| 手势导航 | 0 | 768 | 64 | 96 | 748 | 0（余 20px） |
| 字体 150% + 三键 | 48 | 644 | 140 | 144 | 700 | **56px（P1）** |

→ 结论：只要设备报告的底部安全区 > 22dp（三键 ≈48dp、部分手势机 24–34dp），**最后一屏内容必被应用导航遮住**。这解释了「首页底部导航遮挡任务卡片」。
→ 同时说明「不要简单给 body 加 padding-bottom」正是当前实现的问题：预留值是硬编码 + 与真实导航高度无关联。

### B1-03 / B1-04 系统栏压住应用内容

- 导航：`nav.bottom = 832`（视口 844）→ 距屏幕底部仅 12px。三键设备系统导航栏占底部 48dp（≈96 设备像素）→ **系统栏覆盖应用导航的下半部**，点击区域被系统栏抢走。
- 头部：`header.top = 12`，系统状态栏 24–30dp → **状态栏直接压住头部玻璃条**（时间/电量叠在标题上）。

### 键盘（P1，B3 阶段治理）

实测（视口压缩到 544 + `ime=300`）：

```
弹窗 panel: top=44 bottom=544  （max-h: 92dvh = 500）
「保存」按钮: top=629 bottom=665  → 超出视口，不可见
底部导航 top = 72  → 被 --lg-ime 推到屏幕中部
```

根因：
1. 弹窗 footer 位于 `overflow-y-auto` 的内容区内，不是粘性底栏；键盘压缩视口后需要用户手动滚动才能看到「保存」。
2. 导航 `bottom` 直接加 `--lg-ime`，在 `adjustResize` 已压缩视口的场景下形成**双重位移**（视口↑ 300 + 偏移↑ 300）→ 导航浮到屏幕中部。
3. 全站无 `window.visualViewport` 监听，无键盘感知的布局回退。

---

## 3. Android 原生层逐项审计

| 检查项 | 现状 | 判定 |
|---|---|---|
| Edge-to-Edge | `WindowCompat.setDecorFitsSystemWindows(window, false)`（`:60`）；`activity_main.xml` 为 match_parent 全屏 CoordinatorLayout | ✅ 已开启；⚠️ 但内容是"全屏"而上层没人接住 Insets |
| 状态栏颜色/对比 | `statusBarColor=TRANSPARENT`，API29+ 关闭 `statusBarContrastEnforced`（`:61-67`） | ✅ 正确 |
| 状态栏图标明暗 | `WindowInsetsControllerCompat.setAppearanceLightStatusBars(!dark)`，由 JS `FlowDayNative.setDark` 驱动（`:85-101`, `liquidGlass.ts:99-110`） | ⚠️ 启动默认按浅色（`:84`），深色主题设备可能闪 1 帧 |
| 系统导航栏 | `navigationBarColor=TRANSPARENT`、关闭对比强制、`navigationBarDividerColor=TRANSPARENT` | ✅ 正确 |
| Insets 读取 | `systemBars() | displayCutout() | ime()`（`:88-90`），dp 换算后下发 | ✅ 读取正确；❌ 下发链路断（B1-01） |
| 去重锁 | `lastTop/lastBottom/lastLeft/lastRight/lastIme` | ❌ 与"页面重载"冲突：重载后 JS 变量清空但原生不再发（B1-01） |
| 重载/恢复 | 无 `onPageFinished` 重发、无"JS 主动拉取"接口 | ❌ 缺失 |
| 生命周期 | `onCreate` 内 `requestApplyInsets` 一次；`configChanges` 含 orientation/density/uiMode，旋转不重建 → 依赖 Insets 变化事件 | ⚠️ 旋转可触发，但首帧仍丢失 |
| 缩放 | `setSupportZoom(false)`、`setBuiltInZoomControls(false)`、`setDisplayZoomControls(false)`（`:72-75`）；Capacitor 默认 `zoomEnabled=false`（`Bridge.java:617-618`） | ✅ 双击/双指缩放已禁用；`textZoom` 未设定（保留字体缩放）✅ |
| 键盘 | Manifest `adjustResize`；Inserts 含 `ime()` | ⚠️ 但布局未按 ime 正确预留（B1-05/06） |
| 返回键 | 未启用 `enableOnBackInvokedCallback`（避免 Capacitor 未注册回调导致直接退出）；依赖 `BridgeActivity` 历史回退 | ✅ 合理，待真机确认 |
| 安全性 | `addJavascriptInterface` 仅暴露 `setDark` | ✅ |
| 权限 | 仅 INTERNET + androidx 自动生成权限 | ✅ |

## 4. Web 层（CSS/DOM）逐项审计

| 检查项 | 现状 | 判定 |
|---|---|---|
| 滚动容器 | 文档滚动（`document.scrollingElement`），无嵌套全屏滚动容器；`main` 非滚动容器 | ✅ 结构正确 |
| 固定高度 | 无 `100vh/h-screen`；根为 `min-h-dvh`；`main` 无固定高度 | ✅ |
| `100vh/dvh` 风险 | 弹窗用 `max-h-[92dvh]`（键盘弹出时 dvh 不随键盘变化 → 依赖 `adjustResize`） | ⚠️ B3 需改用 visualViewport 变量 |
| `position: fixed` | 底部导航、弹窗层、菜单遮罩、跳过链接 | ⚠️ 导航需与系统栏联动（B1-02/03） |
| 安全区来源 | `--lg-safe-*` 默认 `env()`，Android WebView 中恒 0；**唯一可靠来源是原生注入** | ❌ B1-01 导致失效 |
| 顶部安全区 | `.lg-safe-frame{padding-top:calc(safe+12)}`（`:510-517`）+ 头部 `sticky top:calc(safe+12)`（`:713-715`） | ✅ 公式正确（无重复），但依赖 safe 变量 |
| 底部预留 | `.lg-main-mobile{padding-bottom:calc(96px + safe)}`（`:526-528`） | ❌ 硬编码 96px 与实际导航高度（74+2·safe）不匹配 → B1-02/07 |
| 横向溢出 | 320/360/390/412 实测 `scrollWidth == clientWidth` | ✅ |
| 字体缩放 | 130% 无横向溢出、无行内裁切；但导航高度 64→81→140（150%）导致底部遮挡 | ❌ B1-07 |
| `text-size-adjust` | 未声明 | ⚠️ WebView 文本自动放大风险（P2） |
| `overscroll-behavior` | 未声明 | ⚠️ Android 拉伸回弹叠在玻璃上会出现边缘伪影（P2） |
| `visualViewport` | 未使用 | ❌ 键盘/缩放感知缺失（B3） |
| 触控/点击目标 | 导航项 56×~70px，满足 44px | ✅ |

---

## 5. 为什么"看起来只是磨砂玻璃"（B4 输入）

审计了 `src/styles.liquid-glass.css` 的 L1 材质管线（折射环 `:158-183`、透镜光带 `:184-197`、内衬高光/厚度 `:29-40`、环境染色 `:131-141`）：

| 光学层 | 实现 | 浅色模式实测有效性 |
|---|---|---|
| 折射环 | `conic-gradient` 白色 95%→42%→4%，1.25px，mask 抠环 | **无效**：白描边压在近白内容上，ΔL≈0.8%，低于可感知阈值（~2%） |
| 透镜光带 | 顶部 46% 白渐变 62%→0 | **几乎不可见**（白叠白） |
| 内衬上高光 | `inset 0 1px 0 rgba(255,255,255,.9)` | **不可见**（白叠白） |
| 厚度阴影 | `inset 0 -12px 20px -16px rgba(24,28,44,.28)` | 可见（唯一的深色层） |
| 环境染色 | `--lg-ambient` 8% + 12% 侧向光斑 | 弱（8% 在近白底上 ≈ 1–2 灰度级） |
| 背景模糊 | `blur(22px) saturate(185%) brightness(1.06)` | 可见，但这就是"磨砂玻璃"本身 |

**结论**：深色模式下玻璃层次是成立的（多为黑底 + 白高光）；**浅色模式下所有光学层都是"白色叠在白色上"，只剩 blur + 半透明白 → 观感 = 普通毛玻璃**。这正是你判断"只是磨砂玻璃"的技术原因，而不是主观评价。

缺口（B4 要补的）：
1. **对比度而非亮度**：边缘必须同时有 **暗发丝 + 亮高光**（双边），才能在浅色内容上被看见；
2. **真实折射感**：内容在边缘被压缩/位移（iOS Liquid Glass 的核心），当前完全没有；
3. **厚度与空间**：缺多层厚度（外玻璃 + 内壁 + 底投影三层分离）；
4. **动态环境响应可视化**：8% 染色不可感知，需要"内容色—玻璃色"联动 + 滚动时的镜面高光位移；
5. **按压光响应**：当前只有 scale，没有光影变化。

---

## 6. 建议整改方案（待你确认后才执行）

### B2 · Insets 管线与响应式基础（P0 一次根治）
1. **原生侧**：改为"状态机 + 握手"：`registerInsetsBridge`（JS 就绪后调用一次原生 `requestInsets()` 拉取当前值）+ `onPageFinished` 重发 + Insets 变化时按需下发；**insets 值改用 `WindowInsetsCompat` 缓存并由原生主动查询**，去重锁只在"值未变且 JS 已确认接收"时生效。
2. **Web 侧**：新增 `insets.ts` 单一真源：`--safe-top/bottom/left/right` + `--nav-h`（由 `ResizeObserver` 实测导航高度写入）+ `--vvh`（visualViewport 高度）。所有布局只读这几个变量，**删除硬编码 96px**。
3. **布局**：`.lg-main-mobile { padding-bottom: calc(var(--nav-h) + var(--nav-gap) + var(--safe-bottom) + 8px) }`；导航高度不再把 safe 计入自身 padding（改为外层 wrapper 提供 safe 间距），彻底消除重复计算。
4. **验收**：4 组模拟（none/gesture/3-button/font150）遮挡 = 0px；真机复核。

### B3 · 键盘与弹窗
1. 弹窗改为 **flex 三段式**（头部固定 / 内容滚动 / footer 粘性），footer 永在视口内；
2. 键盘弹出时：`--vvh` 驱动弹窗 max-height；底部导航隐藏或钉在 safe 区（不再随 ime 上浮）；
3. 输入框聚焦时 `scrollIntoView({ block:'center' })`；
4. 验收：模拟键盘（视口-300 + ime）下「保存」按钮可见率 100%。

### B4 · Liquid Glass 重新设计
1. 双边边缘：外圈暗发丝 + 内圈亮高光 + 折射环三段（亮/暗/反向高光），浅色模式以**暗边**定形；
2. 双层折射：L1 增加一层"边缘遮罩的二次模糊 backdrop"（仅导航/弹窗，≤2 层，移动端 1 层）；
3. 厚度：外壁 1px + 内壁渐变 + 底部投影三层；
4. 动态：滚动时镜面高光沿边缘位移（`--lg-scroll` 驱动，仅 transform/opacity）；按压时光带增强；
5. 环境响应提升到 12–16%（深色仍 8%）并加入亮度自适应；
6. 性能门槛：新增图层只在 L1；移动端 blur ≤16px；`prefers-reduced-transparency` / 低端机降级；
7. 验收：像素级指标（边缘 ΔL ≥ 4%、环境染色可测）、滚动 p95 ≤ 20ms、对比度 ≥4.5:1。

### B5 · 测试与交付
- 模拟矩阵 9 组（320/360/390/412 × 竖/横 × 手势/三键 × 字体 100/130/150% × 键盘开合 × 深浅）；
- 真机矩阵（需你的设备）逐项打勾；
- 全量回归（369 + 91/35/29/30/20/16/14/14/14 + perf）；
- 新 APK（versionCode 3，`5.0-a-beta.3`），签名沿用，SHA-256 记录。

**风险与回滚**：B2 改动集中在 `MainActivity` + `liquidGlass.ts` + 3 条 CSS 规则，可整体 `git revert`；Web/PWA 端只能走 `env()` 回退路径，需保持 PWA 测试 14/14 不变。

---

## 7. 测试矩阵现状（模拟 vs 真机）

| 维度 | 取值 | 当前证据 | 真机必需 |
|---|---|---|---|
| 视口宽度 | 320 / 360 / 390 / 412 | ✅ 模拟（无横向溢出） | ✅ |
| 方向 | 竖屏 / 横屏 | ⚠️ 模拟（横屏左右安全区缺陷 B1-08） | ✅ |
| 导航方式 | 手势 / 三键 | ⚠️ 模拟注入（三键 48dp 复现 28px 遮挡） | ✅ |
| 系统字体 | 100% / 130% / 150% | ⚠️ 模拟（150% 遮挡 56px） | ✅ |
| 键盘 | 起 / 收 | ⚠️ 模拟（保存按钮不可见） | ✅ |
| 主题 | 浅 / 深 | ✅ 模拟 + 108 张截图 | ✅ |
| 厂商差异 | MIUI/HyperOS、One UI、ColorOS… | ❌ 无设备 | ✅ |

---

## 8. 需要你提供 / 确认的信息（用于 B2 精准修复）

1. 实测机型、Android 版本、WebView 版本（`设置→应用→Android System WebView`）；
2. 导航方式：手势 or 三键（或 `adb shell settings get secure navigation_mode`：0=三键、1/2=手势）；
3. 截图：状态栏与头部重叠、底部导航与系统栏重叠各一张（含系统栏可见）；
4. 是否用了「显示大小/字体大小」非默认值；
5. `adb shell dumpsys window | findstr -i insets` 输出（可选，能直接给出真实 Insets 值）。

---

## 9. 本阶段交付与 Git

| 项 | 值 |
|---|---|
| 修改文件清单（产品代码） | **无** |
| 新增文件 | `docs/phase5.0/PHASE-B1-AUDIT-REPORT.md`、`docs/phase5.0/phase-b1-audit/*`（证据）、`.tmp/audit-*.mjs`（本地脚本，不入库） |
| 修改原因 | 仅审计取证，未改实现 |
| 实际测试结果 | 见 §1/§2/§4 数据表；模拟矩阵 9 组 |
| 测试截图 | `docs/phase5.0/phase-b1-audit/A-*`、`B-*`、`D-*`、`E-*`、`F-*`、`G-*` |
| 未解决问题 | §1 表中 P0/P1/P2 全部待 B2–B4 修复；真机证据缺失 |
| Git 提交 SHA | 见下（文档提交，`phase5.0-a` 分支） |

**未做任何 B2 代码改动，等待你确认整改方案后再进入 B2。**
