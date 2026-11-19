# Phase 5.0-B · B4 实施报告：Liquid Glass v3 光学材质升级

> 阶段：**B4（已完成，未构建 APK、未合并 main、未打 Tag、未进入 B5）**
> 分支：`phase5.0-a` · 基线：`5362cff2fc3724e7c346381933c56123a3622d21`（B3 验收通过版本）

---

## 1. 修改文件清单

| # | 文件 | 类型 | 修改内容 |
|---|---|---|---|
| 1 | `src/styles.liquid-glass.v3.css` | **新增**（约 330 行） | v3 光学 Token、L1 三层材质重写、折射带、双边缘、动态镜面、卡片边缘语言、按压反馈、三套降级守卫 |
| 2 | `src/lib/liquidGlass.ts` | 前端 | 新增 `--lg-ambient-soft`（环境色按主题去饱和 58% 后写入），供材质染色使用；原始 `--lg-ambient` 仍供折射/边缘使用 |
| 3 | `src/main.tsx` | 前端 | 在 v2 样式之后引入 v3 样式 |
| 4 | `src/styles.liquid-glass.css` | 前端 | 补充 `--lg-ambient-soft` 默认值；**深色玻璃上的文字提亮一档**（`#c9c9d1→#d6d6de`、`#bdbdc6→#ccccd5`）以满足 AA |
| 5 | `scripts/b4-visual.mjs` | 测试 | 新增 B4 视觉证据采集：桌面/移动截屏、导航/头部/卡片/弹窗近景裁切、按钮三态、滚动连续帧、合成层计数 |

**未改动**：组件 DOM 结构、B2 Insets 机制、B3 键盘/弹窗三段式布局、业务逻辑/数据结构/CAS/IndexedDB/备份恢复、PWA 注册。
**未新增 DOM 节点**：所有光学层均由既有元素的 `::before`/`::after` 与多层背景承担（见 §2.3）。

---

## 2. 六项材质改造的技术实现

### 2.1 双边缘轮廓（外暗内亮）

| 层 | 实现 | 浅色 | 深色 |
|---|---|---|---|
| 外侧暗发丝 | `box-shadow: 0 0 0 0.6px …` + `0 0 0 2px …` | `rgba(24,30,46,0.22)` / `0.08` | `rgba(0,0,0,0.7)` / `0.42` |
| 内侧镜面 | `inset 0 1px 0` + `inset 0 0 0 0.75px` | `rgba(255,255,255,0.82)` / `0.38` | `rgba(255,255,255,0.34)` / `0.12` |

> 关键点：浅色主题**靠暗边定形**（白背景上的白色高光不可见，这是 Beta.2 被判定为"普通磨砂"的直接原因）；深色主题靠亮边定形。

### 2.2 折射感（模拟方案 + 局限，必须明确）

**实现**：`.lg-l1::before` 变成宽 10px 的「折射环带」：
1. 环带自身带 `backdrop-filter: blur(2px) saturate(150%) brightness(1.04)`，即**二次采样**环带背后的真实内容（被轻微模糊与提亮 → 边缘内容"变形"的观感）；
2. 环带上叠 conic 渐变（亮 → 冷暗 → 暖 → 暗 → 亮，205° 起），模拟光线沿边缘弯折时的明暗转折；
3. 环带用 `mask-composite: exclude` 抠成环，只有边缘 10px 有光学变化，中间保持清晰。

**局限（不可宣称"真实折射"）**：WebView 没有 displacement map / 真实光学位移能力，无法让背景内容在边缘发生几何扭曲。本方案是「**环带重采样 + 明暗转折 + 厚度阴影**」的等效模拟：观感上接近"厚玻璃边缘"，但不会出现 iOS 那种背景被拉伸的形变。此说明同时写在 CSS 注释与本节。

### 2.3 三层材质（视觉可区分，不是三层白渐变）

| 层 | 承担 | 具体层 |
|---|---|---|
| **外层**：环境反射与镜面高光 | 玻璃表面 | ①左上环境光池（`radial-gradient` 白 0.72→0）②底部环境反光（`--lg-ambient-soft` 18%/12%）③`::after` 镜面带 |
| **中层**：折射与边缘厚度 | 玻璃体积 | ④`::before` 折射环带（含二次采样）⑤内下厚度阴影 `inset 0 -18px 26px -22px` + 边缘内光 |
| **内层**：透光与背景染色 | 玻璃本体 | ⑥`background-color: color-mix(--lg-ambient-soft 12%/9%, 白 58%)`⑦纵向透光渐变（顶薄亮→中通透→底略厚） |

三层在近景截图中可以逐层指认（见 §3 的近景图），不是简单的叠加白透明。

### 2.4 环境染色

- 运行时采样保持不变（B1 审计后建立的 `--lg-ambient`，取自玻璃下方内容色 × 路由色）。
- B4 新增 `--lg-ambient-soft`：与主题基色混合 58%（浅色混白、深色混 `#16161e`），**降低饱和度**避免"彩色塑料"。
- 染色强度：浅色 12%（heavy 14% / clear 10%）、深色 9%；底部环境反光 18%/12%。
- 结果：每块玻璃都有可测的色彩偏移（而非纯白），但文字/图标仍保持在 AA 之上（§5 实测）。

### 2.5 动态镜面高光

- 既有 `--lg-scroll`（B2 建立，0–1）驱动新 Token：
  `--lg-specular-shift = (--lg-scroll − 0.5) × 16px`（区间 **−8px…+8px**）+ 纵向 `--lg-scroll × −3px`。
- 作用于 `.lg-l1::after` 的 `transform`（**合成层动画**，不触发布局/绘制），过渡 `140ms linear` 平滑。
- 高光带左右各内缩 10px，位移区间被约束在元素内部 → 不会撑大文档宽度（§8 记录了本轮因此修掉的一个真实回归）。
- 只有 `header / tabbar / modal` 三个核心组件常驻 `will-change: transform`，其他组件不提升合成层。

### 2.6 按压光学反馈

- `.fd-btn-primary / .fd-btn-soft / .lg-pressable / .fd-nav-item` 新增 `::after` 镜面层：常态 `opacity:0`、`translateY(-2px)`；按下 `opacity:1`、`translateY(0)`（120ms）。
- 主按钮额外 `scale(0.972)` + 内凹阴影，模拟"压进玻璃"的体积变化。
- `prefers-reduced-motion`：`--lg-specular-shift: 0`、关闭位移，只保留透明度变化。
- 不改变点击响应：镜面层 `pointer-events:none`，无额外事件监听。

---

## 3. 浅色 / 深色视觉对比（Beta.2 → v3）

**桌面 · 浅色（左 Beta.2 / 右 v3）**

![桌面浅色对比](phase-b4-evidence/compare/compare-desktop-light.png)

**桌面 · 深色（左 Beta.2 / 右 v3）**

![桌面深色对比](phase-b4-evidence/compare/compare-desktop-dark.png)

**底部导航近景（左 Beta.2 / 右 v3）· 浅色**

![导航浅色对比](phase-b4-evidence/compare/compare-tabbar-light.png)

**底部导航近景 · 深色**

![导航深色对比](phase-b4-evidence/compare/compare-tabbar-dark.png)

**弹窗近景（左 Beta.2 桌面 / 右 v3 移动）**

![弹窗对比](phase-b4-evidence/compare/compare-modal-light.png)

**按钮三态（normal / hover / active）**

![按钮三态](phase-b4-evidence/compare/compare-button-states.png)

其余原图：`v3-{light,dark}-desktop-{today,tasks}.png`、`v3-{light,dark}-closeup-{header,tabbar,card}.png`、`v3-light-closeup-modal.png`、`v3-light-mobile-modal.png`。

---

## 4. 动态效果证据

- **连续帧 GIF**：`docs/phase5.0/phase-b4-evidence/scroll-specular.gif`（12 帧，滚动 0→220px，80ms/帧）。
- **首末帧对照**：`docs/phase5.0/phase-b4-evidence/compare/compare-scroll-frames.png`。
- **可测证据**：滚动到 `--lg-scroll = 0.688` 时，导航与头部的镜面层 transform 为 `matrix(1,0,0,1, 3.008, -2.064)`（即 +3.0px / −2.1px）；滚动到底 `--lg-scroll=1` 时为 `+8px / −3px`。高光随滚动平滑移动，无闪烁（合成层动画）。

---

## 5. 性能与可读性实测

| 指标 | 结果 | 目标 |
|---|---|---|
| 滚动帧间隔（390px，3s 采样，193 帧） | avg **16.56ms** / p95 **16.70ms** / 长帧 **0** | p95 ≤ 20ms ✅ |
| 10k 任务保存延迟 | **350ms**（同机 B2 基线 350ms，容差 385ms） | 无退化 ✅ |
| 移动端 `backdrop-filter` 元素 | **6 个**（头部、底栏、选中项、头像球、FAB、底栏重复项） | 受控 ✅ |
| 二次采样层（`::before` backdrop） | **2 个**（仅底部导航 + 顶部栏；弹窗打开时 +1） | ≤3 ✅ |
| 移动端模糊半径 | L1 ≤ **16px**，折射带 **2px** | ≤16px ✅ |
| 文字对比度（42 探针，像素级实测） | **0 失败**，最低 **4.66:1**（深色桌面侧栏）、浅色 5.13:1 | ≥4.5 ✅ |
| 横向溢出（320/360/390/412） | **0**（B2 验收 67/67 复跑通过） | 0 ✅ |

> 说明：headless 为软件渲染，DPR=2 的全页 `backdrop-filter` 合成会超时；因此全页截图为 DPR=1，近景用 `clip + scale:2`。真机有 GPU，合成成本不同——真机帧率仍待 B5 复核。

---

## 6. 回归结果（B2 / B3 / PWA 及全量）

| 套件 | 结果 |
|---|---|
| **B2 验收（67 项，Insets/响应式）** | **67 / 67** ✅ |
| **B3 验收（99 项，键盘/弹窗）** | **99 / 99** ✅ |
| **PWA `e2e-pwa.mjs`（preview 构建）** | **14 / 14** ✅ |
| 逻辑 `npm test` | **369 / 369** ✅ |
| 主 E2E / 无障碍 / 备份 | 91 / 35 / 14 ✅ |
| 多标签 / 项目 / 撤销 / 引导 / 数据安全 | 29 / 30 / 20 / 16 / 14 ✅ |
| 视觉·溢出 `lg-capture.mjs` | **73 / 73** ✅ |
| 性能 `perf-5a.mjs` | **7 / 7** ✅ |

---

## 7. B4 期间发现并修复的两处真实回归

| # | 问题 | 根因 | 修复 | 证据 |
|---|---|---|---|---|
| 1 | 所有宽度横向溢出 **+11px**（B2 67 项中 11 项失败） | 镜面高光带随 `--lg-scroll` 水平平移 **+24px**，越出玻璃元素边界，撑大文档 `scrollWidth` | 位移改为对称区间 **−8…+8px**，高光带左右各内缩 **10px**，位移被约束在元素内 | 修复前 `sw=401/cw=390` → 修复后 `390/390`；B2 67/67 复跑通过 |
| 2 | 深色玻璃上文字对比度降到 **4.10:1**（不可读） | v3 底部环境反光让深色玻璃变亮（bg≈87,91,106） | 深色染色 11%→9%、底部反光 20%→12%；深色玻璃内文字提亮一档 | 42 探针：修复前 3 失败（最低 4.10）→ 修复后 **0 失败（最低 4.66）** |

---

## 8. 尚未解决的问题与兼容性风险

| # | 问题/风险 | 说明 | 计划 |
|---|---|---|---|
| 1 | **真机未验证** | 无 adb 设备 + B 阶段禁建 APK；所有视觉/帧率均为 headless 模拟 | B5 构建后在 vivo X200s 上复核：近景观感、滚动镜面、按压反馈、深色高光 |
| 2 | 折射为**等效模拟**，非真实光学位移 | WebView 无 displacement 能力；边缘不会出现内容几何扭曲 | 已在 §2.2 明确标注；如需真实折射需 WebGL/Canvas 合成，代价与风险过高，不建议在 Beta 内做 |
| 3 | 二次采样层（`::before` backdrop）在低端设备可能掉帧 | 移动端同时 2 个（底栏+头部） | 已提供 `@supports` 降级与 `prefers-reduced-transparency` 关闭路径；B5 用低端机/旧 WebView 复核 |
| 4 | 深色镜面高光亮度阈值 | 深色 specular 0.5α，强光观感依赖真机屏幕亮度 | B5 真机目视确认，必要时调 `--lg-specular` |
| 5 | 高光位移幅度受限于元素边界（±8px） | 为保证零横向溢出而收窄 | 如需更明显的"流光"，可在后续改用 clip-path 容器内位移（会增加一层裁剪） |
| 6 | `scripts/e2e-final-4.5f.mjs` 在 B2 基线即 19/25 | 历史套件与后续阶段演进不同步 | 未作为门槛；如需要可单独整治 |
| 7 | Liquid Glass 的"环境色采样"仍为路由色 + 内容声明色 | 未做真实像素采样（成本高） | 现有观感已可感知；如需更强，可在 B5 后评估 |

---

## 9. Git

| 项 | 值 |
|---|---|
| 产品代码修改 | 4 个文件（v3 样式新增、liquidGlass、main.tsx、liquid-glass.css） |
| 测试新增 | `scripts/b4-visual.mjs` + `docs/phase5.0/phase-b4-evidence/` |
| 构建 APK / 合并 main / 打 Tag | **均未执行** |
| 基线 | `5362cff2fc3724e7c346381933c56123a3622d21` |
| **B4 提交 SHA** | 见提交结果（`phase5.0-a`） |

**B4 已完成，停止开发，等待人工验收。未进入 B5。**
