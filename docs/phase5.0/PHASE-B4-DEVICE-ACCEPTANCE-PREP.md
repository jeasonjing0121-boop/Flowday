# Phase 5.0-B4 · 真机验收准备报告（修订版 · 九项口径）

> 本轮性质：**代码冻结 + 验收准备**（不含任何视觉设计改动、不构建 APK、不进入 B5）
> 冻结基线：`5339589f0577fa0fd0a70476fa19ead7001fe27a`（HEAD 未变）
> 修订原因：按你的审查意见，(1) 验收项统一为 **九项**并与检查表编号一致；(2) 明确区分 **已跟踪文件 clean / 存在 untracked 文件** 两种状态；(3) ⑦ 系统栏与 Insets **不得**以 Chrome 结果判定通过。

---

## 1. 冻结状态（两种状态分开陈述）

### 1.1 已跟踪文件：**clean**

```text
$ git rev-parse HEAD
5339589f0577fa0fd0a70476fa19ead7001fe27a

$ git diff --stat ; git diff --cached --stat
（均为空）

$ git diff --name-only        → 0 个文件
$ git diff --cached --name-only → 0 个文件
```

`main` = `d6297ab`、标签 `phase4.5-accepted` = `d6297ab`，均未变动；`release/android/` 下仍是 Beta.1 / Beta.2 原包（时间戳未变，**未构建**）。

### 1.2 工作区：**存在 untracked 文件（14 个，均为验收材料）**

```text
$ git status --porcelain -uall
?? docs/phase5.0/PHASE-B4-DEVICE-ACCEPTANCE-PREP.md
?? docs/phase5.0/phase-b4-device-acceptance/CAPTURE-PROCEDURE.md
?? docs/phase5.0/phase-b4-device-acceptance/DEVICE-ACCEPTANCE-CHECKLIST.md
?? docs/phase5.0/phase-b4-device-acceptance/EVIDENCE-SLOTS.md
?? docs/phase5.0/phase-b4-device-acceptance/reference-size-matrix.png
?? docs/phase5.0/phase-b4-device-acceptance/reference-sizes/dark-320x640.png
?? docs/phase5.0/phase-b4-device-acceptance/reference-sizes/dark-360x800.png
?? docs/phase5.0/phase-b4-device-acceptance/reference-sizes/dark-390x844.png
?? docs/phase5.0/phase-b4-device-acceptance/reference-sizes/dark-412x915.png
?? docs/phase5.0/phase-b4-device-acceptance/reference-sizes/light-320x640.png
?? docs/phase5.0/phase-b4-device-acceptance/reference-sizes/light-360x800.png
?? docs/phase5.0/phase-b4-device-acceptance/reference-sizes/light-390x844.png
?? docs/phase5.0/phase-b4-device-acceptance/reference-sizes/light-412x915.png
?? scripts/device-acceptance.ps1
```

| 状态 | 结论 |
|---|---|
| 已跟踪文件 | **0 改动**（产品代码、脚本、文档全部未动） |
| untracked | **14 个**，全部是本次验收准备材料（文档 5 + 参考图 9） |
| 新增提交 | **0 个**（HEAD 仍为 `5339589`，为满足"保留 SHA"要求**刻意不提交**） |

> 说明：`reference-sizes/*.png` 与 `reference-size-matrix.png` 是 **headless 模拟参考图**，仅用于与真机观感"横向比对"，**不是真机证据**，也不会被冒充为真机结果（见 §5 证据纪律）。

---

## 2. 设备状态（如实 · 当前阻塞点）

```text
$ adb devices
List of devices attached
10AF9G1ARE006XS    unauthorized
```

| 项 | 值 |
|---|---|
| 设备已连接 | ✅ 是（序列号 `10AF9G1ARE006XS`） |
| ADB 授权 | ❌ **未授权**（`unauthorized`：手机上尚未点「允许 USB 调试」） |
| 可执行的 adb 命令 | ❌ 无（未授权时所有 shell 命令被拒绝） |
| dev server | ✅ 已启动（`http://127.0.0.1:5173` 返回 200） |
| 采集脚本 | ✅ 已就绪（`scripts/device-acceptance.ps1`） |

**阻塞说明**：设备信息采集与九项真机视觉测试都依赖 adb；在 `unauthorized` 状态下无法执行。
需要你在手机上完成一次授权：**解锁手机 → 弹出"允许 USB 调试吗？"→ 勾选"始终允许"→ 允许**（若没有弹窗：开发者选项 → 撤销 USB 调试授权 → 重新插拔数据线）。

---

## 3. 九项验收（编号与检查表一致；区分"可在 Chrome 判定"与"必须 APK"）

| # | 验收项 | 判定方式 | 当前状态 | 证据位 |
|---|---|---|---|---|
| ① | 浅色模式：边缘清晰、有厚度感 | Chrome + adb reverse | 待采集 | `light-01/02/03-*.png` |
| ② | 深色模式：镜面反射自然、不过亮/发灰 | Chrome + adb reverse | 待采集 | `dark-01/02/03-*.png` |
| ③ | 滚动时镜面高光自然移动、无闪烁/跳动 | Chrome + adb reverse（录屏＋帧统计） | 待采集 | `scroll-01-recording.mp4`、`frames-chrome.txt` |
| ④ | 底部导航液态玻璃层次 | Chrome + adb reverse | 待采集 | `tabbar-*.png` |
| ⑤ | 弹窗/卡片/按钮材质语言统一 | Chrome + adb reverse | 待采集 | `material-01/02/03-*.png` |
| ⑥ | 按压按钮的光学反馈 | Chrome + adb reverse | 待采集 | `press-01/02-*.png` |
| ⑦ | **状态栏 / 系统导航栏 / 安全区** | **仅 B5 APK**（Chrome 阶段只记录浏览器 UI 偏移，**不判定通过**） | **待 B5**（不因本轮任何结果改变） | `system-01..04-*.png` |
| ⑧ | 不同屏幕亮度（20/60/100%）观感 | Chrome + adb reverse（系统亮度可调） | 待采集 | `brightness-*.png` |
| ⑨ | 不同页面尺寸适配（320/360/390/412、横屏、字体 130/150%） | Chrome + adb reverse（字体缩放可用系统设置） | 待采集 | `size-*.png` |

**九项中：8 项（①–⑥、⑧、⑨）可在 Chrome 阶段判定；1 项（⑦）保留待 B5 APK。**

判据细节、不通过表现、记录模板见
`docs/phase5.0/phase-b4-device-acceptance/DEVICE-ACCEPTANCE-CHECKLIST.md`（已含 ①–⑨ 编号、打勾表、逐项记录模板）。

---

## 4. 设备授权后的执行顺序（一条条对应证据位）

```powershell
cd F:\DeepSeekHarness\FlowDay
# 0) 先采集设备事实（API Level / WebView 版本 / 导航模式 / 字体缩放 / 亮度 / Insets dump）
powershell -File scripts\device-acceptance.ps1 -Action info

# 1) 打开页面（adb reverse + Chrome）
powershell -File scripts\device-acceptance.ps1 -Action open

# 2) 浅色：① ② ④ ⑤ ⑥（含近景，截屏后裁切放大 2×）
powershell -File scripts\device-acceptance.ps1 -Action capture -Name light-01-today
# …按清单逐张采集

# 3) 深色：应用内切换后重复
powershell -File scripts\device-acceptance.ps1 -Action theme -Theme dark
powershell -File scripts\device-acceptance.ps1 -Action capture -Name dark-01-today

# 4) ③ 滚动高光：录屏 + 帧统计
powershell -File scripts\device-acceptance.ps1 -Action record -Name scroll-01-recording -Seconds 15
powershell -File scripts\device-acceptance.ps1 -Action frames

# 5) ⑧ 亮度矩阵（每档浅/深各一张）
powershell -File scripts\device-acceptance.ps1 -Action brightness -Percent 20
# …20/60/100 各自截图
powershell -File scripts\device-acceptance.ps1 -Action restore

# 6) ⑨ 尺寸与字体（系统字体 130%/150%，横屏）
# 采集完务必恢复 font_scale 1.0
```

---

## 5. 证据纪律（本轮新增约束）

1. **只认真机证据**：所有截图/录屏必须来自 `10AF9G1ARE006XS`（vivo X200s），文件名与清单一致。
2. **模拟图仅作参考**：`reference-size-matrix.png`、`reference-sizes/*.png`、`phase-b4-evidence/**` 均为 headless 模拟，**不得**写入"真机结果"栏。
3. **每项必须记录**：测试环境（机型/API/WebView/导航方式/字体/亮度/主题/采集方式/时间）、实际结果、证据文件、通过或不通过、未通过问题与复现方式（模板见检查表 §3）。
4. **⑦ 判定纪律**：Chrome 阶段最多写"浏览器 UI 偏移记录"，结论固定为「待 B5 APK」。
5. **不修复、不扩围**：本轮发现任何问题只记录，不改代码、不调样式、不构建 APK、不进入 B5。

---

## 6. 审计补充（55 files 与实际修改清单的差异）

`55 files changed` 是 B4 提交（`5362cff..5339589`）内**全部文件**的口径，不等于"改了 55 个源文件"。

| 分类 | 文件数 | 文本行 | 二进制 |
|---|---|---|---|
| **产品代码 `src/`** | **4** | **+380 / −3** | 0 |
| 测试脚本 `scripts/` | 1（`b4-visual.mjs`） | +241 | 0 |
| 文档 | 1（`PHASE-B4-REPORT.md`） | +179 | 0 |
| B4 证据（图片 + JSON） | **49** | +1675 | 45 |
| 合计 | **55** | **+2475 / −3** | 45 |

校验：`4 + 1 + 1 + 49 = 55` ✅

产品代码明细：

| 文件 | 变更 |
|---|---|
| `src/styles.liquid-glass.v3.css`（新增） | +369 / −0 |
| `src/lib/liquidGlass.ts` | +7 / −1 |
| `src/styles.liquid-glass.css` | +3 / −2 |
| `src/main.tsx` | +1 / −0 |

证据 49 个 = 对比图 7 + v3 截图/近景 18 + 滚动连续帧 12 + 对比度证据 9 + 汇总 JSON 3。

> 本轮（真机验收准备）**没有新增任何提交**；新增的 14 个 untracked 文件不属于上述 55。

---

## 7. 风险与限制

| # | 风险 | 现状 | 处置 |
|---|---|---|---|
| 1 | **ADB 未授权** | 设备已连接但 `unauthorized` | 需手机上点「允许」；授权后我立即执行 §4 |
| 2 | Chrome ≠ WebView | 无 edge-to-edge、无 native Insets、有浏览器工具栏 | ⑦ 固定"待 B5 APK"；⑨ 横屏/字体项若受浏览器 UI 影响也标注待 APK |
| 3 | 真机 GPU 与 headless 差异 | headless 性能数据不代表真机 | ③ 用 `dumpsys gfxinfo` 的 Janky% 作真机结论 |
| 4 | 深色观感受屏幕亮度影响 | 亮度不同结论可能相反 | ⑧ 强制 20/60/100% 分档固定后判读 |
| 5 | 折射为等效模拟 | 真机不会出现背景几何位移 | 已在 B4 报告声明；本轮不宣称"真实折射" |
| 6 | 旧 WebView 降级 | 未知设备 WebView 版本 | `-Action info` 采集版本后记录 |

---

## 8. 结论与下一步

- 冻结保持：HEAD `5339589`、已跟踪文件 0 改动、无提交、无 APK、main/Tag 未动。✅
- 文档已按审查意见修正：**九项统一编号**、**clean/untracked 状态分开陈述**、**⑦ 不得由 Chrome 判定**。✅
- **当前唯一阻塞：手机未授权 USB 调试**，无法采集设备信息与真机证据。

**下一步（需要你操作）**：在手机上允许 USB 调试后告知我，我将立即执行
`-Action info` → `open` → ①–⑥⑧⑨ 逐项采集 → 录屏/帧统计 → 亮度矩阵 → 尺寸/字体矩阵，
然后提交含"每项环境/结果/证据/判定/复现方式"的完整真机报告并停止。
在设备授权前，我不会用任何模拟图代替真机证据，也不会推进 B5。
