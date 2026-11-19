# Phase 5.0-B · B4 最终验收归档报告

> **验收结论：B4 最终验收通过**（2026-11-19，人工验收决定）
> 验收范围：Liquid Glass v3 光学材质升级（Phase 5.0-B4）
> **最终验收 SHA：`5339589f0577fa0fd0a70476fa19ead7001fe27a`**
> 分支：`phase5.0-a` · 基线（B3 验收版）：`5362cff2fc3724e7c346381933c56123a3622d21`
> 冻结状态：HEAD 未变 · 已跟踪文件 0 改动 · 0 新提交 · `main`/`phase4.5-accepted` 仍为 `d6297ab` · 未构建 APK · 未进入 B5 实开发

---

## 1. 验收决定（正式记录）

| # | 验收项 | 结论 | 依据 |
|---|---|---|---|
| 1 | B4 液态玻璃技术实现 | **通过** | 双边缘/折射带/三层材质/环境染色/动态镜面/按压反馈全部落地且有自动化与真机证据 |
| 2 | 浅色与深色材质 | **通过** | 浅色暗边定形、深色镜面自然；对比度 42 探针 0 失败（最低 4.66:1）；真机 ΔL 外 −0.36/−0.28、内 +0.47/+0.29 |
| 3 | 动态镜面效果 | **通过** | `--lg-scroll` 驱动 ±8px/ −3px 合成层位移；滚动录屏无闪烁；真机 Janky 1.02% |
| 4 | 滚动性能 | **通过** | p95 16.70ms、长帧 0（模拟）；真机 50th 14ms、Janky 1.02%（29/2840） |
| 5 | 按压光学反馈 | **通过** | 真机量化：缩放 −8.7%、下缘 +3.75 L、松手完全复位、<200ms 收敛、按住无抖动 |
| 6 | 屏幕亮度适应 | **通过（人工）** | 人工在 vivo X200s 上完成 20%/60%/100% 三档目视，未发现明显视觉问题 |
| 7 | 页面尺寸适配 | **通过** | 320/360/390/412dp + 横屏真机验证无溢出；B2 67/67 复跑 |
| 8 | Android 系统 Insets | **转入 B5** | 需 APK edge-to-edge 环境判定；真机真实 Insets 已采（见 §4） |
| 9 | 系统字体缩放 | **转入 B5** | 浏览器不应用系统字体缩放，需 WebView/APK 验证 |

---

## 2. 冻结与仓库状态（归档时实测）

```text
$ git rev-parse HEAD
5339589f0577fa0fd0a70476fa19ead7001fe27a      ← 最终验收 SHA

$ git diff --stat ; git diff --cached --stat
（均为空）                                       ← 已跟踪文件 0 改动

$ git rev-list --count 5339589..HEAD
0                                              ← 验收后无新提交

$ git rev-parse --short main ; git rev-parse --short phase4.5-accepted^{}
d6297ab ; d6297ab                              ← main / Tag 未动
```

| 项 | 状态 |
|---|---|
| 产品代码（`src/`） | **冻结，不再修改**（自 B4 提交后 0 改动） |
| 新提交 | **0**（验收材料以 untracked 形式保留，共 66 个） |
| APK | **未构建**（`release/android/` 仍为 Beta.1 / Beta.2 原包，时间戳未变） |
| `main` 合并 / Tag | **均未执行** |
| B5 | **未开始任何实际开发**（仅提交本计划） |

---

## 3. B4 交付内容（相对 B3 基线 `5362cff` → `5339589`）

| 分类 | 文件数 | 变更 |
|---|---|---|
| **产品代码** | **4** | **+380 / −3** |
| 测试脚本 | 1（`scripts/b4-visual.mjs`） | +241 |
| 文档 | 1（`PHASE-B4-REPORT.md`） | +179 |
| 证据 | 49（对比图/近景/连续帧/对比度/JSON） | 二进制 45 + JSON 4 |
| **合计** | **55** | **+2475 / −3** |

产品代码明细：

| 文件 | 变更 | 作用 |
|---|---|---|
| `src/styles.liquid-glass.v3.css`（新增） | +369 | v3 光学 Token、三层材质、折射带、双边缘、动态镜面、按压反馈、降级守卫 |
| `src/lib/liquidGlass.ts` | +7 / −1 | 新增去饱和 `--lg-ambient-soft` |
| `src/styles.liquid-glass.css` | +3 / −2 | 默认值 + 深色玻璃文字提亮（保 AA） |
| `src/main.tsx` | +1 | 引入 v3 样式 |

---

## 4. 测试与真机证据摘要

### 4.1 自动化回归（B4 提交时全绿）

| 套件 | 结果 |
|---|---|
| B2 验收（Insets/响应式） | **67 / 67** |
| B3 验收（键盘/弹窗） | **99 / 99** |
| PWA（preview 构建） | **14 / 14** |
| 逻辑测试 | **369 / 369** |
| 主 E2E / 无障碍 / 备份 | 91 / 35 / 14 |
| 多标签 / 项目 / 撤销 / 引导 / 数据安全 | 29 / 30 / 20 / 16 / 14 |
| 视觉·溢出 / 性能 | 73 / 73 · 7 / 7 |

### 4.2 性能与可读性

- 滚动（模拟）：avg **16.56ms** / p95 **16.70ms** / 长帧 **0**
- 10k 任务保存：**350ms**（同机基线 350ms，容差 385ms）
- 对比度：42 探针 **0 失败**，最低深色 4.66:1 / 浅色 5.13:1
- 合成层：移动端 backdrop 元素 6 个、二次采样 2 个、L1 模糊 ≤16px

### 4.3 vivo X200s 真机事实（实采，作为 B5 基线）

| 项 | 值 |
|---|---|
| 型号 / 系统 | V2458A / OriginOS 17 |
| API Level | **37** |
| WebView | **157.0.8103.38** |
| 屏幕 | 1260×2800 @560dpi → CSS 360×800dp（DPR 3.5） |
| 导航方式 | 手势（`navigation_mode=2`） |
| **真实 Insets** | 状态栏 **42dp** · 手势条 **18dp** · 挖孔 **35.7dp** |
| 真机帧统计 | Janky **1.02%**（29/2840）· 50th **14ms** |
| 已装应用 | `app.flowday.beta` 5.0-a-beta.2 |

### 4.4 B4 期间发现并修复的两处真实回归（已随提交修复）

| 问题 | 根因 | 修复结果 |
|---|---|---|
| 全宽度横向溢出 +11px（B2 一度 56/67） | 镜面高光平移 +24px 越出元素边界 | 位移改对称 −8…+8px、左右内缩 10px → `390/390`，B2 67/67 |
| 深色玻璃文字对比度 4.10:1 | v3 深色环境反光过亮 | 染色 11%→9%、反光 20%→12%、文字提亮 → 0 失败（4.66） |

---

## 5. 证据归档

### 5.1 归档清单（含 SHA-256）

| 文件 | 说明 |
|---|---|
| `docs/phase5.0/PHASE-B4-ARCHIVE-MANIFEST.md` | **归档主清单**：115 个文件 / 98.1 MB / 每个文件 SHA-256（前 16 位） |
| `docs/phase5.0/phase-b4-device-acceptance/archive-manifest.json` | 机器可读清单（完整 SHA-256、字节数） |

校验方式（任选）：

```powershell
# 单文件校验
(Get-FileHash docs\phase5.0\phase-b4-device-acceptance\press-03-recording.mp4 -Algorithm SHA256).Hash
# 批量复核（对照 archive-manifest.json）
node -e "const m=require('./docs/phase5.0/phase-b4-device-acceptance/archive-manifest.json');console.log(m.fileCount,'files',m.totalBytes,'bytes')"
```

### 5.2 证据目录

| 目录 | 内容 | 规模 |
|---|---|---|
| `docs/phase5.0/phase-b4-evidence/` | Beta.2→v3 对比图、近景、滚动连续帧、42 探针对比度、汇总 JSON | 49 文件 / 13.7 MB |
| `docs/phase5.0/phase-b4-device-acceptance/` | **真机证据**：设备事实、浅/深色截图、近景、滚动录屏与帧、按压录屏与帧、亮度三档、尺寸变体、字体缩放、归档清单 | 52 文件 / 84.3 MB |
| `docs/phase5.0/PHASE-B4-REPORT.md` | B4 实施报告 | — |
| `docs/phase5.0/PHASE-B4-DEVICE-ACCEPTANCE-PREP.md` | 真机验收准备（九项判据/工具/流程） | — |
| `docs/phase5.0/PHASE-B4-DEVICE-ACCEPTANCE-REPORT.md` | 真机验收报告（九项逐项） | — |
| `docs/phase5.0/PHASE-B4-FINAL-SUPPLEMENT.md` | ⑥⑧ 补充、边缘尺寸、九项汇总 | — |
| `docs/phase5.0/PHASE-B4-FINAL-ACCEPTANCE.md` | **本归档报告** | — |
| `scripts/device-acceptance.ps1` | 真机采集工具（只读） | — |

### 5.3 复现与再验证入口

```powershell
npm.cmd run dev                                  # 前端
node scripts/b2-verify.mjs                       # 67 项
node scripts/b3-verify.mjs                       # 99 项
node scripts/lg-capture.mjs after                # 视觉/溢出 73 项
node scripts/perf-5a.mjs                         # 性能 7 项
node scripts/b4-visual.mjs                       # B4 视觉证据重生成
powershell -File scripts/device-acceptance.ps1 -Action info   # 真机事实
```

---

## 6. 遗留与转入 B5 的已知事项

| # | 事项 | 现状 | 归属 |
|---|---|---|---|
| 1 | Android edge-to-edge Insets（状态栏/手势条/挖孔/横屏） | Chrome 阶段不可判定；真实 Insets 已采（42/18/35.7dp） | **B5 APK 验收** |
| 2 | 系统字体缩放 130%/150% | 浏览器不应用系统字体缩放 | **B5 APK 验收** |
| 3 | 低端 WebView / 旧设备渲染降级 | 已有 `@supports`、reduced-transparency 降级；未在低端真机验证 | B5 复核 |
| 4 | 折射为等效模拟（无背景几何位移） | 已在报告与 CSS 注释声明 | 维持设计（不在 B5 扩展） |
| 5 | `e2e-final-4.5f.mjs` 历史套件 19/25 | 与后续阶段演进不同步，未作门槛 | 维持现状 |
| 6 | 真机按压证据为注入触摸（非手指） | 已量化并附 30 秒手指复核协议 | 验收已由人工确认通过 |

---

## 7. 签署

| 项 | 值 |
|---|---|
| 阶段 | Phase 5.0-B4（Liquid Glass v3 光学材质升级） |
| 验收结论 | **最终验收通过** |
| 最终验收 SHA | `5339589f0577fa0fd0a70476fa19ead7001fe27a` |
| 验收日期 | 2026-11-19 |
| 冻结约定 | 不再修改 B4 产品代码；不合并 main；不打 Tag；不构建正式发布 APK |
| 后续 | 提交 B5 开发计划（见 `PHASE-B5-PLAN.md`），**未获批准前不开始 B5 实际开发** |

**B4 归档完成，停止工作，等待下一步指示。**
