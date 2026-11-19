# FlowDay · B4 真机验收清单（vivo X200s / V2458A）

> **状态：B4 最终验收已通过（2026-11-19）**。本清单保留为验收过程记录。
> 最终验收 SHA：`5339589f0577fa0fd0a70476fa19ead7001fe27a`
> 说明：⑧ 屏幕亮度适应已由验收人在真机上人工检查通过；⑦ Insets 与 ⑨ 字体缩放转入 B5。

> 目的：把 B4 的"技术实现"翻译成**可人工判定的观感标准**，并规定证据文件命名，便于逐项打勾。
> 设备：vivo X200s（V2458A）· OriginOS 7 · PD2458_A_17.2.13.2.W10.V000L1 · 内核 6.6.127
> 代码基线：`5339589f0577fa0fd0a70476fa19ead7001fe27a`（B4）
> 证据目录：`docs/phase5.0/phase-b4-device-acceptance/`（真机文件按 §命名 存放）

---

## 0. 前置说明（必须先读）

| 采集方式 | 能验证什么 | 不能验证什么 |
|---|---|---|
| **真机 Chrome 打开 dev server**（`adb reverse`） | 玻璃观感、边缘/厚度、镜面高光、按压反馈、遮罩与模糊、色准（真实屏幕） | **系统状态栏/导航栏安全区**（浏览器自身 UI）、APK 内的 WebView 性能特征、edge-to-edge |
| **真机安装 APK 验证** | 上述全部 + 系统栏适配 + WebView 帧率 | ——（需 B5 构建后执行） |

因此本清单第 **7 项（系统栏/安全区）**在仅有 Chrome 的情况下标注为「待 B5 APK 复核」，其余 7 项可用 Chrome 完成初判。

> 采集环境要求：设备与 PC 同一台机器 USB 连接、授权 USB 调试；PC 端 `npm run dev` 已启动（5173）。

---

## 1. 逐项验收判据与证据命名

### ① 浅色模式：玻璃边缘清晰、有厚度感

| 项 | 内容 |
|---|---|
| 观察对象 | 顶部导航栏、底部导航栏、弹窗面板、卡片 |
| **通过判据** | 能在**白色背景**上清楚看到玻璃的**深色外轮廓**（约 1px 暗线）与其**内侧亮线**；靠近边缘有 8–12px 的"厚度带"（亮度过渡）；不是"白底上糊一层白" |
| 不通过表现 | 边缘看不见 / 只有一圈白边 / 整块均匀发白 |
| 证据名 | `light-01-today.png`、`light-02-tabbar-closeup.png`、`light-03-header-closeup.png` |
| 参考基准（模拟） | `docs/phase5.0/phase-b4-evidence/v3-light-desktop-today.png`、`v3-light-closeup-tabbar.png` |

### ② 深色模式：镜面反射自然，不过亮/发灰

| 项 | 内容 |
|---|---|
| 观察对象 | 深色下的导航栏/弹窗/卡片 |
| **通过判据** | 玻璃呈"深色半透明"而非灰白塑料；顶部有一条柔和高光带且不刺眼；文字/图标清晰；边缘有亮边定形 |
| 不通过表现 | 整块发灰、发白、像磨砂塑料；高光过亮形成"白条" |
| 证据名 | `dark-01-today.png`、`dark-02-tabbar-closeup.png`、`dark-03-modal.png` |
| 参考基准 | `v3-dark-desktop-today.png`、`v3-dark-closeup-tabbar.png` |

### ③ 滚动时镜面高光自然移动、无闪烁/跳动

| 项 | 内容 |
|---|---|
| 操作 | 在首页缓慢上下滚动 3 次（幅度 > 一屏） |
| **通过判据** | 高光在玻璃边缘**平滑平移**（水平 ±8px、垂直 −3px 量级），无闪烁、无逐帧跳动、无重影；导航栏不抖动 |
| 不通过表现 | 高光"跳变"、边缘出现闪白、滚动中玻璃边缘抖动 |
| 证据名 | `scroll-01-recording.mp4`（屏幕录制 10–15s）+ `scroll-02-frame-a.png` / `scroll-03-frame-b.png`（滚动两端帧） |
| 参考基准 | `docs/phase5.0/phase-b4-evidence/scroll-specular.gif`（12 帧） |

### ④ 底部导航栏：明显的液态玻璃层次（非普通磨砂）

| 项 | 内容 |
|---|---|
| **通过判据** | 底栏有：外暗边 + 内亮边 + 底部环境染色 + 选中项"小玻璃胶囊"（自身有双边缘与镜面）；与页面内容之间有明确前后层次（内容从下方滚过） |
| 不通过表现 | 与普通毛玻璃面板无差别；选中项只是一块纯色方块 |
| 证据名 | `tabbar-01-closeup.png`（建议系统截图后裁切，或用脚本 `-Action capture` 后会给出原图） |
| 参考基准 | `compare/compare-tabbar-light.png`、`compare/compare-tabbar-dark.png` |

### ⑤ 弹窗 / 卡片 / 按钮材质语言统一

| 项 | 内容 |
|---|---|
| **通过判据** | 四者都能看到同一套语言：双边缘（外暗内亮）、同方向的顶部高光、同样的边缘厚度感；卡片是"更实的内容材质"但不违和；按钮高光方向一致 |
| 不通过表现 | 各组件各一套玻璃，深浅/厚度/高光方向不一致 |
| 证据名 | `material-01-modal.png`、`material-02-card.png`、`material-03-buttons.png` |
| 参考基准 | `compare/compare-modal-light.png`、`v3-light-closeup-card.png`、`compare/compare-button-states.png` |

### ⑥ 按压按钮：自然的光学反馈

| 项 | 内容 |
|---|---|
| 操作 | 按住「添加任务 / 新建任务 / 导航项 / 习惯打卡」各 3 次，长短按各一次 |
| **通过判据** | 按下瞬间高光增强、轻微内缩，松手自然回落；**无卡顿、无延迟感**；连续快速点击不出现残影 |
| 不通过表现 | 按下无变化 / 变化突兀 / 点击响应变慢 |
| 证据名 | `press-01-active.png`、`press-02-released.png`（或录屏 `press-03-recording.mp4`） |
| 参考基准 | `v3-btn-normal.png` / `v3-btn-hover.png` / `v3-btn-active.png` |

### ⑦ 状态栏 / 系统导航栏 / 安全区（**待 B5 APK**）

| 项 | 内容 |
|---|---|
| 操作 | 使用 APK（B5 构建后）：浅色/深色各一次；三键与手势各一次；横屏一次 |
| **通过判据** | 状态栏时间/电量不被玻璃遮挡；底部手势条不压住应用底栏；横屏左右安全区生效；键盘弹出时底栏滑出、弹窗 footer 可见（B3 能力） |
| Chrome 阶段 | 记录浏览器自身 UI 造成的偏移即可，**不作为通过依据** |
| 证据名 | `system-01-light-status.png`、`system-02-dark-status.png`、`system-03-gesture-nav.png`、`system-04-landscape.png` |

### ⑧ 不同屏幕亮度下的观感

| 项 | 内容 |
|---|---|
| 操作 | 系统亮度分别设为 **20% / 60% / 100%**（关闭自动亮度），浅色与深色各拍一组 |
| **通过判据** | 低亮度下深色玻璃不发灰、文字仍清晰；高亮度下浅色玻璃边缘仍可见、不刺眼；三个亮度下层级关系一致 |
| 证据名 | `brightness-20-light.png`、`brightness-60-light.png`、`brightness-100-light.png`、`brightness-*-dark.png` |

---

### ⑨ 页面尺寸适配（真机）

| 场景 | 证据名 | 判据 |
|---|---|---|
| 首页完整页（浅/深） | `size-today-light.png` / `size-today-dark.png` | 一屏可见主体；底栏不遮挡末条内容（B2 能力） |
| 任务页（长列表） | `size-tasks-light.png` | 长列表滚动流畅，玻璃不抖动 |
| 设置页 | `size-settings-dark.png` | 控件材质与卡片一致 |
| 横屏 | `size-landscape.png` | 无横向滚动条，底栏与内容不重叠 |
| 字体 130% / 150%（系统设置） | `size-font130.png` / `size-font150.png` | 无截断、底栏不遮挡末条（B2/B3 能力） |

---

## 3. 逐项证据记录模板（每项复制一份填写）

```markdown
### 项目 <①–⑨>：<名称>
- 测试环境：vivo X200s / V2458A · OriginOS 7 · Android API <脚本读取> · WebView <脚本读取>
              导航方式 <手势|三键> · 系统字体 <100%/130%/150%> · 屏幕亮度 <20/60/100>% · 主题 <浅色|深色>
              采集方式 <Chrome+adb reverse |（⑦）APK> · 采集时间 <yyyy-mm-dd hh:mm>
- 实际结果：<客观描述看到的现象，含边缘/厚度/高光/层次等可核对细节>
- 证据：<文件名>（截图/录屏）
- 判定：<通过 | 不通过 | 待 B5 APK（仅 ⑦）>
- 未通过问题与复现方式：<问题描述 + 复现步骤；通过则写“无”>
```

> 判定纪律：⑦ 在 Chrome 阶段只能记录"浏览器 UI 偏移"，**不得判通过**；⑨ 的字体/横屏项如因浏览器 UI 影响无法判定，同样标注待 APK。

---

## 4. 打勾表（人工验收时填写）

| # | 项目 | 结果 | 证据文件 | 备注 |
|---|---|---|---|---|
| ① | 浅色边缘与厚度 | **通过** | `light-06-today-top.png`、`closeup-header-light.png`、`closeup-tabbar-light.png` | 边缘 ΔL：外 −0.360/−0.565、内 +0.473/+0.306 |
| ② | 深色镜面自然 | **通过** | `dark-01-today.png`、`closeup-tabbar-dark.png` | ΔL：外 −0.278、内 +0.293；无发灰/过亮 |
| ③ | 滚动高光平滑 | **通过** | `scroll-01-recording.mp4`、`frames-chrome.txt` | Janky 1.02%（29/2840），50th 14ms；截图无法分离 ±8px 位移 |
| ④ | 底栏液态层次 | **通过** | `closeup-tabbar-{light,dark}.png` | 外暗边+内亮边+环境染色+选中胶囊 |
| ⑤ | 材质语言统一 | **通过** | `closeup-modal-*.png`、`closeup-menu-light.png`、`closeup-card-*.png` | 双边缘与高光方向一致 |
| ⑥ | 按压光学反馈 | **通过（真机客观测量）** | `press-03-recording.mp4`、`press-fab-{baseline,pressed,released}.png` | 缩放 −8.7%、下缘 +3.75 L、松手完全复位、<200ms 收敛；由注入真实 MotionEvent 产生，建议手指复核 |
| ⑦ | 系统栏/安全区 | **待 B5 APK** | `device-facts.json`（Insets 42dp/18dp/35.7dp） | Chrome 阶段不判定 |
| ⑧ | 亮度 20/60/100% | **待人工目视** | `brightness-{20,60,100}-dark.png` | 三张字节相同：screencap 不含背光；观察单见补充报告 §2.2 |
| ⑨ | 页面尺寸适配 | **尺寸 5/5 通过；字体待 APK** | `size-*.png`、`font-13/15-light.png` | 320/360/390/412dp + 横屏通过；浏览器不随系统字体缩放 |

> 真机结论详见 `docs/phase5.0/PHASE-B4-DEVICE-ACCEPTANCE-REPORT.md`；⑥⑧ 补充测量与边缘尺寸见 `docs/phase5.0/PHASE-B4-FINAL-SUPPLEMENT.md`。
