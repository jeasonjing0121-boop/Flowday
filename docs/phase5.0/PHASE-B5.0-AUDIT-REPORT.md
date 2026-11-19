# Phase 5.0-B5.0 · 环境审计报告

> 阶段：**B5.0（环境审计）** · 状态：**已完成，等待人工验收**
> 分支：**`phase5.0-b5`**（独立 B5 开发分支，从 B4 最终验收 SHA 拉出）
> B4 回滚基线：**`5339589f0577fa0fd0a70476fa19ead7001fe27a`**（`phase5.0-a` 指针未移动）
> 证据目录：`docs/phase5.0/phase-b5-evidence/`
> 本阶段**未构建 APK、未修改产品代码、未合并 main、未打 Tag、未进入 B5.1**。

---

## 1. 环境检查结果

### 1.1 版本矩阵（实测）

| 组件 | 期望 | 实测 | 结论 |
|---|---|---|---|
| 操作系统 | — | Windows 11 专业版（10.0 amd64） | ✅ |
| **JDK** | 21 | **Temurin 21.0.13+9**（`F:\AndroidSdk-jdk21\jdk-21.0.13+9`） | ✅ |
| javac | 21 | `javac 21.0.13` | ✅ |
| **Gradle** | wrapper 8.14.3 | **Gradle 8.14.3**（Launcher JVM 21.0.13） | ✅ |
| **AGP** | 兼容 Gradle 8.13+ | **8.13.0** | ✅ |
| android-google-services | — | 4.4.4 | ✅ |
| **Android SDK** | platform-36 | `android-36`（唯一平台） | ✅ 与 compileSdk 36 一致 |
| **Build Tools** | 35.0.0 / 36.0.0 | **35.0.0、36.0.0**（aapt2 / apksigner / zipalign / d8 齐全） | ✅ |
| platform-tools / adb | — | 存在；adb 1.0.41（33.0.0） | ✅ |
| cmdline-tools（sdkmanager） | 可选 | **不存在**（无法在线增删 SDK 组件） | ⚠ 见 §7 |
| **Capacitor** | 8.x | core / android / cli 均 **8.6.2** | ✅ |
| Node / npm | ≥22 | node **v24.16.0** / npm **11.13.0** | ✅ |
| 磁盘可用 | — | **35.9 GB** | ✅ |
| 设备连接 | vivo X200s | **当前未连接**（0 设备） | ⚠ 见 §7 |

> 版本证据：`docs/phase5.0/phase-b5-evidence/{environment-matrix.json, gradle-version.txt, adb-state.txt}`

### 1.2 构建链可用性验证（只读探测，未构建）

| 验证项 | 结果 |
|---|---|
| Gradle 离线启动（`gradlew --version --offline --no-daemon`） | **成功，16.4s**；Gradle 8.14.3 / Launcher JVM 21.0.13 |
| Gradle 发行版缓存 | `.tmp/gradle-home/wrapper/dists/gradle-8.14.3-all` ✅ |
| 依赖缓存 | `.tmp/gradle-home/caches/modules-2`（99 个 artifact 组）✅ |
| 历史构建日志 | `.tmp/gradle-build.log` 尾部：**BUILD SUCCESSFUL in 1m 22s / 124 tasks** ✅ |
| 构建编排脚本 | `scripts/build-android-beta.ps1`（环境变量 + 版本 + sync + assembleRelease + 产物收集）✅ |
| 版本信息生成 | `scripts/gen-build-info.mjs` 存在 ✅ |

**关键发现（必须写入 B5.1 执行规范）**：
- 直接运行 `gradlew` 且**不设置 `GRADLE_USER_HOME`** 时，wrapper 会尝试**下载 Gradle 发行版**并长时间卡住（本轮已复现并终止）。
- **必须**显式设置：`JAVA_HOME`、`ANDROID_HOME`、`ANDROID_SDK_ROOT`、`GRADLE_USER_HOME=.tmp/gradle-home`、`TMP/TEMP=.tmp/gradle-tmp`（与既有构建脚本一致）。
- 新 shell 中 `JAVA_HOME` 默认为空，任何 Gradle/apksigner 命令都需先设置。

---

## 2. 项目 Android 构建配置检查

| 配置项 | 值 | 说明 |
|---|---|---|
| 包名 / namespace | **`app.flowday.beta`** | Beta 渠道身份；与未来正式版需区分（§8） |
| versionCode / versionName | **2 / `5.0-a-beta.2`** | 与设备已装 Beta.2 一致 |
| minSdk / targetSdk / compileSdk | **24 / 36 / 36** | targetSdk 36 → **默认强制 edge-to-edge**（B5.2 的前提） |
| buildToolsVersion | **36.0.0（固定）** | 避免 AGP 自动下载其它版本 |
| 签名配置 | **条件式**：仅当 `FLOWDAY_SIGNING_PROPS` 指向的 properties 存在时才配置 `signingConfigs.release`；缺失则 release 不签名，构建脚本拒绝产出 | 设计良好：密钥不入库 |
| 构建参数 | `org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8 -Djava.io.tmpdir=F:/DeepSeekHarness/FlowDay/.tmp/gradle-tmp` | 临时目录固定在仓库内 |
| SDK 路径 | `android/local.properties: sdk.dir=F:\...\.tmp\android-sdk`（gitignored） | 机器本地 |
| Capacitor 配置 | `appId=app.flowday.beta`、`appName=FlowDay Beta`、`webDir=dist`、`androidScheme=https`、`allowNavigation=[]`、`allowMixedContent=false` | 资源本地打包，不依赖远程页面 |
| Manifest 关键项 | `launchMode=singleTask`、`windowSoftInputMode=adjustResize`、`configChanges`（orientation/screenSize/density/uiMode/navigation 等）、`allowBackup=true`、INTERNET 权限 | `adjustResize` + B3 键盘管线的基础 |
| 原生 Insets 实现 | `MainActivity.java:89 WindowCompat.setDecorFitsSystemWindows(window,false)`；`setOnApplyWindowInsetsListener` 读取 `systemBars()+displayCutout()` 与 `ime`；`addJavascriptInterface(FlowDayBridge,"FlowDayNative")` | **B2/B3 的 Insets 管线已在原生侧就绪**（B5.2 只需验证/修正数值与布局） |
| 已有构建产物 | `android/app/build/outputs/apk/release/app-release.apk`（3,619,517 B，2026-11-18 13:40，即 Beta.2） | 上一构建状态正常 |
| 发布产物 | `release/android/FlowDay-5.0-a-Beta.{1,2}.apk` + SHA256.txt + BUILD-REPORT.md | 归档完整 |

---

## 3. 签名配置与测试构建隔离方案

### 3.1 现状（实测，不读取密钥内容）

| 事实 | 值 |
|---|---|
| 仓库内 keystore | `.secrets/flowday-beta.keystore`（2,756 B），**已被 .gitignore 覆盖**（`.secrets/`） |
| 仓库外签名材料 | `F:\AndroidSdk-keystore\signing.properties` ✅ 存在、`flowday-beta.keystore` ✅ 存在 |
| 当前 `FLOWDAY_SIGNING_PROPS` | **未设置**（默认不会对 release 签名） |
| Beta.2 证书 | `subject: CN=FlowDay Beta, OU=FlowDay, O=FlowDay, L=Local, ST=Local, C=CN`；RSA 2048；SHA-256 `b56b3048…56ba77` |
| 调试 keystore | `~/.android/debug.keystore` **尚不存在**（首次 debug 构建时由 AGP 自动生成） |

### 3.2 隔离方案（B5.1 执行，本阶段仅设计、未落地）

| 目标 | 方案 |
|---|---|
| 与现有 Beta.2 **并存安装** | `applicationId` 后缀：**`app.flowday.beta.b5test`**（不同包名 → 独立数据目录，互不覆盖） |
| **测试签名**，不触碰发布签名 | 使用 **debug 构建类型**（AGP 自动 debug keystore，证书 `CN=Android Debug`），且**不设置** `FLOWDAY_SIGNING_PROPS` |
| 版本独立 | `versionCode 101`、`versionName 5.0-a-b5test.1`（与 Beta.2 的 2 / beta.2 明确区分） |
| 构建基线 | 固定 `5339589`（B5 分支当前 HEAD，等于 B4 验收 SHA） |
| 产物隔离 | 输出到 `release/android/b5test/`，命名 `FlowDay-5.0-a-B5test.1.apk` + `SHA256.txt` |
| 配置改动最小化 | 仅在 `android/app/build.gradle` 增加**受环境变量 `FLOWDAY_B5TEST=1` 控制**的默认配置分支（不改 release 签名块、不改正式包名默认值） |
| 构建命令 | `gradlew.bat assembleDebug --offline --no-daemon`（带 §1.2 环境变量） |
| 构建后校验 | `aapt2 dump badging`（包名/版本）、`apksigner verify --print-certs`（证书 CN 必须为 Debug）、`pm list packages`（两个包并存）、启动并确认数据为空（独立数据） |
| 回归确认 | Beta.2 仍可启动、其本地数据不变；B5test 卸载不影响 Beta.2 |

> ⚠ 该方案将在 B5.1 落地时**改动 `android/app/build.gradle`（非产品运行时代码，属构建配置）**，改动范围需在 B5.1 汇报中逐行列出；未获 B5.1 批准前不实施。
>
> 附带收益：debug 包启用 WebView 调试，B5.2/B5.3 可用 `chrome_devtools_remote` + CDP 读取真机 `--lg-safe-*`/`--lg-ime` 实际值并截图，证据强度显著提升。

---

## 4. B5 系统级验收矩阵（锁定）

| 维度 | 取值 | 适用阶段 |
|---|---|---|
| 设备 | vivo X200s（V2458A，**API 37**，WebView **157.0.8103.38**，1260×2800 @560dpi → 360×800dp，DPR 3.5） | B5.2–B5.5 |
| 导航模式 | **手势（`navigation_mode=2`）** / 三键（临时切换，测后恢复） | B5.2 |
| 系统 Insets 基准值 | 状态栏 **42dp** · 手势条 **18dp** · 挖孔 **35.7dp** | B5.2 |
| 方向 | 竖屏（360×800dp）/ 横屏 | B5.2、B5.3 |
| 主题 | 浅色 / 深色 | 全部 |
| 系统字体缩放 | **100% / 130% / 150%** | B5.3 |
| 屏幕亮度 | 20% / 60% / 100%（人工目视） | B5.3 复核 |
| 页面 | 今日 / 任务 / 日历 / 习惯 / Jing / 设置 / 弹窗 | 全部 |
| 键盘 | 弹出 / 收起 / 切换输入法 / 长表单 | B5.4 |
| 性能口径 | `dumpsys gfxinfo`：Janky < 5%、p95 ≤ 20ms；冷启动；10k 任务渲染 | B5.5 |
| 降级路径 | `@supports not (backdrop-filter)` / `prefers-reduced-transparency` | B5.5 |
| PWA | 14/14 保持 | B5.6 |
| 回归门 | B2 67 / B3 99 / 逻辑 369 / 视觉 73 / 性能 7 / 全 E2E | 每阶段 |

---

## 5. B4 回滚基线

| 项 | 值 |
|---|---|
| **B4 最终验收 SHA** | **`5339589f0577fa0fd0a70476fa19ead7001fe27a`** |
| `phase5.0-a` 指针 | 仍为 `5339589`（未被移动/删除） |
| B5 分支 | **`phase5.0-b5`**，从 `5339589` 拉出（当前 HEAD 同 SHA，尚未提交 B5 文档前） |
| `main` / `phase4.5-accepted` | `d6297ab` / `d6297ab`（未动） |
| 新增 Tag | **无** |
| 工作区未跟踪文件 | **68 个全部保留**（未做任何清理） |
| 回滚命令 | `git switch phase5.0-a`（代码回到 B4）；如需彻底回退：`git switch -C phase5.0-b5 5339589` 或 `git reset --hard 5339589`（仅限 B5 分支） |
| 分支选择说明 | 采用**独立分支**而非独立 worktree：构建依赖大量 gitignored 本地资产（`node_modules`、`.tmp/android-sdk`、`.tmp/gradle-home`、`.secrets`、`release/android`），独立 worktree 需复制/junction 这些资产，反而增加构建不确定性；独立分支同样满足隔离与回滚要求 |

---

## 6. B4 归档完整性与 SHA-256 复核

| 项 | 结果 |
|---|---|
| 清单文件 | `docs/phase5.0/PHASE-B4-ARCHIVE-MANIFEST.md` + `phase-b4-device-acceptance/archive-manifest.json` |
| 复核文件数 | **116** 个（清单本身不参与校验，避免自引用循环） |
| 复核结果 | **PASS：116 通过 / 0 缺失 / 0 SHA 不符** |
| 总字节 | **102,833,915 B（98.07 MB）**，实盘一致 |
| 复核证据 | `docs/phase5.0/phase-b5-evidence/b4-archive-verification.txt` |
| 复核命令 | `python .tmp/b4-verify-archive.py`（逻辑：逐文件 SHA-256 与清单比对） |

> 修正记录：首轮复核发现清单**把自身哈希也写入清单**（自引用，必然不符）；已改为排除清单自身并在清单头部说明，复测 116/116 通过。

---

## 7. 环境缺口与风险（如实）

| # | 问题 | 影响 | 处置 |
|---|---|---|---|
| 1 | `JAVA_HOME` / `ANDROID_HOME` / `GRADLE_USER_HOME` 在新 shell 中均为空 | 直接调用 gradle/apksigner 会失败或触发下载 | B5.1 构建命令必须显式设置（沿用 `build-android-beta.ps1` 的写法） |
| 2 | 未设 `GRADLE_USER_HOME` 时 wrapper 尝试下载发行版并长时间卡住（已复现） | 构建假死 | 固定 `GRADLE_USER_HOME=.tmp/gradle-home`，并加 `--offline` 首选项 |
| 3 | **cmdline-tools 缺失**（无 sdkmanager） | 不能在线安装/更新 SDK 组件 | 现有 platform-36 + build-tools 35/36 已满足；若 B5 需要新组件需另行准备 |
| 4 | **设备当前未连接** | B5.1 安装验证、B5.2–B5.5 真机验收均阻塞 | 需重新连接并授权 USB 调试（连接后先跑 `device-acceptance.ps1 -Action info`） |
| 5 | `debug.keystore` 尚不存在 | 首次 debug 构建自动生成 | 属正常；生成后记录证书指纹用于隔离校验 |
| 6 | 依赖缓存是否覆盖 assembleDebug | 未知（历史构建为 assembleRelease） | B5.1 先用 `--offline` 试探；失败再允许联网（记录重试参数） |
| 7 | Android 17（API 37）设备 vs targetSdk 36 | 新系统 edge-to-edge 行为可能有额外约束 | B5.2 以真机实测为准，逐项记录 |

---

## 8. 发布策略建议（仅文档，不执行）

| 项 | 建议 |
|---|---|
| **包名** | Beta 渠道保持 `app.flowday.beta`；正式版建议 **`app.flowday`**（独立身份、独立数据）。二者不能互相覆盖升级；如未来需要迁移数据，走已有的导出/导入备份能力 |
| **版本号** | `versionCode` 单调递增且跨渠道不冲突（建议 Beta 段与正式段分段，例如正式 `10000+`、Beta `200+`）；`versionName` 采用 `5.0.0-beta.N` / `5.0.0` |
| **签名** | 现有 Beta keystore（`F:\AndroidSdk-keystore`）仅用于 Beta；正式版需**新建发布 keystore 并离线备份**（密钥丢失将导致无法升级）；签名证书一旦用于发布**不得更换** |
| **签名方案** | APK Signature Scheme v2/v3（AGP 默认开启）；验证用 `apksigner verify --print-certs` |
| **产物形态** | 侧载/国内渠道用 APK；Google Play 用 AAB（需另行配置 bundle 构建）；两者 `versionCode` 同步 |
| **发布门禁** | 正式构建仅在 B5.6 验收通过后、由你明确批准时执行；本阶段不生成任何发布密钥、不构建发布包 |
| **PWA** | 与 Android 包相互独立，发布不影响 PWA 注册与更新流程 |

---

## 9. B5.1 前置条件检查清单

| # | 条件 | 当前状态 |
|---|---|---|
| 1 | B5.0 环境审计全部通过（本报告 §1–§6） | ✅ 待你验收 |
| 2 | 构建基线固定 `5339589` | ✅ 分支已从其拉出 |
| 3 | 测试 APK 与 Beta.2 独立安装（包名后缀） | 🟡 方案已定，B5.1 落地 |
| 4 | 使用独立测试签名（debug keystore） | 🟡 B5.1 落地 |
| 5 | 不修改正式发布签名配置 | ✅ 方案保证（不设 `FLOWDAY_SIGNING_PROPS`） |
| 6 | 不覆盖原有安装包与本地数据 | ✅ 包名不同 → 数据隔离 |
| 7 | 产物记录 SHA / 版本号 / 校验和 | 🟡 B5.1 交付物 |
| 8 | 设备连接并授权 | ❌ **当前未连接**（B5.1 安装验证前必须恢复） |

---

## 10. 本阶段变更与 Git

| 项 | 值 |
|---|---|
| 产品代码 / 构建配置改动 | **0**（本报告与证据均为文档） |
| 新增文件 | `docs/phase5.0/PHASE-B5.0-AUDIT-REPORT.md`、`docs/phase5.0/phase-b5-evidence/`（7 个证据文件） |
| 提交 | 见文末（B5 分支 docs 提交） |
| APK 构建 | **未执行** |
| main / Tag | 未动 |
| B4 未跟踪证据 | 68 个全部保留 |

---

## 11. 结论

- **环境审计通过**：JDK21 / Gradle 8.14.3 / AGP 8.13.0 / SDK 36 / Build Tools 35+36 / Capacitor 8.6.2 / Node 24 均满足；构建链历史验证成功（`BUILD SUCCESSFUL in 1m 22s`），离线 Gradle 启动正常。
- **配置审计通过**：edge-to-edge 与 Insets 原生管线已在 `MainActivity` 就绪；签名采用"外部 properties 条件启用"的安全设计。
- **隔离方案已锁定**（包名后缀 + debug 测试签名 + 独立产物目录 + 版本号区分），待 B5.1 落地。
- **归档完整性 PASS（116/116）**，B4 回滚基线明确（`5339589` / `phase5.0-a`）。
- **两个阻塞项**：设备未连接；`JAVA_HOME`/`GRADLE_USER_HOME` 必须显式设置（已写入 B5.1 执行规范）。

**B5.0 完成，停止工作，等待人工验收。未开始 B5.1。**
