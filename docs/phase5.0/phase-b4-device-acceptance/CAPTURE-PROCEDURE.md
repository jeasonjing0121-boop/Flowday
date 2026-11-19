# FlowDay · B4 真机证据采集流程（vivo X200s）

> 目标：在没有 APK 构建的前提下，用**真机 Chrome 打开本机 dev server** 完成**九项中的 8 项**（①–⑥、⑧、⑨）观感验收并留下证据；
> 系统栏适配（第 7 项）在 B5 构建 APK 后补测。
> 代码基线：`5339589`（B4）· 本轮**不修改代码、不构建 APK**。

---

## 1. 一次性准备

```powershell
# 1) PC 上启动前端（若未启动）
cd F:\DeepSeekHarness\FlowDay
npm.cmd run dev

# 2) 手机：设置 → 关于手机 → 连点版本号开启开发者选项 → USB 调试
#    连接 PC，手机上点「允许 USB 调试」

# 3) 确认设备可见
adb devices -l          # 应看到 V2458A  device
```

---

## 2. 一键执行（推荐）

```powershell
cd F:\DeepSeekHarness\FlowDay
powershell -ExecutionPolicy Bypass -File scripts\device-acceptance.ps1 -Action info
```

| Action | 作用 | 产出 |
|---|---|---|
| `info` | 读取设备事实：API Level、WebView 版本、导航模式、字体缩放、屏幕/密度、已装应用、Insets dump | `device-facts.json` |
| `open` | 建立 `adb reverse tcp:5173 tcp:5173` 并打开 Chrome 到 `http://127.0.0.1:5173/today` | — |
| `capture -Name light-01-today` | 对手机当前画面截图并拉回 PC | `light-01-today.png` |
| `record -Name scroll-01-recording -Seconds 15` | 屏幕录制（需你同时手动滚动页面） | `scroll-01-recording.mp4` |
| `frames` | 抓取 Chrome 帧统计（Janky frames 比例） | `frames-chrome.txt` |
| `brightness -Percent 20\|60\|100` | 关闭自动亮度并设置亮度（用于亮度矩阵） | — |
| `theme light\|dark` | 提示操作步骤（主题存在应用内 IndexedDB，脚本不直接改数据） | — |
| `restore` | 恢复自动亮度 | — |

> 脚本只做只读采集与系统亮度设置/恢复，不安装、不卸载、不改动应用数据。

---

## 3. 手工流程（脚本不可用时）

### 3.1 打开页面

```powershell
adb reverse tcp:5173 tcp:5173
adb shell am start -a android.intent.action.VIEW -d "http://127.0.0.1:5173/today" com.android.chrome
```

> 若 Chrome 提示"无法访问"，确认 `adb reverse --list` 含 `tcp:5173`；也可改用
> `adb shell am start -a android.intent.action.VIEW -d "http://<PC 局域网 IP>:5173/today"`（需同一 Wi-Fi）。

### 3.2 截图（三类，全部要）

```powershell
# 全屏截图
adb exec-out screencap -p > "docs\phase5.0\phase-b4-device-acceptance\light-01-today.png"

# 需要"近景"时：先截全屏，再用图片工具裁切并放大 2 倍，命名 *-closeup.png
```

### 3.3 滚动动态录屏（第 ③ 项）

```powershell
# 开始录制（最长 180s），期间在手机上缓慢上下滚动首页 3 次
adb shell screenrecord --bit-rate 8M --time-limit 15 /sdcard/fd-scroll.mp4
adb pull /sdcard/fd-scroll.mp4 "docs\phase5.0\phase-b4-device-acceptance\scroll-01-recording.mp4"
adb shell rm /sdcard/fd-scroll.mp4
```

### 3.4 帧率 / 卡顿（第 ③ 项补充）

```powershell
# Chrome 渲染进程帧统计（真机、真实 GPU）
adb shell dumpsys gfxinfo com.android.chrome framestats > "docs\phase5.0\phase-b4-device-acceptance\frames-chrome.txt"
```
判读：文件末尾 `Janky frames: xx (xx%)`；**目标 Janky < 5%**。B5 用 APK 时同理：
`adb shell dumpsys gfxinfo app.flowday.beta framestats`。

需要更细的逐帧时间线时（可选）：
```powershell
adb shell atrace gfx view --buffer_size 16384 -a com.android.chrome -t 10 > trace.out
```

### 3.5 亮度矩阵（第 ⑧ 项）

```powershell
adb shell settings put system screen_brightness_mode 0        # 关闭自动亮度
adb shell settings put system screen_brightness 51            # 20%
adb shell settings put system screen_brightness 153           # 60%
adb shell settings put system screen_brightness 255           # 100%
adb shell settings put system screen_brightness_mode 1        # 结束后恢复自动
```
> 每档亮度各截浅色/深色一张，命名 `brightness-<档>-<主题>.png`。

### 3.6 主题切换

应用主题保存在应用内 IndexedDB（无 URL 参数）。操作路径：
**设置 → 外观 → 深色/浅色**（或右上角账户菜单 → 切换到深色）。
切换后等待 1s 再截图，确认真实渲染（非过渡中间帧）。

### 3.7 系统字体 130% / 150%（第 ⑨ 项）

```powershell
adb shell settings put system font_scale 1.3   # 130%
adb shell settings put system font_scale 1.5   # 150%
adb shell settings put system font_scale 1.0   # 恢复
```
> 修改后需重启 Chrome 页面（或应用）才完全生效；采集完务必恢复 `1.0`。

---

## 4. 证据命名与存放

全部放入 `docs/phase5.0/phase-b4-device-acceptance/`，命名见 `DEVICE-ACCEPTANCE-CHECKLIST.md` §1。

| 类别 | 文件 |
|---|---|
| 设备事实 | `device-facts.json` |
| 浅色 | `light-01-today.png`、`light-02-tabbar-closeup.png`、`light-03-header-closeup.png` |
| 深色 | `dark-01-today.png`、`dark-02-tabbar-closeup.png`、`dark-03-modal.png` |
| 滚动 | `scroll-01-recording.mp4`、`scroll-02-frame-a.png`、`scroll-03-frame-b.png`、`frames-chrome.txt` |
| 材质 | `material-01-modal.png`、`material-02-card.png`、`material-03-buttons.png` |
| 按压 | `press-01-active.png`、`press-02-released.png` |
| 亮度 | `brightness-{20,60,100}-{light,dark}.png` |
| 尺寸 | `size-{today-light,today-dark,tasks-light,settings-dark,landscape,font130,font150}.png` |
| 系统栏（B5） | `system-01..04-*.png` |

---

## 5. 与模拟证据的对应关系（便于横向比对）

| 真机项 | 模拟参考（已在库） |
|---|---|
| 浅色边缘/厚度 | `phase-b4-evidence/v3-light-closeup-tabbar.png`、`v3-light-closeup-header.png` |
| 深色镜面 | `phase-b4-evidence/v3-dark-closeup-tabbar.png`、`v3-dark-desktop-today.png` |
| 滚动高光 | `phase-b4-evidence/scroll-specular.gif`、`compare/compare-scroll-frames.png` |
| 底栏层次 | `phase-b4-evidence/compare/compare-tabbar-{light,dark}.png` |
| 材质统一 | `compare/compare-modal-light.png`、`v3-light-closeup-card.png` |
| 按压反馈 | `v3-btn-{normal,hover,active}.png` |
| Beta.2 对照 | `phase-b4-evidence/compare/compare-desktop-{light,dark}.png` |

---

## 6. 记录注意事项

1. **同一角度、同一页面、同一亮度**再对比，避免用不同页面比较"亮度/厚度"。
2. 深色观感与屏幕亮度强相关：先按 §3.5 固定亮度再评价。
3. 录屏文件较大（8Mbps×15s ≈ 15MB），提交前可转 GIF 或压到 720p。
4. 若某台设备边缘观感与模拟差异大，记录**机型/系统/WebView 版本 + 截图**，作为 B5 调参依据（不改代码，仅记录）。
