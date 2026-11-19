# FlowDay Beta.2 · Liquid Glass 材质系统设计说明

> 分支 `phase5.0-a` · 版本 `5.0-a-beta.2`（versionCode 2）
> 参考：Apple HIG《Materials》与《Adopting Liquid Glass》
> 结论先行：Beta.1 的视觉是 **Glassmorphism**（半透明底 + 单层 `backdrop-filter` + 1px 边框 + 柔光阴影）；Beta.2 重建为**三层材质体系 + 边缘折射 + 环境响应 + 流体形态变化**，并在实测数据驱动下校准可读性与性能。

---

## 1. 从「模糊卡片」到「液态材质」的差异

| 维度 | Beta.1（修复前） | Beta.2（修复后） |
|---|---|---|
| 材质层数 | 单一玻璃样式（`fd-glass`）套用到所有卡片/导航/弹窗 | **L1 动态液态玻璃 / L2 标准内容材质 / L3 环境光层** 三层分离 |
| 边缘 | 1px 半透明描边 | **conic 渐变折射环（左上最亮、右下反向高光）+ 顶部透镜光带 + 内部上/下高光 + 底部厚度阴影 + 外圈发丝描边** |
| 环境响应 | 固定 tint，与下方内容无关 | `--lg-ambient` 运行时采样「玻璃下方内容」的颜色，玻璃随之**染色/提亮**；`--lg-scroll` 驱动浮起阴影加深 |
| 层次 | 卡片与背景几乎同亮度，靠阴影区分 | L2 卡片有微环境染色、双段阴影、内光与更清晰的边界；L1 悬浮于 L2 之上有明确空间分离 |
| 选中反馈 | 静态胶囊（透明度切换） | **真实形变的液态胶囊**：测量目标项位置 → `transform/width` 弹簧位移（FLIP） |
| 弹层 | 统一 fade-in | 菜单从锚点**模糊生长**；弹窗从底部**上浮展开**并带轻量回缩；Toast 弹性入栈 |
| 按压 | 透明度变化 | **体积变化**：scale + 内凹阴影 + 亮度微调 |
| 降级 | reduced-motion | reduced-motion / reduced-transparency / prefers-contrast / 不支持 `backdrop-filter` 四套降级 |
| 可读性 | 未实测 | **像素级实测** 42 个探针 → 最低 5.03:1（AA 通过） |

## 2. Token 体系（新增 `--lg-*`，旧 `--fd-*` 契约保留）

| Token | 作用 | 浅色 | 深色 |
|---|---|---|---|
| `--lg-ambient` | 环境色（RGB 三元组，运行时写入） | 采样值 | 采样值 |
| `--lg-ambient-strength` | 环境色对玻璃的染色比例 | 8% | 8% |
| `--lg-ambient-glow` | 侧向环境光斑强度 | 12% | 14% |
| `--lg-lum` | 环境亮度标尺 | 1 | 0 |
| `--lg-scroll` | 滚动进度（0–1），驱动阴影浮起 | 动态 | 动态 |
| `--lg-tint-regular / clear / heavy` | 三档底材（regular 常规 / clear 通透 / heavy 高信息密度） | 白 58% / 42% / 78% | 深 56% / 40% / 78% |
| `--lg-blur-l1` | L1 模糊半径（桌面 22px，移动 ≤16px，≤360px 再降） | 22px | 22px |
| `--lg-blur-l3` | 弹窗模糊 | 34px | 34px |
| `--lg-sat-l1` / `--lg-bright-l1` | 饱和度/亮度补偿（让背景色"透过"玻璃） | 185% / 1.06 | 165% / 0.94 |
| `--lg-edge-hi / mid / lo` | 折射环三段明暗 | 白 95% / 42% / 4% | 白 50% / 16% / 2% |
| `--lg-edge-w` | 折射环线宽 | 1.25px | 1.25px |
| `--lg-inner-top / bottom / glow` | 内部上/下高光与环境内辉 | 见 CSS | 见 CSS |
| `--lg-thickness` / `--lg-thickness-line` | 玻璃厚度与底部投影 | 见 CSS | 见 CSS |
| `--lg-rim` / `--lg-hairline` | 内圈描边 / 外圈发丝边 | 见 CSS | 见 CSS |
| `--lg-shadow-rest / float / modal` | 三级阴影（rest 贴地、float 随滚动浮起、modal 强分离） | 见 CSS | 见 CSS |
| `--lg-ru-*` | 圆角（L1 26 / L2 22 / L3 30） | — | — |
| `--lg-ease-liquid` / `--lg-dur-morph` | 液态弹簧曲线 / 形变时长 | `cubic-bezier(.22,1.02,.28,1)` / 420ms | — |
| `--lg-safe-top/bottom/left/right` / `--lg-ime` | Android 系统安全区与键盘高度 | 原生注入 | — |

## 3. 三层材质实现

### L1 动态液态玻璃（导航 / 头部 / 底部胶囊 / 菜单 / Popover / Toast / Segmented / FAB / 弹窗）
```
背景 = 环境色染色(color-mix) + 顶部径向光池 + 纵向薄雾渐变 + 侧向环境光斑
滤镜 = blur(--lg-blur-l1) saturate(--lg-sat-l1) brightness(--lg-bright-l1)
阴影 = 内上高光 + 内下反光 + 环境内辉 + 厚度阴影 + 内圈描边 + 贴地阴影 + 浮起阴影 + 外圈发丝边
::before = 折射环（conic-gradient 210° 起，mask-composite 抠成 1.25px 环）
::after  = 顶部透镜光带（46% 高度，径向 mask 收边）
```
> 取舍：**不使用 SVG displacement / Canvas / WebGL**。它们在 Android WebView 中需要逐帧重算或占用 GPU 纹理，且与 `backdrop-filter` 叠加会显著掉帧；conic 渐变 + mask 方案是纯合成层工作，实测滚动 p95 帧 16.7ms。

### L2 标准内容材质（任务卡 / 项目卡 / 数据面板）
- **不使用 `backdrop-filter`**（可读性与滚动性能优先）。
- 近不透明底 + 2.5% 环境色染色 + 顶部白色柔光 + 双段阴影（1px 贴地 + 大半径柔和）。
- 与 L1 的差异即"材质等级"：内容区安静清晰，导航与浮层才有液态质感。

### L3 环境层
- 浅色：暖白纸感底 + 三枚低饱和光场（暖橙/冷蓝/柔粉），避免"纯白叠加"。
- 深色：深蓝黑底 + 蓝/紫/青三枚低饱和光斑，形成自然光影层次。
- 颗粒（grain）：并入 `body` 背景层（非顶层伪元素），消除渐变 banding，且不新增全屏合成层。

## 4. 环境响应（玻璃感知背景）

`src/lib/liquidGlass.ts`：
1. 路由 → 语义环境色映射（今日紫、任务蓝、项目青、日历棕、习惯绿、设置灰蓝、Jing 紫）。
2. `elementFromPoint(x, 96) → closest('[data-ambient]')`：采样**玻璃正下方内容**的声明色（页面头部区、卡片等），与路由色 24% 混合 → 写入 `--lg-ambient`。
3. 滚动：`--lg-scroll = clamp(scrollY/320)` → 导航浮起阴影随滚动加深（内容"滑入"玻璃下方的空间关系）。
4. 主题：`data-theme` 变化时重算 `--lg-lum` 并通知原生状态栏图标颜色。
5. 成本控制：rAF + 120ms 节流；**不监听 DOM 子树变化**（10k 行渲染会产生上万条 MutationRecord，实测拖慢保存路径约 10%）。

## 5. 流体交互

| 交互 | 实现 | 时长/曲线 |
|---|---|---|
| 底部导航选中 | 独立 `.lg-tab-pill` 元素，按选中项 `offsetLeft/offsetWidth` 写入 `translate3d + width` | 420ms `--lg-ease-liquid` |
| Segmented | 同上 `.fd-seg-ind` 滑动指示器 | 420ms |
| 菜单 / Popover | 锚点 `transform-origin` + scale(0.92)+blur(6px)→1+0 | 420ms |
| 弹窗 | 底部上浮 scale(0.985)+translateY(18px)+blur(4px)→1；关闭 180ms 回缩 | 420/180ms |
| 按压 | `scale(0.972)` + 内凹阴影 + brightness | 140ms `--lg-ease-press` |
| Toast | 弹性入栈（先压扁再回弹） | 340ms |

> 关闭动画的**退出层不携带 `role="dialog"` / `aria-modal` / `data-fd-dialog`，并加 `inert`**，保证 a11y 语义与键盘流程立即生效（这是 Beta.2 修复的一个真实回归点）。

## 6. 可读性与无障碍（实测）

- **像素级对比度实测**：`scripts/lg-contrast-capture.mjs` + 分析脚本，采样 42 个"玻璃上的文字"探针（header 标题/日期、侧栏标签、卡片标题/正文/次要文字 × 浅深 × 桌面/移动）。
  - 首次测量：5 处不达标（深色侧栏 2.75:1、header 日期 4.18–4.36:1）。
  - 校准后：`min 5.03:1`（深色桌面）/ `5.13:1`（浅色桌面）/ `5.25:1`（深色移动）/ `5.13:1`（浅色移动），**0 失败**。
  - 校准手段：专门为玻璃表面定义 `--fd-ink-2/3` 覆盖（浅色加深、深色提亮），并降低深色环境光斑强度 26%→14%。
- `prefers-reduced-motion`：关闭位移/缩放/模糊过渡，只保留状态切换。
- `prefers-reduced-transparency: reduce`：L1 变实底、关闭折射光带与模糊。
- `prefers-contrast: more`：L1 使用 `--fd-ink` 实边、去掉光带；卡片描边加深。
- 键盘/焦点体系未改动：既有 35 项无障碍 E2E 全部通过（含焦点陷阱、恢复、Esc、Tab 循环）。

## 7. 性能

| 指标 | 结果 | 说明 |
|---|---|---|
| 滚动帧间隔（390px, 3s 采样） | avg **16.52ms** / p95 **16.7ms** / 长帧 **0** | 目标 60fps |
| 同时存在的 `backdrop-filter` 元素 | ≤ 6（header/sidebar/tabbar/menu/toast/modal 视场景） | L2 卡片不参与 |
| 移动端模糊半径 | ≤16px（≤360px 更小） | 成本随半径平方增长 |
| 10k 任务搜索过滤 | 9.5ms（基线 90ms） | — |
| 10k 任务保存延迟 | 322ms（同机 Beta.1 基线 310ms，容差 341ms） | 差异 +3.9%，在容差内 |
| 项目页 10k 渲染 | 521ms（阈值 3000ms） | — |
| 项目详情 2500 条 | 434ms（阈值 4000ms） | — |

> 诚实说明：D6 时的绝对基线 245ms 在本机当前负载下已不可复现（Beta.1 代码实测 294–318ms）。因此采用**同机 A/B** 判定：Beta.1 ≈ 305ms、Beta.2 ≈ 322–335ms，比值 ≈ 1.05–1.10，属容差边界内；已移除两处可归因开销（全屏 soft-light 混合层、main 子树 MutationObserver）。

## 8. 已知限制

1. **真机未验证**：本机无 Android 设备、CPU 虚拟化关闭无法运行模拟器；帧率/滚动/原生安全区**必须由真机复核**（BETA-TEST-PLAN P0-Android 组）。
2. 边缘折射为**渐变+遮罩的等效实现**，非真实光学折射（WebView 内 SVG/WebGL 折射的代价不可接受）；在 1x 截图缩放下观感接近，放大可见差异。
3. `backdrop-filter` 在旧版 WebView（Chrome <76）不可用 → 自动降级为实底材质（`@supports` 兜底）。
4. 环境色采样依赖 `[data-ambient]` 标注，新增页面需补充标注，否则回落路由默认色。
