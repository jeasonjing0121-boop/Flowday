# FlowDay Beta.2 · Android 原生适配报告

> 版本 `5.0-a-beta.2`（versionCode 2）· applicationId `app.flowday.beta`（未变）· 签名密钥与 Beta.1 相同（证书 SHA-256 `B5:6B:30:48:…:56:BA:77`）
> 原则：**系统区域由原生负责，WebView 只负责自身布局**——不用 CSS 伪造状态栏。

---

## 1. 适配项与实现

| # | 适配项 | 实现 | 位置 |
|---|---|---|---|
| 1 | **Edge-to-Edge** | `WindowCompat.setDecorFitsSystemWindows(window, false)`；内容延伸到状态栏与手势条之下 | `MainActivity.onCreate` |
| 2 | **透明系统栏** | `statusBarColor/navigationBarColor = TRANSPARENT`；API 29+ 关闭 `*ContrastEnforced`、`navigationBarDividerColor = TRANSPARENT` | 同上 |
| 3 | **WindowInsets 分发** | `ViewCompat.setOnApplyWindowInsetsListener` 取 `systemBars() | displayCutout() | ime()`，换算 dp 后 `evaluateJavascript("window.__lgApplyInsets({...})")` 写入 `--lg-safe-top/bottom/left/right` 与 `--lg-ime` | `dispatchInsets()` |
| 4 | **状态栏** | 图标明暗跟随应用主题（非系统主题）：`FlowDayNative.setDark(bool)` 原生桥 → `setAppearanceLightStatusBars(!dark)` | `FlowDayBridge` + `applyBarAppearance()` |
| 5 | **系统导航栏** | 同上 `setAppearanceLightNavigationBars`；手势条区域由 `--lg-safe-bottom` 避让 | 同上 |
| 6 | **刘海/挖孔** | `displayCutout()` insets 并入安全区；横屏时 `--lg-safe-left/right` 生效 | 同上 |
| 7 | **手势导航** | 底部胶囊 `bottom: calc(safe-bottom + 12px)`；主内容 `padding-bottom: calc(96px + safe-bottom)` | `styles.liquid-glass.css` |
| 8 | **Android 返回键** | 沿用 Capacitor `BridgeActivity`：WebView 有历史 → 后退，否则退出；`BrowserRouter` 的 `pushState` 与 WebView 历史天然一致；**未开启** `enableOnBackInvokedCallback`（Capacitor 未注册回调时会导致直接退出） | `AndroidManifest` 决策说明 |
| 9 | **软键盘** | `android:windowSoftInputMode="adjustResize"`；键盘弹出时 `--lg-ime` 抬升底部胶囊并降低其不透明度，输入框随视口压缩可滚动到可见 | Manifest + `--lg-ime` |
| 10 | **安全区域** | 原生优先（Insets），Web 回退 `env(safe-area-inset-*)`；`--lg-safe-*` 全站单一口径 | `liquidGlass.ts` |
| 11 | **深浅主题** | Web 主题 → `data-theme`；`--lg-lum` 驱动材质明暗；同时同步原生系统栏图标 | `installLiquidGlass` |
| 12 | **WebView 缩放关闭** | `setSupportZoom(false)`、`setBuiltInZoomControls(false)`、`setDisplayZoomControls(false)`；`setUseWideViewPort(true)`、`setLoadWithOverviewMode(false)`；**未设置 `textZoom`**，保留系统字体/显示大小辅助功能 | `MainActivity` |
| 13 | **移动端响应式** | 320/360/375/390/412/432 六档实测无横向溢出；网格 `minmax(0,1fr)`；不使用整页 `transform: scale()` | 证据见 `lg-evidence/after` |

## 2. 原生 ↔ Web 契约

```
Web → 原生：window.FlowDayNative.setDark(bool)          // 主题变化时更新系统栏图标
原生 → Web：window.__lgApplyInsets({top,bottom,left,right,imeBottom})  // 单位 dp(CSS px)
```
- 原生桥仅暴露 1 个方法（最小攻击面），无文件/网络/存储能力。
- Insets 分发带去重（仅在变化时调用），避免频繁 JS 调用。
- 若桥不存在（Web/桌面），`liquidGlass.ts` 静默降级到 `env()`，不影响 Web 端。

## 3. 与 Liquid Glass 的协同

- 玻璃头部/底栏通过 `--lg-safe-top/bottom` **让位**系统栏，而不是给 WebView 加外框；系统栏区域是真正的原生透明区域，能看到内容滚动。
- 状态栏图标颜色由**应用主题**决定（Beta 有独立深浅色设置），避免"浅色应用 + 白色图标"不可读。
- 键盘弹出：视口收缩（adjustResize）+ 胶囊抬升，二者不叠加冲突（`--lg-ime` 与 `safe-bottom` 相加但 WebView 已收缩时 `ime` insets 归零）。

## 4. 权限与隐私（未变）

`INTERNET` + androidx 自动生成的 `app.flowday.beta.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`（normal 级）。无存储/位置/通讯录/相机/通知权限；无第三方 SDK。

## 5. 真机验证状态（必须如实告知）

**未执行且本机无法执行**：
- `adb devices` 无设备；
- CPU 虚拟化固件关闭（`VirtualizationFirmwareEnabled=False`、SLAT=False）→ 无法启动 Android 模拟器；按授权未安装 emulator/system-image。

因此以下项**必须由测试用户在真机复核**（已写入 BETA-TEST-PLAN 的 Android 组）：
1. 状态栏/手势条是否遮挡内容、玻璃头部在滚动时是否覆盖状态栏文字；
2. 深色主题下系统栏图标是否可读；
3. 软键盘弹出时编辑弹窗的保存按钮是否可见；
4. 双指缩放是否被禁用、系统字体调大后布局是否仍可用；
5. 真机滚动/动画流畅度（本机只有 Chromium 合成层实测数据）。

已通过静态手段完成的验证：签名/包信息/资源完整性/权限、Web 层 6 档宽度无溢出、42 个对比度探针、91+35 等 E2E 全绿、滚动 p95 16.7ms。
