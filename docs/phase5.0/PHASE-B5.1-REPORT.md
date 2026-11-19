# Phase 5.0-B5.1 · 测试 APK 构建与静态审计报告

> 阶段：**B5.1（测试 APK 构建 + 静态审计）** · 状态：**APK 已构建并通过全部静态审计；真机验证未执行（设备未连接）**
> 分支：`phase5.0-b5`
> 构建基线 SHA：`01587bc75401ea49043fd411d29867fb67b5d36d`（B5.0 审计提交）
> B4 冻结 SHA：`5339589f0577fa0fd0a70476fa19ead7001fe27a`（未动）
> 本阶段**未开始 B5.2**，未改 Insets/字体缩放/材质，未合并 main、未打 Tag。

---

## 1. Git SHA 与分支

| 项 | 值 |
|---|---|
| 分支 | **`phase5.0-b5`** |
| 构建时 HEAD | `01587bc75401ea49043fd411d29867fb67b5d36d` |
| 提交后 HEAD | 见 §9（本报告提交 SHA） |
| B4 分支 `phase5.0-a` | `5339589f0577fa0fd0a70476fa19ead7001fe27a`（未移动） |
| `main` / Tag | `d6297ab` / `d6297ab`（未动） |
| B4 未跟踪验收材料 | 68 个全部保留（未清理） |

---

## 2. 修改文件清单

| 文件 | 类型 | 改动内容 |
|---|---|---|
| `android/app/build.gradle` | 构建配置 | **+10 行**：`FLOWDAY_B5TEST=1` 时启用隔离（`applicationIdSuffix ".b5test"`、`versionCode 101`、`versionName "5.0-a-b5test.1"`）；**默认值不变**，release 签名块**未触碰** |
| `.gitignore` | 仓库配置 | +2 行：忽略 `release/android/b5test/*.apk`（二进制不入库） |
| `scripts/build-android-b5test.ps1` | 新增工具 | B5 测试包离线构建脚本（环境变量固定、失败即停、**不联网**、产物校验） |
| `scripts/verify-b5test-apk.ps1` | 新增工具 | 设备接入后的 **9 项**验证脚本（哈希/安装/原包不变/并存/启动/Capacitor 与文件访问/浅深色/布局/崩溃），**绝不卸载或覆盖 Beta.2** |
| `release/android/b5test/SHA256.txt` | 产物清单 | APK 校验值、包名、版本、证书指纹、隔离说明 |
| `docs/phase5.0/PHASE-B5.1-REPORT.md` | 本文档 | 阶段报告 |
| `docs/phase5.0/phase-b5-evidence/b5.1/*` | 证据 | badging / manifest tree / apksigner / 构建日志 / gradle 日志 |

**产品运行时代码（`src/`）改动：0**。`src/lib/buildInfo.ts` 在构建时由 `gen-build-info.mjs` 生成为测试版本（`5.0-a-b5test.1` / 101），**构建完成后已恢复原样**，仓库保持干净。

---

## 3. APK 产物与 SHA-256

| 项 | 值 |
|---|---|
| **路径** | **`release/android/b5test/FlowDay-5.0-a-B5test.1.apk`** |
| 大小 | **4,853,194 B（4.63 MB）** |
| **SHA-256** | **`61645357097356541026dbe67a3dc1966166fecab5d3208ac308ad15ed9c6de4`** |
| 校验清单 | `release/android/b5test/SHA256.txt`（同目录） |
| 说明 | Debug 构建（含 debuggable 与 WebView 调试），**非发布包**；体积大于 release（3.45 MB）属正常 |

---

## 4. APK 静态审计结果（全部通过）

| # | 检查项 | 要求 | 实测 | 结论 |
|---|---|---|---|---|
| 1 | 最终 applicationId | `app.flowday.beta.b5test` | `package: name='app.flowday.beta.b5test'` | ✅ |
| 2 | versionCode | `101` | `versionCode='101'` | ✅ |
| 3 | versionName | `5.0-a-b5test.1` | `versionName='5.0-a-b5test.1'` | ✅ |
| 4 | 签名 | 独立 Debug 测试证书 | `CN=Android Debug, O=Android, C=US`；SHA-256 `690ca0b2…6c1fd092` | ✅ |
| 5 | 是否误用 Beta/发布密钥 | 必须不同 | Beta.2 证书 `B5:6B:30:48:…:56:BA:77` ≠ B5test `69:0C:A0:B2:…:6C:1F:D0:92`；构建时 `FLOWDAY_SIGNING_PROPS` 已移除 | ✅ 未使用 |
| 6 | `apksigner verify` | 必须 Verifies | **`Verifies`**；v2 scheme = true（v1/v3/v4 = false，Debug 构建正常） | ✅ |
| 7 | SHA-256 记录 | 与产物一致 | 4,853,194 B ↔ `61645357…c6de4` | ✅ |

附加审计：

- `android:debuggable=true`（Debug 构建预期，便于 WebView 调试）；
- FileProvider / androidx-startup authorities 均带 `.b5test` 后缀（`app.flowday.beta.b5test.fileprovider`）→ **不会与 Beta.2 冲突**；
- Activity 类名解析为 `app.flowday.beta.MainActivity`（namespace 未变，相对类名正常解析）。

证据：`phase-b5-evidence/b5.1/{b5test-badging.txt, b5test-manifest-tree.txt, b5test-apksigner.txt}`

---

## 5. 包名/命名空间/应用身份一致性检查（你要求的第 6 项）

| 层 | 值 | 说明 |
|---|---|---|
| **Capacitor `appId`**（`capacitor.config.ts`） | `app.flowday.beta` | **未修改**；用于 Capacitor 插件/配置识别，与安装身份无关 |
| **Android `namespace`**（`build.gradle`） | `app.flowday.beta` | **未修改**；编译期 R 类与清单相对类名（`.MainActivity`）以此解析 |
| **`applicationId`（默认）** | `app.flowday.beta` | **未修改**（默认构建身份） |
| **`applicationId`（B5TEST=1）** | `app.flowday.beta.b5test` | 仅测试构建追加 `applicationIdSuffix` |
| **最终 APK 包名（实测）** | `app.flowday.beta.b5test` | 与测试配置一致 ✅ |

**结论**：三者中仅 `applicationId` 按开关追加后缀，`appId`/`namespace` 保持不变 → 代码与插件身份一致、安装身份隔离；`${applicationId}` 派生的 authorities 自动变为 `.b5test`，无冲突。

---

## 6. 测试配置不影响正式发布配置（你要求的第 7 项）

| 验证 | 方法 | 结果 |
|---|---|---|
| 默认构建身份不变 | **不设置** `FLOWDAY_B5TEST`，执行 `:app:processDebugMainManifest --offline` 并检查合并清单 | `package="app.flowday.beta"` ✅ |
| 默认版本值不变 | 检查 `build.gradle` 默认 `versionCode 2` / `versionName "5.0-a-beta.2"` 未被覆盖（隔离值位于条件块内） | ✅ |
| release 签名配置 | `git diff` 显示签名相关代码 **0 改动**；未设置 `FLOWDAY_SIGNING_PROPS` | ✅ |
| 既有 Beta.2 产物 | `release/android/FlowDay-5.0-a-Beta.2.apk` 时间戳/大小未变（3,619,517 B / 11-18 13:40） | ✅ 未被覆盖 |
| 正式密钥 | 构建全程未使用 `F:\AndroidSdk-keystore` 下任何密钥；首用 `~/.android/debug.keystore`（首次 Debug 构建自动生成） | ✅ |

---

## 7. 构建日志与离线依赖

| 项 | 结果 |
|---|---|
| Gradle wrapper 离线启动 | ✅ Gradle 8.14.3（`GRADLE_USER_HOME=.tmp/gradle-home`） |
| 构建方式 | **离线**（`--offline`），未触发任何网络下载 |
| 结果 | **`BUILD SUCCESSFUL in 2m 54s` / `93 actionable tasks: 91 executed, 2 up-to-date`** |
| 缺失依赖 | **无**（离线一次通过，无需你授权联网） |
| 日志 | `phase-b5-evidence/b5.1/{b5test-build.log, b5test-gradle.log}` |
| 已知告警 | `WARNING: Using flatDir should be avoided...`（Capacitor 模板既有，非本阶段引入） |

构建环境（显式设置）：
`JAVA_HOME=F:\AndroidSdk-jdk21\jdk-21.0.13+9` · `ANDROID_HOME=…\.tmp\android-sdk` · `GRADLE_USER_HOME=…\.tmp\gradle-home` · `TMP/TEMP=…\.tmp\gradle-tmp` · `FLOWDAY_B5TEST=1`（`FLOWDAY_SIGNING_PROPS` 显式移除）。

---

## 8. vivo X200s 真机验证 —— **未执行（设备未连接）**

> **必须明确区分：APK 已构建并通过静态审计 ≠ 真机已验证。本节结论为"未验证"。**

| 项 | 状态 |
|---|---|
| 设备连接（19:13–19:22 多次检查） | ❌ `adb devices` 为空 |
| 独立安装 | ⏳ 未执行 |
| 首次启动 / 首屏显示 | ⏳ 未执行 |
| 浅色 / 深色检查 | ⏳ 未执行 |
| 底栏与页面布局 | ⏳ 未执行 |
| 关键页面冒烟 | ⏳ 未执行 |
| 与 B4 真机效果对比（视觉回归） | ⏳ 未执行 |

**设备接入后的一键验证**（已备脚本，**绝不卸载/覆盖 Beta.2**）：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\verify-b5test-apk.ps1
```
脚本内容：校验 APK 哈希与清单一致 → `adb install -r`（仅安装 `app.flowday.beta.b5test`）→ 检查 Beta.2 路径前后一致（证明未被覆盖）→ 确认两包并存 → 启动并截图 → 记录前台 Activity 与 Insets → 输出 `phase-b5-evidence/b5.1/device/`。

---

## 9. 视觉回归情况（静态结论，非真机结论）

- B5.1 相对 B4 验收 SHA **无任何 web/产品运行时代码改动**（`git diff 5339589..HEAD -- src` = 空；本阶段仅改 Gradle 构建配置与工具/文档）。
- 因此 APK 内打包的 Web 资源与 B4 视觉代码完全一致，**预期视觉效果与 B4 相同**。
- **但未在真机上截图对比**，不能标记为"视觉回归通过"；需设备接入后按 §8 复核（浅/深色、底栏、弹窗、卡片）。

---

## 10. 剩余问题与风险

| # | 问题/风险 | 影响 | 处置 |
|---|---|---|---|
| 1 | **设备未连接** | B5.1 真机项未验证 | 接入后执行 `verify-b5test-apk.ps1`，补交证据 |
| 2 | Debug 包（4.63 MB，debuggable） | 性能/体积不代表发布包；B5.5 性能结论应以 release 构建为准 | B5.5 阶段改用 release 构建（需签发配置，另行授权） |
| 3 | 首次生成 `~/.android/debug.keystore` | 后续同机 Debug 构建沿用同一证书 | 已记录指纹 `690ca0b2…`，可用于识别 |
| 4 | `buildInfo.ts` 为构建时生成后已还原 | 若后续单独重建而未跑 gen 脚本，版本信息可能仍是 beta.2 | 构建务必走 `build-android-b5test.ps1`（内含生成步骤） |
| 5 | 测试包与正式包同属 Beta 前缀命名空间 | 人工误装风险 | 测试包名 `.b5test` 后缀 + 报告/清单显著标注 |
| 6 | 未修改 release 签名块 | 正式构建仍需 `FLOWDAY_SIGNING_PROPS` | 保持现状，B5.6 前不做正式构建 |

---

## 11. 结论与停止

- **B5.1 构建目标达成**：离线一次构建成功；APK 包名/版本/签名/校验和全部通过静态审计；与 Beta.2 完全隔离（不同包名、不同证书、独立 authorities、不触碰发布配置）。
- **真机验证未执行**（设备未连接），按你的要求**不得标记为通过**。
- **未进入 B5.2**，未做 Insets / Edge-to-edge / 字体缩放相关工作。

**B5.1 完成，停止工作，等待人工验收与设备接入指示。**

---

## 12. 补充：提交文件数量与实际清单的差异核对（B5.1 复查）

**结论：提交 11 个文件，与报告 §2 的 7 行清单并不矛盾——7 行中有 1 行是聚合目录。**

| 报告 §2 行 | 对应实际文件数 | 文件 |
|---|---|---|
| `android/app/build.gradle` | 1 | 构建隔离配置（+10 行） |
| `.gitignore` | 1 | +3 行（空行 + 注释 + `release/android/b5test/*.apk`） |
| `scripts/build-android-b5test.ps1` | 1 | 构建脚本（+93 行） |
| `scripts/verify-b5test-apk.ps1` | 1 | 验证脚本（原 +66 行；本轮扩展为 9 项，行数见最新提交） |
| `release/android/b5test/SHA256.txt` | 1 | 产物校验清单（+17 行） |
| `PHASE-B5.1-REPORT.md` | 1 | 阶段报告（+166 行） |
| `phase-b5-evidence/b5.1/*`（**1 行 = 5 个文件**） | **5** | `b5test-apksigner.txt`、`b5test-badging.txt`、`b5test-build.log`、`b5test-gradle.log`、`b5test-manifest-tree.txt` |
| **合计** | **11** | — |

行数核对（`git show --numstat 8dcab0a`）：11 个文件、新增 **766** 行、删除 0 行。

**一个过程细节（如实记录）**：首次提交只含 9 个文件（+562 行），因为两份构建日志被仓库全局忽略规则 `*.log` 排除；为完整归档证据，使用 `git add -f` 补入两份日志并 `--amend`，最终为 11 个文件（+766 行）。`8dcab0a` 即修订后的提交。

---

## 13. 设备验证状态（本轮复查）

- 检查时间：2026-11-19 22:22–22:30（Asia/Shanghai）
- `adb devices` 结果：**仅表头，无设备**（未连接/未授权）
- 因此 §8 的 9 项真机检查**全部保持"未验证"**，不标记通过。
- 验证脚本已升级为 9 项（本轮，语法校验通过），设备接入后一条命令即可产出证据：

```powershell
powershell -ExecutionPolicy Bypass -File scriptserify-b5test-apk.ps1
```

| # | 检查项 | 脚本对应 | 状态 |
|---|---|---|---|
| 1 | SHA-256 匹配 | CHECK1 | ⏳ 未验证 |
| 2 | 测试 APK 安装成功 | CHECK2 | ⏳ 未验证 |
| 3 | Beta.2 保持原样 | CHECK3（前后路径/版本/数据目录比对） | ⏳ 未验证 |
| 4 | 两应用并存 | CHECK4 | ⏳ 未验证 |
| 5 | 正常启动 | CHECK5 + 截图 | ⏳ 未验证 |
| 6 | Capacitor 插件与文件访问 | CHECK6（logcat + `run-as` 数据目录 + providers） | ⏳ 未验证 |
| 7 | 浅色/深色 | CHECK7（`cmd uimode` 切换 + 两主题截图，测后恢复） | ⏳ 未验证 |
| 8 | 底栏与布局视觉回归 | CHECK8 + 与 B4 真机截图对照 | ⏳ 未验证 |
| 9 | 崩溃/异常 | CHECK9（crash buffer + ANR 扫描 + 进程存活） | ⏳ 未验证 |

**说明**：脚本尚未在真机上执行过（无设备），属"已就绪待执行"，不代表验证通过。

---

## 14. 本轮（B5.1 补充）结论

- 未重新构建 APK：`FlowDay-5.0-a-B5test.1.apk` 大小/时间戳/SHA-256 与 8dcab0a 时一致。
- 未修改产品代码；未进入 B5.2；未合并 main；未打 Tag。
- 完成文件数量核对（§12）与验证脚本增强（§13），**B5.1 真机部分仍未审核通过**，保持等待设备。
