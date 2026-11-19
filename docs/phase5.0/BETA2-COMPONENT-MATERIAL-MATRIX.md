# FlowDay Beta.2 · 组件材质变化清单（Component × Material Matrix）

| # | 组件 | 材质层 | 修复前 | 修复后 | 交互变化 |
|---|---|---|---|---|---|
| 1 | **Desktop Sidebar** | L1 regular | 单层 20–26px 模糊 + 1px 描边 + 顶部斜向高光 + 薄片堆叠伪元素 | 环境染色玻璃（8% ambient）+ 折射环（左上亮、右下反光）+ 顶部透镜光带 + 内下反光 + 厚度阴影 + 外发丝边；去掉伪元素薄片（由真实厚度阴影承担） | 选中项改为液态内光块（渐变+内衬高光）；悬停保持原语义 |
| 2 | **Mobile Bottom Nav** | L1 regular | 胶囊玻璃底；选中项自带模糊高亮 | 同源 L1 材质 + **独立液态胶囊元素** `.lg-tab-pill`（径向高光 + 内衬 + 浮起阴影） | 切换 Tab 时胶囊 **真实位移**（transform/width 弹簧 420ms）；按压时胶囊压缩；图标轻微上移放大 |
| 3 | **Header** | L1 regular | 玻璃条 + 顶部反射 | L1 材质 + 随滚动加深的浮起阴影（`--lg-scroll`）+ 安全区偏移（状态栏不遮挡） | 内容滚动时与头部形成空间层次；头像球与 + 按钮为 L1 clear/heavy 变体 |
| 4 | **Modal（任务/项目编辑、导入预览）** | L1 heavy + L3 模糊 | fade+scale 弹入；scrim 模糊 6–8px | 底部上浮展开（blur 4px→0）+ 强分离阴影 + 折射环；scrim 带环境色染色 | 关闭 180ms 回缩；退出层 `inert` + 去除 dialog 语义（a11y 即时生效） |
| 5 | **Dropdown（账户菜单）** | L1 heavy | fade+scale；全屏 scrim 带 10px 模糊 | 从右上锚点模糊生长；轻遮罩（仅压暗，无全屏模糊） | 键盘流不变（↑↓/Home/End/Esc/Tab） |
| 6 | **Toast** | L1 heavy + 语义描边 | 玻璃底 + pop 缩放 | L1 材质 + 语义色收敛描边（success/error/info） | 弹性入栈（压扁→回弹 340ms） |
| 7 | **Segmented Control** | L2 容器 + L1 指示器 | 选中按钮自带底色+描边 | 容器为 sunken 内凹；**滑动指示器** `.fd-seg-ind`（渐变+内衬+描边） | 切换时指示器位移/宽度形变 420ms |
| 8 | **Floating Action（头部 + / 新建任务）** | L1 clear → 桌面为胶囊按钮 | 透明按钮 + 无材质 | 移动端圆形液态浮控件（L1 clear）；桌面为带文字胶囊 | 按压 scale(0.94) 体积反馈 |
| 9 | **Settings Controls** | L2 + L1 | 输入框纯白块；开关默认 | 输入框内凹 + 顶部内光 + 聚焦光晕；开关滑块液态位移与阴影；卡片分层 | 主题切换即时驱动 `--lg-lum` 与原生状态栏图标 |
| 10 | **Dashboard 关键交互** | L2 + L1 | 卡片与背景同亮度；移动端进度卡固定 64px 环导致 320px 溢出 | 卡片：2.5% 环境染色 + 内光 + 双段阴影；时间线条目 `lg-inset` 内凹；移动端进度卡可换行（56px 环 + 弹性文字列） | 卡片按压 0.995 微缩；网格 `minmax(0,1fr)` 修复窄屏溢出 |
| 11 | **页面背景（L3）** | L3 | 3 枚固定低饱和光晕 + 纯色纸底 | 三枚光场 + 双色渐变底 + 颗粒层（并入 body 背景） | 无动画，静态成本 |
| 12 | **任务行 / 项目卡** | L2 | 白卡 + 悬停浅底 | 同 L2 材质；行内无 `backdrop-filter`（长列表性能） | 悬停/按压沿用原语义（`lg-pressable` 微缩） |
| 13 | **确认框（Confirm）** | L1 heavy | 玻璃弹窗 | 同 Modal 的液态材质与上浮动画 | Esc/返回键/焦点循环不变 |
| 14 | **System Chrome（Android）** | 原生 | 默认状态栏/导航栏，WebView 不延伸 | Edge-to-Edge + 透明系统栏 + 图标随主题 + Insets 注入 `--lg-safe-*` | 键盘 `adjustResize`；双指缩放禁用（字号缩放保留） |

## 变更范围（代码）

| 文件 | 变更 |
|---|---|
| `src/styles.liquid-glass.css`（新增，666+ 行） | L1/L2/L3 材质、折射/透镜、交互形变、安全区、降级、可读性校准 |
| `src/lib/liquidGlass.ts`（新增） | 环境采样、光学标尺、Insets 桥、原生外观同步 |
| `src/components/AppShell.tsx` | L1 材质接线、底部导航 FLIP 胶囊、菜单/头像/FAB 变体、安全区框架 |
| `src/components/UI.tsx` | Segmented 滑动指示器、Modal 进入/退出与 ghost 退出层、Toast/Confirm 液态材质 |
| `src/features/today/DashboardPage.tsx` | 320px 溢出修复（grid min-content + 进度卡换行）、`data-ambient` 采样点、内凹列表 |
| `src/main.tsx` | 引入 v2 样式与运行时 |
| `android/.../MainActivity.java` | Edge-to-Edge、Insets 分发、系统栏外观、缩放禁用、原生桥 |
| `android/.../AndroidManifest.xml` | `windowSoftInputMode=adjustResize` |
| `android/app/build.gradle` | versionName `5.0-a-beta.2` / versionCode 2 |
| `scripts/lg-capture.mjs` / `lg-anim-capture.mjs` / `lg-contrast-capture.mjs` | 证据流水线（截图/动画/对比度） |
| `scripts/e2e.mjs` / `perf-5a.mjs` | 断言升级到新材质契约；同机 A/B 性能基线口径 |
