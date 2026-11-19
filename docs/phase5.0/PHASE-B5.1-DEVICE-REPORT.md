# Phase 5.0-B5.1 · 真机验证报告（vivo X200s）

> 阶段：**B5.1 真机验证**（构建与静态审计已在 `8dcab0a` 通过；本报告为其真机部分）
> 分支：`phase5.0-b5` · 构建基线：`01587bc` · B4 冻结 SHA：`5339589`
> 设备：**vivo X200s（V2458A）** · API **37** · WebView **157.0.8103.38** · 1260×2800 @560dpi（360×800dp，DPR 3.5）· 手势导航
> 采集时间：2026-11-19 23:08–23:15（Asia/Shanghai）
> APK：`release/android/b5test/FlowDay-5.0-a-B5test.1.apk`（4,853,194 B，SHA-256 `61645357…c6de4`）

---

## 0. 结论摘要

| # | 检查项 | 结果 |
|---|---|---|
| 1 | SHA-256 匹配 | **通过** |
| 2 | 测试 APK 安装成功 | **通过** |
| 3 | Beta.2 保持原样（安装/版本/数据） | **通过** |
| 4 | 两个应用并存 | **通过** |
| 5 | 测试应用正常启动 | **通过** |
| 6 | Capacitor 插件与文件访问 | **通过**（Insets 桥接实测 42/18px；数据目录与 FileProvider 正常；日志告警已定性为非本轮回归） |
| 7 | 浅色 / 深色模式 | **通过**（应用内切换；系统夜间模式不切换的原因见 §7 说明） |
| 8 | 底部导航与布局视觉回归 | **通过**（与 B4 参考结构一致，见对比图） |
| 9 | 崩溃 / ANR / 进程异常 | **通过**（0 崩溃、0 ANR、进程存活） |

**九项全部获得真实设备证据支持。** 发现 1 项"非缺陷类观察"（§10-1：系统夜间模式不影响应用主题，因应用主题是显式值），以及 1 项日志噪声的定性结论（§10-2 Capacitor safe-area 提示来自历史缓冲，非本构建）。

---

## 1. 检查 1：SHA-256 匹配 —— 通过

- 脚本 `CHECK1`：本地产物哈希 `61645357097356541026dbe67a3dc1966166fecab5d3208ac308ad15ed9c6de4`，与 `release/android/b5test/SHA256.txt` **一致**（`matchManifest=True`）。
- 证据：`phase-b5-evidence/b5.1/device/device-verify.log`

## 2. 检查 2：测试 APK 安装成功 —— 通过

- `adb install -r` 输出：`Performing Streamed Install` → **`Success`**。
- 安装后包信息（真机实测）：
  - `versionCode=101` · `versionName=5.0-a-b5test.1`
  - `flags=[ DEBUGGABLE HAS_CODE ALLOW_CLEAR_USER_DATA ALLOW_BACKUP KILL_AFTER_RESTORE ]`
  - `dataDir=/data/user/0/app.flowday.beta.b5test` · `firstInstallTime=2026-11-19 23:08:34`
- 证据：`device-verify.log`、`post-state-b5test.txt`

## 3. 检查 3：Beta.2 保持原样 —— 通过

| 项 | 安装前 | 安装后 | 结论 |
|---|---|---|---|
| `pm path` | `…/app.flowday.beta-LKq-CrZ4CCwYgP9sumMpTQ==/base.apk` | 完全相同 | ✅ 未被覆盖 |
| versionCode / versionName | 2 / `5.0-a-beta.2` | 2 / `5.0-a-beta.2` | ✅ 未变 |
| firstInstallTime | 2026-11-18 12:13:07 | 2026-11-18 12:13:07 | ✅ 未重装 |
| lastUpdateTime | 2026-11-18 13:44:21 | 2026-11-18 13:44:21 | ✅ 未更新 |
| dataDir | `/data/user/0/app.flowday.beta` | 相同 | ✅ 数据目录未变 |

- **数据完好佐证**：启动 Beta.2 后截图显示其自有数据 **12 件任务 / 已完成 3 件**（与测试包 demo 数据"6 件 / 2 件"明显不同），说明其 IndexedDB 数据仍在。
- 全程**未执行**任何 `uninstall` / `pm clear` / `install` 到 Beta.2 的操作；仅对 `.b5test` 执行过 `pm clear`（测试包自清，见 §10-3 说明）。
- 证据：`pre-state-beta2.txt`、`post-state-beta2.txt`、`beta2-01-still-works.png`

## 4. 检查 4：两个应用并存 —— 通过

- `pm list packages` 同时命中 `app.flowday.beta` 与 `app.flowday.beta.b5test`。
- 运行态：两进程**同时存活**（`b5test pid=8813`、`beta pid=9855`）。
- 证据：`device-verify.log`、`pre-state-packages.txt`

## 5. 检查 5：正常启动 —— 通过

- `am start -W` 后前台 Activity：`app.flowday.beta.b5test/app.flowday.beta.MainActivity`。
- 首屏渲染正常（玻璃页头、导航、卡片、示例数据提示均在）；无白屏。
- **内嵌版本标识正确**：设置页显示 `测试版本：5.0-a-b5test.1（versionCode 101）· 构建 2026/11/19 19:14:41 · commit 01587bc`。
- 证据：`b5test-01-launch.png`、`b5test-09-settings.png`、`device-verify.log`

## 6. 检查 6：Capacitor 插件与文件访问 —— 通过

| 子项 | 实测 |
|---|---|
| 原生 Insets 桥接 | CDP 读取：`--lg-safe-top: **42px**`、`--lg-safe-bottom: **18px**`、`--lg-safe-left/right: 0px`、`--lg-ime: 0px`、`--fd-nav-h: 58px` → 与 `dumpsys window` 原生值（42dp/18dp）**完全一致**，证明 `FlowDayNative` 桥接与推送链路正常 |
| WebView 存储 | `run-as` 列出 `app_webview/Default/{IndexedDB(https_localhost_0), Local Storage, Session Storage, Cookies…}`、`shared_prefs`、`files`、`cache` → 应用可正常读写本地存储 |
| FileProvider | 声明 `app.flowday.beta.b5test/androidx.core.content.FileProvider`，authorities `app.flowday.beta.b5test.fileprovider`、`…androidx-startup` → 备份导出能力所需组件就绪，且与 Beta.2 不冲突 |
| 资源加载 | 页面 `https://localhost/today` 加载成功，无白屏、无资源 404 致命错误 |
| 日志告警 | 首轮脚本抓到：`W/Capacitor: Unable to read file at path public/plugins`、3 条 `E/Capacitor/Console: Error injecting safe area CSS …null style`（pid **5974**，非当前进程 8813）。**清空 logcat 后重测 Beta.2 与 B5test 均 0 条**；对测试包 `pm clear` 后首启复测同样 **0 条** → 判定为**历史缓冲中的旧进程日志**，非本构建缺陷 |

- 证据：`b5test-capacitor-log.txt`、`b5test-safearea-errors.txt`、`b5test-first-launch-safearea-errors.txt`、`beta2-safearea-errors.txt`、`crash-buffer.txt`（均落盘）

## 7. 检查 7：浅色 / 深色模式 —— 通过（附方法说明）

- **首轮脚本**用系统夜间模式切换（`cmd uimode night no/yes`）后截图：**03-light 与 04-dark 字节完全相同**。原因已定位：应用主题为**显式浅色**（全新安装默认），系统夜间模式不会覆盖应用内主题——这是应用既有设计，不是缺陷。
- **改用应用内切换（真实交互）**：通过 debug 包 WebView 调试通道（CDP）点击「账户菜单 → 切换到深色」，`data-theme` 由 `light` → `dark`、`body` 背景 `rgb(245,245,247)` → `rgb(5,6,10)`，随后取真实设备截图。
- 结果：
  - 浅色：玻璃双边缘、卡片、导航清晰（`b5test-08-light-clean.png`）
  - 深色：深色玻璃材质、镜面与边缘正常，未发灰/过亮（`b5test-07-dark-clean.png`、`b5test-06-dark-real.png`）
- 切回浅色后状态恢复（`b5test-08`）。
- 说明：B4 的深色/浅色验收正是通过应用内切换完成的，本机行为一致。

## 8. 检查 8：底部导航与布局视觉回归 —— 通过（人工目视 + 对比图）

- 对比对象：B4 真机证据（浏览器阶段）vs 当前 APK。
- 对比图：
  - 浅色：[compare-nav-light.png](phase-b5-evidence/b5.1/device/compare-nav-light.png)
  - 深色：[compare-nav-dark.png](phase-b5-evidence/b5.1/device/compare-nav-dark.png)
- 目视结论：
  - 5 个导航项（今日/任务/日历/习惯/Jing）、图标与文案、选中胶囊形态、玻璃双边缘与底部环境染色**结构一致**；
  - 无文字截断、无图标错位、无底栏遮挡内容、无横向溢出；
  - 页面布局（页头/示例数据条/问候语/完成环/今日焦点/卡片）与 B4 一致；
  - 深色底栏色相与 B4 略有差异（APK 与浏览器页面背景不同 → 环境色采样不同），属离线采样机制的正常范围，非版式回归。
- 证据：`b5test-05-nav-region.png`、`compare-nav-{light,dark}.png`、`b5test-0{7,8}-*.png`

## 9. 检查 9：崩溃 / ANR / 进程异常 —— 通过

| 项 | 结果 |
|---|---|
| crash buffer 中含 `app.flowday` / `FATAL EXCEPTION` / `AndroidRuntime` | **0 条** |
| `logcat -b events` 中 `am_crash` / `am_anr` | **0 条** |
| 测试应用进程 | 存活（`pidof` 有值，启动后持续运行） |
| 明显异常 | 无白屏、无 ANR 对话框、无闪退（含浅/深色切换与多次重启） |

- 证据：`crash-buffer.txt`、`crash-events.txt`、`device-verify.log`

---

## 10. 观察项与说明（非缺陷）

| # | 观察 | 影响 | 结论 |
|---|---|---|---|
| 1 | 系统夜间模式不改变应用主题（应用主题是显式值） | 测试方法需调整 | **设计行为**；验收时应在应用内切换（B4 亦如此） |
| 2 | 首轮日志中的 Capacitor `public/plugins` 与 save-area 提示 | 无功能影响 | pid 5974 为旧进程日志；清缓冲后 0 复现 |
| 3 | 为复现首启，执行过 `pm clear app.flowday.beta.b5test` | 仅清理测试包数据 | **Beta.2 未受影响**（§3 已证） |
| 4 | Debug 构建（可调试、4.63MB） | 不代表发布性能 | B5.5 性能验证将使用 release 构建 |

---

## 11. 证据清单（`docs/phase5.0/phase-b5-evidence/b5.1/device/`）

| 类别 | 文件 |
|---|---|
| 截图（浅/深/首启/设置） | `b5test-01-launch.png`、`b5test-02-main.png`、`b5test-03-light.png`、`b5test-04-dark.png`(系统夜间尝试，与03相同)、`b5test-05-nav-region.png`、`b5test-06-dark-real.png`、`b5test-07-dark-clean.png`、`b5test-08-light-clean.png`、`b5test-09-settings.png`、`b5test-10-first-launch.png` |
| Beta.2 对照 | `beta2-01-still-works.png` |
| 导航对比 | `compare-nav-light.png`、`compare-nav-dark.png` |
| 执行日志 | `device-verify.log` |
| 状态快照 | `pre-state-packages.txt`、`pre-state-beta2.txt`、`post-state-beta2.txt`、`post-state-b5test.txt` |
| 日志证据 | `b5test-capacitor-log.txt`、`b5test-safearea-errors.txt`、`b5test-first-launch-safearea-errors.txt`、`beta2-capacitor-log.txt`、`beta2-safearea-errors.txt`、`crash-buffer.txt`、`crash-events.txt` |

---

## 12. Git 与冻结

| 项 | 值 |
|---|---|
| 分支 | `phase5.0-b5` |
| 本报告提交 SHA | 见提交结果（仅 docs + 证据） |
| B5.1 基线 SHA | `8dcab0aa2206031624896ae988d4e21baf621f57`（保留） |
| 补充提交 SHA | `5c99a8701a4fd6a105bcccb57e97636f079caefb`（保留） |
| B4 冻结 SHA | `5339589f0577fa0fd0a70476fa19ead7001fe27a`（`phase5.0-a` 未动） |
| `main` / Tag | `d6297ab` / `d6297ab`（未动） |
| 产品代码改动 | **0**（本阶段仅验证与证据） |
| APK 重建 | **未重建**（哈希与 `8dcab0a` 时一致） |
| B5.2 | **未开始** |

**B5.1 真机验证完成，九项全部通过。停止工作，等待人工最终验收与 B5.2 授权。**
