# FlowDay 5.0-a Beta（Android APK）构建报告

> 日期：2026-11-18（Asia/Shanghai）
> 分支：`phase5.0-a`（未合并 main；未 push）
> 授权路线：1A（官方源安装 Android 构建环境 + Capacitor 集成 + Release APK）
> 交付物：`release/android/FlowDay-5.0-a-Beta.apk`

---

## 1. 结论摘要

| 项 | 值 |
|---|---|
| APK 路径 | `F:\DeepSeekHarness\FlowDay\release\android\FlowDay-5.0-a-Beta.apk` |
| 大小 | 3,613,161 bytes（3.45 MB） |
| SHA-256 | `5553767a34586dd7697254e0c243d7a9c6d423c0caceb2266697f239afeda095` |
| 签名 | APK Signature Scheme **v2**，证书 SHA-256 `b56b3048…56ba77`（CN=FlowDay Beta，RSA 2048） |
| applicationId | `app.flowday.beta` |
| versionName / versionCode | `5.0-a-beta.1` / `1` |
| 最低 Android | **API 24（Android 7.0）**；target 36 |
| 内嵌 Web commit | `02963d7`（phase5.0-a） |
| 运行方式 | **独立应用**：资源随 APK 打包（`assets/public`），不打开浏览器、不依赖远程服务器 |

---

## 2. 环境检查与缺口处理（如实记录）

### 2.1 初始检查（构建前）

| 项 | 结果 |
|---|---|
| Node / npm | v24.16.0 / 11.13.0 ✓ |
| JDK | 仅发现既有 Temurin **17**（可用但不足，见 2.3） |
| Android SDK / sdkmanager / Gradle / Android Studio | **全部缺失** |
| adb | 存在（33.0.0），**无任何连接设备** |
| 模拟器可行性 | CPU 虚拟化固件关闭（`VirtualizationFirmwareEnabled=False`、SLAT=False）→ **本机无法运行 Android 模拟器**（按授权不安装 emulator） |
| 磁盘 | F: 38.7 GB 可用 ✓ |

### 2.2 网络特性与下载策略

官方源（dl.google.com / services.gradle.org / maven.google.com / Adoptium）长连接被限速至 ~0.02 MB/s，短请求可达 ~0.2–0.5 MB/s。据此采用**1MB 分块串行 + 断点续跑**下载器（`F:\AndroidDownloads\chunked-download.ps1`，仅本次环境使用，未入库），全部包按官方 SHA-1/SHA-256 校验：

| 组件 | 大小 | 校验 |
|---|---|---|
| platform-tools r37.0.3 | 7.8 MB | sha1 ✓ |
| platforms;android-36 (r02) | 62.8 MB | sha1 ✓ |
| build-tools 36.0.0 | 56.0 MB | sha1 ✓ |
| build-tools 35.0.0（`:capacitor-android` 模块固定版本） | 57.1 MB | sha1 ✓ |
| Gradle 8.14.3-all（wrapper 指定版本，预置到 wrapper dists） | 214.2 MB | sha256 ✓ |
| Temurin JDK 21.0.13+9 | 195.9 MB | sha256 ✓（Adoptium 官方 API 元数据） |

未安装 cmdline-tools/sdkmanager（手动部署等价目录 + `licenses/` 接受文件），未安装 emulator（授权明确不装）。

### 2.3 两个关键环境发现

1. **Java 进程写 confinement**：本机 Java（含 javac/keytool/Gradle）仅允许在会话工作区 `F:\DeepSeekHarness\FlowDay` 内写文件（工作区外一律 `AccessDeniedException`；curl/pwsh 不受限）。因此 **SDK、Gradle 用户目录、java.io.tmpdir 全部置于工作区 `.tmp/` 内**（仍位于 F 盘、且被 gitignore）：
   - `ANDROID_HOME = <ws>/.tmp/android-sdk`
   - `GRADLE_USER_HOME = <ws>/.tmp/gradle-home`
   - `java.io.tmpdir / TMP / TEMP = <ws>/.tmp/gradle-tmp`
2. **Capacitor 8 需要 JDK 21**：`:capacitor-android` 以 source release 21 编译，JDK 17 报「无效的源发行版：21」。按「项目兼容 JDK」原则从 **Eclipse Adoptium（Temurin 官方渠道，与本机既有 JDK17 同源）** 安装 JDK 21.0.13+9 至 `F:\AndroidSdk-jdk21`（只读使用，不受写限制影响）。未降级 Capacitor 主版本。

### 2.4 版本兼容矩阵（最终）

| 组件 | 版本 | 依据 |
|---|---|---|
| Capacitor | 8.6.2（latest，未追 dev/9） | engines node ≥22 ✓（Node 24） |
| AGP | 8.13.0 | Capacitor 8 模板固定 |
| Gradle | 8.14.3 | wrapper 固定，未擅自替换 |
| JDK（构建） | Temurin 21.0.13+9 | Capacitor 8 编译要求 |
| compileSdk / targetSdk | 36 | 模板 |
| minSdk | 24 | 模板（Android 7.0+） |
| build-tools | 36.0.0（app）+ 35.0.0（capacitor-android） | 本地部署并在 app 模块固定 36.0.0 |

---

## 3. Capacitor 集成要点

- `capacitor.config.ts`：`appId=app.flowday.beta`、`appName=FlowDay Beta`、`webDir=dist`、`androidScheme=https`、`allowNavigation=[]`（**禁止指向远程网页**）。
- Web 资源随包：`android/app/src/main/assets/public`（14 个文件：index.html、js/css、icons、manifest、sw.js、bench-blank.html）；`index.html` **无任何远程 src/href**。
- **Service Worker 冲突处理**：`registerPwa()` 在原生容器（`window.Capacitor.isNativePlatform()` 或 UA 含 capacitor）内**不注册 SW**，避免与 APK 内资源/原生缓存叠加导致「旧 JS + 新 CSS」混用；Web 端 PWA 行为不变。
- 未引入任何 Capacitor 插件（最小集成）；返回键走 WebView 历史（与 BrowserRouter pushState 天然匹配）。
- 应用身份：图标（legacy + adaptive 渐变前景）、启动页（品牌渐变 + 居中标记）、名称、颜色均替换为 FlowDay 品牌（`tools/gen-android-assets.py` 离线生成）。
- 设置页「关于」显示：渠道（beta）、versionName/versionCode、构建时间、Git commit；「应用」区在原生容器内显示「资源随安装包分发，未启用 Service Worker」。

## 4. 签名与密钥管理

- 独立 Beta keystore：RSA 2048、alias `flowday-beta`、有效期 25 年（保证后续 Beta 更新可沿用）。
- 位置：**仓库外** `F:\AndroidSdk-keystore\`（keystore + `signing.properties`，目录 ACL 仅当前用户）；工作区 `.secrets/` 亦有生成副本（gitignore）。
- 构建经环境变量 `FLOWDAY_SIGNING_PROPS` 注入；**缺失时 release 不配置签名**（脚本不会产出未签名 release）。
- keystore/密码**未进入 Git、未进入日志**；本仓库仅记录公开指纹（见 `SHA256.txt`）。
- 验签：`apksigner verify` → **Verifies**（v2 scheme，1 signer，DN 与指纹匹配）。

## 5. 构建与验证结果

| 步骤 | 结果 |
|---|---|
| `npm run build` | ✓ JS 431.72 kB / gzip 131.29；CSS 53.36 kB |
| `npx cap sync android` | ✓ |
| `gradlew assembleRelease` | ✓ BUILD SUCCESSFUL（8m08s，124 tasks） |
| apksigner verify | ✓ v2，证书匹配 Beta 密钥 |
| aapt2 badging | ✓ 包名/版本/label/launchable/minSdk 正确 |
| APK 内资源完整性 | ✓ index.html、capacitor.config.json、manifest、js/css 均在 |
| 远程依赖抽查 | ✓ index.html 无远程引用；打包 JS 中远程字符串仅为 W3C 命名空间/文档链接常量 |
| 权限清单 | 仅 `INTERNET` + androidx 自动生成的 `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`（normal 级） |
| 逻辑测试 | ✓ 369/369 |
| 既有 E2E（90/14/29/35） | ✓ 全部零回归（构建后复跑） |
| 新增专项 E2E（94 项） | ✓ D6 已全绿（Web 侧行为未因原生适配改变） |

## 6. 真机/模拟器测试状态（如实）

**未执行，且本机无法执行**：

- 无连接的 Android 真机（`adb devices` 空）；
- CPU 虚拟化关闭 → 无法启动 Android 模拟器（按授权也未安装 emulator/system-images）；
- 因此「安装、首次启动、杀进程持久化、覆盖升级数据保留、软键盘/刘海屏表现」等**必须由测试用户在真机完成**（见 `BETA-TEST-PLAN.md` P0 组）。

已用静态手段最大程度降低风险：签名/包信息/资源完整性/无远程依赖/权限最小化均通过工具链验证；数据层行为由 369 项逻辑测试 + 168 项 Web E2E（含 D0 数据安全 14 项）覆盖，WebView 与桌面浏览器共用同一套存储代码路径（IndexedDB 在 Android WebView 为持久化实现）。

## 7. 复现构建（其他机器）

```powershell
# 前置：Node>=22、JDK21、Android SDK(platform-36 + build-tools 35/36 + platform-tools)、Gradle wrapper 自动下载
$env:JAVA_HOME = '<jdk21>'
$env:ANDROID_HOME = '<sdk>'
$env:GRADLE_USER_HOME = '<gradle-home>'
$env:FLOWDAY_SIGNING_PROPS = '<keystore 目录>\signing.properties'   # 需持有同一 Beta 密钥
npm ci
powershell -File scripts\build-android-beta.ps1
powershell -File scripts\verify-android-beta.ps1
```

注意：Beta 更新**必须**使用同一 keystore（否则无法覆盖安装）。

## 8. 已知限制 / 未验证项

1. 真机安装/启动/持久化/升级保留：未验证（无设备/模拟器）——P0，交付测试用户后回收结果。
2. 厂商 WebView 差异（旧版 WebView、定制 ROM）：未覆盖。
3. 横屏/折叠屏/平板：仅保证不崩溃，未专项适配。
4. APK 内仍包含 `sw.js`/`manifest.webmanifest` 文件（原生环境不注册/不使用），保留以维持 Web/PWA 与原生同源产物；如需可从 webDir 排除（会同时影响 Web 发布，故未做）。
5. 构建机 Java 写 confinement 属本机特殊环境；其他机器按 §7 常规路径即可。

## 9. Git 记录

| 提交 | 内容 |
|---|---|
| `02963d7` | Capacitor 8.6.2 集成（配置/Android 工程/品牌资源/原生 SW 抑制/设置页版本信息） |
| 本提交 | 构建脚本、验证脚本、release 文档、资源重复定义修复、buildInfo 再生成 |

未修改 `main`、未修改 `phase4.5-accepted`、未 push、keystore 未入库。

---

# Beta.2 追加：Liquid Glass 重构 + Android 原生适配（2026-11-18）

## A. 结论摘要

| 项 | 值 |
|---|---|
| APK | `release/android/FlowDay-5.0-a-Beta.2.apk`（3,619,517 bytes / 3.45 MB） |
| SHA-256 | `1f5f22614398668258481ff645a4981befa49b59471cf46ab9fe2fbc904eb6b3` |
| 签名 | v2 scheme；证书 SHA-256 `B5:6B:30:48:…:56:BA:77`（**与 Beta.1 完全一致**，可直接覆盖升级） |
| versionName / versionCode | `5.0-a-beta.2` / `2` |
| applicationId / minSdk / targetSdk | `app.flowday.beta` / 24 / 36（未变） |
| 内嵌 Web commit | `26d059e` |
| Beta.1 | 已保留为 `FlowDay-5.0-a-Beta.1.apk`（sha256 `5553767a…eda095`） |

## B. 两条专项的完成证据

| 验收要求 | 证据 |
|---|---|
| 1 修复前截图 | `docs/phase5.0/lg-evidence/before/`（52 张，9 视口 × 深浅 × 页面） |
| 2 修复后截图 | `docs/phase5.0/lg-evidence/after/`（76 张）；精选入库 `curated/`（3.2 MB） |
| 3 Liquid Glass Token 设计说明 | `docs/phase5.0/BETA2-LIQUID-GLASS-SYSTEM.md`（Token 表 + 三层材质 + 取舍） |
| 4 各组件材质变化清单 | `docs/phase5.0/BETA2-COMPONENT-MATERIAL-MATRIX.md`（14 个组件逐项对比） |
| 5 Android 系统适配报告 | `docs/phase5.0/BETA2-ANDROID-ADAPTATION-REPORT.md` |
| 6 移动端各尺寸截图 | 320/360/375/390/412/432 六档 × 深浅 × 3 页面（`after/`，溢出检查 73/73 通过） |
| 7 动画交互录屏 | `after/anim/*.gif` + `curated/*.gif`（胶囊位移/菜单/弹窗/分段控件），修复前对照 `before/anim/nav_switch_before.gif` |
| 8 性能测试结果 | 滚动 avg 16.52ms / p95 16.7ms / 长帧 0；perf-5a 7/7（同机 A/B 口径） |
| 9 无障碍测试结果 | a11y E2E 35/35（3 次一致）；对比度实测 42 探针 0 失败、最低 5.03:1；reduced-motion/transparency/contrast 降级已实现 |
| 10 Beta.2 APK | 见 §A |

## C. 关键实现（与 Beta.1 的本质差异）

1. **三层材质**：L1 液态玻璃（导航/头部/底部胶囊/菜单/Toast/Segmented/FAB/弹窗）、L2 标准内容材质（卡片，不用 backdrop-filter）、L3 环境光层（光场 + 颗粒并入 body 背景）。
2. **边缘折射**：conic 渐变折射环 + 顶部透镜光带 + 内衬高光 + 厚度阴影 + 外发丝边；不使用 SVG/Canvas/WebGL 滤镜（WebView 性能不可接受）。
3. **环境响应**：运行时采样玻璃下方内容色 → `--lg-ambient` 染色；`--lg-scroll` 驱动浮起阴影；主题切换同步原生状态栏图标。
4. **流体交互**：底部导航与分段控件为真实位移指示器（transform/width 弹簧）；菜单锚点生长；弹窗上浮 + ghost 退出层（无 dialog 语义）；按压体积变化。
5. **Android 原生**：Edge-to-Edge、透明系统栏、WindowInsets（含刘海/横屏/IME）注入 `--lg-safe-*`、`adjustResize`、WebView 缩放禁用但保留字体缩放、`FlowDayNative.setDark` 桥。

## D. 修复的真实缺陷

| 缺陷 | 修复 |
|---|---|
| 320px 视口 /today 横向溢出 38px（grid min-content + 固定 64px 进度环） | 网格改 `grid-cols-[minmax(0,1fr)]`；进度卡可换行、环 56px、文字列弹性 |
| 玻璃上的文字低于 WCAG AA（深色侧栏 2.75:1，header 日期 4.18:1） | 为玻璃面单独校准 `--fd-ink-2/3`；深色环境光斑 26%→14%；复测最低 5.03:1 |
| 模态退出动画会形成"幽灵模态"（抢焦点/遮挡下层浮层） | 退出层移除 dialog 语义 + `inert` + `pointer-events:none` |
| `.fd-card{position:relative}` 覆盖 Tailwind `sticky`（同层叠层陷阱） | 移除该声明，恢复卡片 sticky 堆叠 |
| 全屏 `soft-light` 混合层与 main 子树 MutationObserver 拖慢大数据保存路径 | 颗粒并入背景、移除子树观察者；同机 A/B 回到容差内 |

## E. 回归与性能（最终代码）

- 逻辑 369/369；主 E2E 91/91；a11y 35/35；备份 14/14；多标签 29/29；项目 30/30；撤销 20/20；引导 16/16；数据安全 14/14；PWA 14/14；性能 7/7；视觉证据 73/73。
- 性能口径变更（如实记录）：D6 的绝对基线 245ms 在本机当前负载下不可复现（Beta.1 代码实测 294–318ms）。改用**同机 A/B**：Beta.1 中位 ≈305ms、Beta.2 中位 ≈332ms（+8.9%，容差 1.1× 内），并以 `PERF_BASELINE_SAVE_MS` 显式传入同机基线，避免环境漂移误判。

## F. 仍未验证（必须真机复核）

1. 真机安装/启动/持久化/覆盖升级（本机无设备、无虚拟化，无法跑模拟器）；
2. 真机状态栏/手势条避让、软键盘遮挡、横屏安全区、双指缩放禁用；
3. 真机滚动与动画流畅度（当前只有 Blink 合成层实测）；
4. 旧版 WebView（<Chrome 76）下的降级观感。