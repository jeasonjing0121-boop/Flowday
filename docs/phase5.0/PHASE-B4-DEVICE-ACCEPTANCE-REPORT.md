# Phase 5.0-B4 · 真机验收报告（vivo X200s · 实机证据）

> 代码冻结：HEAD `5339589f0577fa0fd0a70476fa19ead7001fe27a`，**已跟踪文件 0 改动、0 新提交**；本轮新增材料全为 untracked。
> 设备：vivo X200s（V2458A）· OriginOS 7 · **Android API 37** · WebView **157.0.8103.38**
> 采集方式：`adb reverse` + vivo 浏览器（设备无 Chrome）+ `adb shell screencap` / `screenrecord`
> 采集时间：2026-11-19 18:24–18:36（Asia/Shanghai）

---

## 0. 本报告的边界（先说清楚）

| 项 | 说明 |
|---|---|
| 真机证据来源 | 全部来自 `10AF9G1ARE006XS`（vivo X200s）的 `screencap` / `screenrecord`，**未使用任何模拟截图冒充** |
| 浏览器 ≠ WebView | 设备未安装 Chrome，默认浏览器为 `com.vivo.browser`；渲染引擎同为 Blink，材质代码一致，但**无 edge-to-edge、无 Capacitor Insets**，故 **⑦ 不在此判定** |
| 无法自动化的维度 | ⑥ 按压态（adb 合成触摸不触发 CSS `:active`）、⑧ 屏幕亮度（`screencap` 不含背光）、⑨ 系统字体缩放（浏览器不随 `font_scale`）——均如实标注，不伪造通过 |
| 已知环境陷阱 | vivo 浏览器在**系统夜间模式**下强制深色，会覆盖网页配色（首次误判"浅色未生效"即由此产生）；关闭系统夜间模式后正常，已修正复测 |

---

## 1. 冻结状态（区分 tracked / untracked）

```text
$ git rev-parse HEAD
5339589f0577fa0fd0a70476fa19ead7001fe27a
$ git diff --stat            → (empty)
$ git diff --cached --stat   → (empty)
$ git status --porcelain     → 仅 ?? （60 个 untracked 文件，全部为本轮验收材料）
```

| 状态 | 结果 |
|---|---|
| 已跟踪文件 | **clean（0 改动）** |
| 新提交 | **0**（未提交，保持 SHA） |
| untracked | **60 个**（文档 3 + 模拟参考图 9 + **真机证据 48**） |
| APK / main / Tag / B5 | 均未触碰 |

---

## 2. 设备事实（由 `scripts/device-acceptance.ps1 -Action info` 实采）

| 项 | 实测值 |
|---|---|
| 型号 / 厂商 | **V2458A** / vivo |
| 系统 | OriginOS **17**（`ro.build.version.release=17`，`ro.vivo.os.version=17.0`） |
| **API Level** | **37**（`ro.build.version.sdk`，非按版本号推测） |
| 构建号 | `PD2458_A_17.2.13.2.W10` |
| 内核 | `6.6.127-android15-8-g3b723d0e8507-abogki558077879-4k` |
| 安全补丁 | 2026-10-01 |
| **WebView** | **157.0.8103.38**（`com.google.android.webview`） |
| 浏览器 | `com.vivo.browser`（设备**无 Chrome**） |
| 导航方式 | `navigation_mode = 2` → **手势导航** |
| 系统字体缩放 | `font_scale = 1.0`（测试期间临时改 1.3/1.5，已恢复） |
| 屏幕 | **1260×2800 @560dpi** → CSS 视口 **360×800 dp**（DPR 3.5） |
| 已装应用 | `app.flowday.beta` **5.0-a-beta.2（versionCode 2）**，安装于 2026-11-18 12:13 |
| 真实 Insets（`dumpsys window`） | `statusBars` top **147px = 42dp**；`navigationBars`(手势条) bottom **63px = 18dp**；`displayCutout` top **125px ≈ 35.7dp** |

> 真实 Insets 数据可直接用于 B5 APK 的 ⑦ 判定（42dp 状态栏 / 18dp 手势条 / 35.7dp 挖孔）。

---

## 3. 九项逐项结果

> 每项按你要求记录：测试环境 / 实际结果 / 证据 / 判定 / 未通过问题与复现方式。
> 统一环境：vivo X200s V2458A · API 37 · WebView 157 · 手势导航 · 字体 100% · 屏幕亮度自动(46/255) · 采集方式 Chrome(=vivo 浏览器)+adb reverse · 系统夜间模式关闭 · 应用主题按项说明。

### ① 浅色模式：边缘清晰、有厚度感 —— **通过**

- **实际结果**：白底上可清晰看到玻璃的**外侧暗轮廓**与**内侧亮镜面线**；边缘存在 8–12px 的亮度过渡带（厚度感），不是"白叠白"。客观测量（页头下边/底栏顶边，行平均亮度阶跃）：**外侧 ΔL = −0.360 / −0.565**，**内侧 ΔL = +0.473 / +0.306**（ΔL 0.02 即可辨，实测为 15–28 倍）。
- **证据**：`light-01-today.png`、`light-06-today-top.png`、`closeup-header-light.png`、`closeup-tabbar-light.png`、`closeup-card-light.png`
- **判定**：**通过**
- **问题/复现**：无。（环境注意：若系统开启夜间模式，vivo 浏览器会强制深色，导致"浅色看不出效果"——需先关闭系统夜间模式，见 §5-1）

### ② 深色模式：镜面反射自然，不过亮/发灰 —— **通过**

- **实际结果**：深色玻璃呈深色半透明而非灰白塑料；顶部镜面带柔和、不刺眼；边缘有亮线定形。客观测量：外侧 ΔL = −0.278，内侧 ΔL = +0.293；深色底栏/页头区域平均亮度 0.14–0.59（**未出现整体发亮**）。
- **证据**：`dark-01-today.png`、`dark-02-today-scrolled.png`、`closeup-header-dark.png`、`closeup-tabbar-dark.png`、`closeup-card-dark.png`、`dark-03-modal.png`
- **判定**：**通过**
- **问题/复现**：无。

### ③ 滚动时镜面高光自然移动、无闪烁/跳动 —— **通过（含量化限制说明）**

- **实际结果**：录屏 12s（3 次上滚 + 3 次回滚）观感平滑，无闪白、无跳变；真机帧统计 **总帧 2840，Janky 29（1.02%），50th percentile 14ms**（同一会话）。
- **量化限制（如实）**：截图无法把"镜面 ±8px 的水平位移"与"内容滚动"分离——连续帧差异主要由内容位移造成（帧间 mean|Δ|=4.06→46.97，相位估计 dx 最大 120px，属内容位移）。因此该位移只在模拟侧量化过（−8…+8px），真机以录屏目视 + 帧统计为准。
- **证据**：`scroll-01-recording.mp4`（13.86 MB）、`scroll-frame-0..4.png`、`frames-chrome.txt`
- **判定**：**通过**
- **问题/复现**：无可复现的闪烁/跳帧。

### ④ 底部导航液态玻璃层次（非普通磨砂） —— **通过**

- **实际结果**：底栏具备外暗边 + 内亮边 + 底部环境染色 + 选中项"小玻璃胶囊"（自身有双边缘与镜面）；滚动内容在其下方经过，层次明确。
- **证据**：`closeup-tabbar-light.png`、`closeup-tabbar-dark.png`、`light-02-today-scrolled.png`、`dark-02-today-scrolled.png`
- **判定**：**通过**  **问题/复现**：无。

### ⑤ 弹窗 / 卡片 / 按钮材质语言统一 —— **通过**

- **实际结果**：弹窗、下拉菜单、卡片、按钮均可观察到同一套语言：外暗内亮双边缘、同方向顶部高光、相近的厚度过渡；卡片为更实的内容材质但不违和。
- **证据**：`closeup-modal-light.png`、`closeup-modal-dark.png`、`closeup-menu-light.png`（下拉菜单）、`closeup-card-light/dark.png`、`light-05-menu-popover.png`
- **判定**：**通过**  **问题/复现**：无。

### ⑥ 按压按钮的光学反馈 —— **无法用 adb 判定（待人工目视）**

- **实际结果**：`adb shell input swipe x y x y <duration>` 合成的"长按"**不会触发 CSS `:active`**：按住帧与基线帧在底栏区域逐像素相同（mean|Δ| = **0.00**）。因此无法用脚本产出可验证的按压帧。
- **已尽力提供的材料**：`press-01-recording.mp4`（10s，连续点击 今日/任务/日历，30fps 录屏，可逐帧观察按下瞬间的高光增强/内缩）。
- **证据**：`press-01-recording.mp4`、`press-base.png`、`press-hold-1.png`（与 base 完全相同，证明合成触摸无效）、`closeup-press-compare.png`
- **判定**：**不可判定（不计通过）**，需人工在设备上按住按钮目视确认。
- **复现方式**：设备上长按「添加任务 / 新建任务 / 底栏项」各 3 次，观察按下瞬间是否有高光增强与轻微内缩、松手是否自然回落。

### ⑦ 状态栏 / 系统导航栏 / 安全区 —— **待 B5 APK（本轮不判定）**

- **实际结果**：Chrome(=vivo 浏览器) 阶段页面被浏览器地址栏与底部工具栏占据，**不能反映 APK 的 edge-to-edge 行为**；本轮只记录真实 Insets 供 B5 比对：statusBar **42dp**、手势条 **18dp**、挖孔 **35.7dp**、导航模式 **手势**。
- **证据**：`device-facts.json`（含 Insets dump）、`light-01-today.png`（可见浏览器 UI 占位）
- **判定**：**待 B5 APK**（按你的要求，不允许以 Chrome 结果判通过）
- **B5 复核点**：头部是否让开 42dp 状态栏；底栏是否抬到 18dp 手势条之上；横屏左右是否让开挖孔；键盘弹出时底栏滑出、弹窗 footer 可见。

### ⑧ 不同屏幕亮度（20/60/100%）观感 —— **无法用截图判定（待人工目视）**

- **实际结果**：将系统亮度依次设为 20% / 60% / 100% 并各截一张，**三张截图字节完全相同（均 2,408,691 B）**——证明 `screencap` 只捕获合成后的画面内容、**不包含屏幕背光**，故该维度不能用截图取证。
- **证据**：`brightness-20-dark.png`、`brightness-60-dark.png`、`brightness-100-dark.png`（字节相同即为证据）
- **判定**：**不可判定（不计通过）**，需人工在不同亮度下目视（或用另一台相机拍摄屏幕）。
- **复现方式**：关闭自动亮度 → 20%/60%/100% → 分别看深色是否发灰、浅色边缘是否仍可见。

### ⑨ 不同页面尺寸适配 —— **部分通过**

| 子项 | 方法 | 结果 | 判定 |
|---|---|---|---|
| 360dp（设备原生） | 直接采集 | 布局正常、无横向滚动 | **通过** |
| **320dp** | `wm size 1120×2489`（真机渲染） | 正常，无溢出/裁切 | **通过** |
| **390dp** | `wm size 1365×…`（深色） | 正常 | **通过**（浅色未采） |
| **412dp** | `wm size 1442×…` | 正常 | **通过** |
| **横屏** | `user_rotation=1` | 页头/底栏横排正常，内容无溢出 | **通过** |
| **字体 130% / 150%** | `font_scale=1.3/1.5` | **浏览器不随系统字体缩放**（130% 与 150% 截图文字尺寸与 100% 一致） | **待 APK（WebView 才会应用）** |

- **证据**：`size-1120px-light/dark.png`、`size-1365px-dark.png`、`size-1442px-light/dark.png`、`size-landscape-light/dark.png`、`font-13-light.png`、`font-15-light.png`
- **判定**：**页面尺寸 5/5 通过；字体缩放 2 项待 APK**。
- **复现方式（字体）**：APK 内设置系统字体 130%/150% → 检查首页/底栏是否随字号增高而遮挡（B2/B3 已有实测机制，需真机 APK 复核）。

---

## 4. 汇总

| # | 项目 | 判定 |
|---|---|---|
| ① | 浅色边缘与厚度 | **通过** |
| ② | 深色镜面自然 | **通过** |
| ③ | 滚动高光/无闪烁 | **通过**（Janky 1.02%、50th 14ms） |
| ④ | 底栏液态层次 | **通过** |
| ⑤ | 材质语言统一 | **通过** |
| ⑥ | 按压光学反馈 | **不可判定**（adb 合成触摸不触发 `:active`，待人工目视） |
| ⑦ | 系统栏/安全区 | **待 B5 APK**（本轮不判定） |
| ⑧ | 亮度 20/60/100% | **不可判定**（screencap 不含背光，待人工目视） |
| ⑨ | 尺寸适配 | **尺寸 5/5 通过**；字体缩放 **待 APK** |

**通过 5 项（①②③④⑤+⑨尺寸部分）· 待人工 2 项（⑥⑧）· 待 APK 2 项（⑦、⑨字体）。**

---

## 5. 发现的问题与环境风险

| # | 问题 | 性质 | 复现方式 | 影响 |
|---|---|---|---|---|
| 1 | vivo 浏览器在系统夜间模式下**强制深色**，覆盖网页浅色配色 | 采集环境 | 系统开夜间模式 → 应用切浅色 → 页面仍暗 | 仅影响 Chrome 阶段的浅色判定，**APK 不受影响**；已通过关闭系统夜间模式修正 |
| 2 | 长按网页内容可能触发**站外 App**（小红书/得物），导致采集中断 | 采集环境 | 对网页内容长按 800ms | 已改为只对底栏/按钮等非链接区操作 |
| 3 | adb 合成触摸不产生 CSS `:active` | 工具限制 | any 长按后截图与基线逐像素相同 | ⑥ 无法自动化，需人工 |
| 4 | `screencap` 不含背光 | 工具限制 | 三档亮度截图字节相同 | ⑧ 无法自动化，需人工 |
| 5 | 浏览器不应用系统字体缩放 | 平台差异 | font_scale 1.3/1.5 后文字尺寸不变 | ⑨字体项需 APK |
| 6 | 设备未安装 Chrome | 设备现状 | `pm list packages` 无 chrome | 采用 vivo 浏览器 + adb reverse 替代；不影响材质判定 |

> 本机未发现"材质/布局类"缺陷（①②③④⑤⑨ 均未复现出需要修复的问题）；上述 6 项均为**采集环境/工具限制**，不构成产品缺陷，也未做任何代码改动。

---

## 6. 证据清单（`docs/phase5.0/phase-b4-device-acceptance/`）

| 类别 | 文件 |
|---|---|
| 设备事实 | `device-facts.json` |
| 浅色 | `light-00-settings.png`、`light-01-today.png`、`light-02-today-scrolled.png`、`light-03-modal.png`、`light-05-menu-popover.png`、`light-06-today-top.png` |
| 深色 | `dark-00-settings.png`、`dark-01-today.png`、`dark-02-today-scrolled.png`、`dark-03-modal.png` |
| 近景 | `closeup-header-{light,dark}.png`、`closeup-tabbar-{light,dark}.png`、`closeup-card-{light,dark}.png`、`closeup-modal-{light,dark}.png`、`closeup-menu-light.png`、`closeup-press-compare.png` |
| ③ 滚动 | `scroll-01-recording.mp4`（13.86MB）、`scroll-frame-0..4.png`、`frames-chrome.txt` |
| ⑥ 按压 | `press-01-recording.mp4`、`press-base.png`、`press-hold-1.png`、`press-hold-2.png`、`press-released.png` |
| ⑧ 亮度 | `brightness-{20,60,100}-dark.png`（三张字节相同，见 §3-⑧） |
| ⑨ 尺寸 | `size-1120px-{light,dark}.png`、`size-1365px-dark.png`、`size-1442px-{light,dark}.png`、`size-landscape-{light,dark}.png`、`font-13-light.png`、`font-15-light.png` |
| 模拟参考（非真机） | `reference-size-matrix.png`、`reference-sizes/*.png` |

---

## 7. 结论与建议（不推进开发）

1. B4 材质在真机上的**非系统级观感项（①②③④⑤⑨尺寸）全部通过**，与模拟侧结论一致；深色未出现发灰/过亮。
2. ⑥⑧ 需你**人工目视**（按住按钮看高光；调亮度看灰/亮表现），材料已备（录屏 + 三档亮度截图）。
3. ⑦ 与 ⑨字体项**必须等 B5 APK**；本报告已提供该机真实 Insets（42dp / 18dp / 35.7dp / 手势导航）供 B5 直接比对。
4. 本轮**未修改任何产品代码、未构建 APK、未提交、未合并 main、未打 Tag、未进入 B5**；设备设置（字体 1.0、分辨率、亮度自动、夜间模式、旋转）已全部恢复原状。

**等待人工验收。**
