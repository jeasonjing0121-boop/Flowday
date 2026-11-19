# FlowDay

> 把今天安排明白的 AI 个人效率工作台。
> **当前版本：v0.2.0 · Phase 1 液态玻璃视觉升级**（在 Phase 0 基础上完成 Liquid Glass 导航/顶栏/底栏/浮层材质、JSON 导入、头像菜单；本地数据持久化，AI 助手仍为演示模式）

## 当前阶段能做什么

| 模块 | 已实现（真实可用） |
|---|---|
| 今日 Dashboard | 问候与今日概览、完成进度环、今日焦点（逾期/优先级自动推荐）、今日时间线、习惯速打卡、近 7 天完成柱状图、Jing建议入口 |
| 任务 | 新建 / 编辑 / 删除（二次确认）/ 完成与撤销、优先级 P1–P4、截止日期与时间、分类、备注、分组（逾期/今天/即将/已完成）、筛选、刷新持久化 |
| 日历 | 月 / 周 / 日三视图、翻页与回到今天、**日视图拖拽排程**（15 分钟吸附、拖动改时间、拖回取消）、排时长、「排时间」精确排程、**时间冲突检测提示**、周起始日跟随设置 |
| 习惯 | 创建（图标 + 每周目标）、今日打卡 / 撤销、最近 7 天补卡、连续天数、本周完成进度、删除 |
| AI 助手「Jing」 | 对话界面、快捷指令、基于本地规则的「今日规划 / 目标拆解」提案、**确认执行后才会真正写入任务**、忽略不写入；明确标注演示模式，**不调用任何真实 AI API、不产生费用** |
| 设置 | 昵称、浅色 / 深色 / 跟随系统、周起始日、AI 开关、导出 / 导入 JSON 备份（导入覆盖前二次确认）、载入示例数据、清空本地数据、关于信息 |
| 全局 | 桌面侧边栏 + 移动底部导航、全局「新建任务」、响应式（360px–1440px）、示例数据明确标注、空状态 / 确认框 |

## 快速开始

环境要求：Node.js 18+（本项目使用 Node 24 开发），npm。

```bash
cd flowday
npm install        # 首次安装依赖（约 1 分钟）
npm run dev        # 启动开发服务器
```

打开 **http://127.0.0.1:5173/** 即可使用（手机与电脑同一局域网时，可用电脑 IP:5173 在手机访问；开发服务器默认只监听 127.0.0.1，需要手机访问时把 `vite.config.ts` 中 `server.host` 改为 `0.0.0.0`）。

其他命令：

```bash
npm run build      # TypeScript 类型检查 + 生产构建（输出 dist/）
npm run preview    # 预览生产构建
npm run typecheck  # 仅类型检查
npm test           # 纯逻辑冒烟测试（33 项断言，无网络请求）
```

> 浏览器 E2E 验证脚本：`node scripts/e2e.mjs`（需要本机 Edge 浏览器；会真实点击、校验 IndexedDB 状态与备份导入导出、并输出截图到 `docs/phase4/`）。

## 目录结构

```
flowday/
├── index.html
├── package.json              # 依赖与脚本
├── tsconfig.json             # 严格 TypeScript 配置
├── vite.config.ts            # Vite + React + Tailwind v4 插件
├── vite.test.config.ts       # 逻辑测试打包配置
├── scripts/
│   ├── e2e.mjs               # 浏览器 E2E + 截图（Edge CDP）
│   ├── e2e-backup.mjs        # 备份专项 E2E（预览/冲突/持久化/导出）
│   └── e2e-multitab.mjs      # 多标签一致性 E2E（CAS/冲突/草稿/降级）
├── src/
│   ├── main.tsx / App.tsx    # 入口与路由（/today /tasks /calendar /habits /assistant /settings）
│   ├── styles.css            # 设计令牌（晨光纸感 + 夜航深色）+ 组件样式
│   ├── types.ts              # 领域模型（Task / Habit / Settings / AppData）
│   ├── lib/                  # 纯逻辑：date 日期、data 校验与示例数据、selectors 统计、storage 数据访问层
│   ├── store/                # reducer（纯函数）+ AppStore（Context + IndexedDB 持久化 + 主题）
│   ├── components/           # AppShell（导航/全局新建）、Icons、UI（Modal/Segmented/进度环/空状态）
│   ├── features/             # 按页面划分：today / tasks / calendar / habits / assistant / settings
│   └── tests/smoke.test.ts   # 逻辑测试用例
└── docs/
    ├── plan/                 # 完整产品方案（PRD / 设计 / 架构 / 计划 / 商业）
    └── phase0/               # 本阶段测试报告与运行截图
        ├── e2e-report.json
        └── screenshots/      # 桌面 6 页 + 移动 3 页
```

## 数据与隐私

- 全部数据保存在浏览器 **IndexedDB**（数据库 `flowday-db`，对象存储 `app/meta`，记录含 `schemaVersion`），刷新/重开浏览器不丢失。
- 旧版 `LocalStorage`（键名 `flowday.v1`）数据在首次启动时自动校验并迁移到 IndexedDB，迁移后保留原数据与 `flowday.legacy-backup.v1` 回滚副本（不会立即清空）。
- 设置页可导出/导入带版本号的 JSON 备份；导入前校验版本与结构并二次确认，校验失败不改动现有数据。
- 业务组件不直接操作 IndexedDB：统一通过 `src/lib/storage` 数据访问层（`initializeStorage / saveAppData / resetAllData`）读写。
- 首次打开自动载入**示例数据**，界面顶部有明确提示，可在「今日」或「设置」里一键清空。
- 设置页支持**导出 JSON 备份**；数据结构（`AppData`）与方案中的云端模型对齐，未来接 Supabase 时可迁移。
- 本阶段没有任何后端、登录、支付；**未调用任何付费 API**，运行成本为 0。

## 设计说明（与方案一致）

- 视觉方向 A「晨光纸感」：暖纸底 `#FAF7F2` + 墨黑主操作 `#1C1A17` + 只在 AI 时刻使用的晨光渐变（琥珀 → 玫瑰 → 靛蓝）。
- 深色模式为独立设计的「夜航」主题（`#121318` 系），非简单反色，可在设置中切换。
- 字体使用系统中文字体栈；数字等宽（tabular-nums）；圆角、细边框、低阴影、克制留白。
- 响应式断点：手机单列 + 底部 Tab；桌面左侧栏 + 12 栅格内容区。

## 测试与验收结果（Phase 0）

| 检查项 | 结果 |
|---|---|
| TypeScript 类型检查 | ✅ 0 错误 |
| 纯逻辑冒烟测试 | ✅ 33 / 33 通过（日期、任务 reducer、习惯打卡、排序统计、AI 提案规则） |
| 浏览器 E2E（Edge，1440×900 + 390×844） | ✅ 30 / 30 通过，包含：页面渲染、任务创建→完成→删除、刷新持久化、习惯打卡与撤销、日历月/周/日切换与翻页、AI 提案确认写入、导航、移动端无横向溢出与底部导航固定、无控制台错误 |
| 生产构建 | ✅ 成功（JS 约 99KB gzip，CSS 约 6.7KB gzip） |
| 运行截图 | `docs/phase0/screenshots/`（desktop-today / tasks / calendar / habits / assistant / settings，mobile-today / tasks / assistant） |
| E2E 原始报告 | `docs/phase0/e2e-report.json` |

## 本阶段未实现（有意留到后续阶段）

- 登录注册、云端数据库、多端同步（当前数据仅在本机浏览器）
- 真实 AI 接入（后续通过服务端代理调用 DeepSeek 等，密钥不落前端；`src/features/assistant/mock.ts` 将替换为真实调用，提案确认流程不变）
- 日历拖拽排程、时间冲突检测、外部日历同步
- 任务标签、批量操作、搜索、回收站完整版；习惯热力图完整版
- 通知提醒、PWA 安装、深色之外的主题、多语言
- 支付 / 订阅 / 管理后台

## 扩展点（为后续阶段预留）

- `src/store/AppStore.tsx`：数据读写集中在这里，替换 `lib/data.ts` 的 `loadData/saveData` 即可接入云端。
- `src/features/assistant/mock.ts`：定义 `MockReply` 结构，替换为服务端代理返回即可，UI 与「确认后写入」逻辑无需改动。
- `src/lib/selectors.ts`：统计口径集中，方便新增图表与周报。
- 页面按 `features/` 划分，新增模块不影响既有页面。

## 开发说明

- 严格 TypeScript（`strict` + `noUnusedLocals`），无任何 `any` 兜底；构建前自动类型检查。
- 所有可能产生费用的能力（AI API、云服务、支付）**均未接入**；如后续需要开通，会先向你说明费用并取得同意。
- 方案文档见 `docs/plan/`（PDF 版：`docs/plan/FlowDay-完整方案-v1.0.pdf`）。
