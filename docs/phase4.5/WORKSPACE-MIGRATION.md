# FlowDay 专属工作区迁移记录

> 日期：2026-11-15
> 操作：将 FlowDay 项目从共享 DSH 工作区迁出，建立专属工作区并完整迁移
> 结论：**迁移完成并已在新工作区跑通全部回归**

## 一、路径变更

| 项 | 迁移前 | 迁移后 |
|---|---|---|
| 项目根（含 `.git`） | `F:\DeepSeekHarness\default-workspace\flowday`（经 `C:\Users\<用户名>\Documents\deepseek-harness\default-workspace` 联接访问） | **`F:\DeepSeekHarness\FlowDay`** |
| Dev server | 5173（旧目录） | **5173（新目录，已切换并验证）** |
| 会话工作目录 | 旧目录 | **`F:\DeepSeekHarness\FlowDay`** |

迁移前旧目录体积约 1.26 GB（含 `node_modules`、`dist`、`.npm-cache`、`.tmp`），删除后 F: 盘释放约 1.1 GB。

## 二、迁移方式

1. **Git 完整克隆**：`git clone --no-hardlinks <旧目录> F:\DeepSeekHarness\FlowDay`
   - 保留全部 39 个提交、3 个验收标签（`phase4.4-accepted` / `phase4.5-d-accepted` / `phase4.5-e-accepted`）与分支 `phase4.5-f-final`；
   - HEAD 保持 `52d2e8dc1ab41fa620db39cce603db73d9fc9bac`；399 个受版本控制文件全部迁移（含 docs 历史报告、性能数据、截图证据）。
2. **依赖重建**：`npm ci`（使用工作区内 `.npm-cache`，离线缓存随迁）。
3. **产物重建**：`npm run build` 生成 `dist/`。
4. **被 gitignore 但仍有用的辅助件单独复制**：`scripts/_a11y_audit.py`、`scripts/_audit_graph.py`、`scripts/_fix_mt10.py`、`tools/`（PDF 导出脚本，不含其 `node_modules`/`.npm-cache`，可按需 `npm ci` 重建）。
5. **未迁移（可再生/临时）**：`.tmp/` 构建临时目录、`.npm-cache/`（在新位置重建）、`node_modules/`、`dist/`、被忽略的调试日志。
6. **旧目录已删除**（删除前已核对解析路径与体积，并确认旧仓库与克隆 HEAD 完全一致、无未提交改动）。

## 三、迁移后验证（全部在新工作区执行）

| 项 | 结果 |
|---|---|
| `git rev-parse HEAD` / 分支 / 标签 | ✅ `52d2e8d` / `phase4.5-f-final` / 3 个标签齐全 |
| `git status` | ✅ clean |
| `npm ci` | ✅ 成功（0 错误） |
| `npm run typecheck` | ✅ 0 错误 |
| `npm test` | ✅ **231/231** |
| `npm run build` | ✅ JS 387.67 kB（gzip 119.98）/ CSS 49.42 kB |
| 生产构建调试变量扫描 | ✅ 0 命中 |
| 循环依赖 | ✅ 0（43 模块） |
| 单页 E2E | ✅ **90/90** |
| 备份专项 E2E | ✅ **14/14** |
| 多标签 E2E | ✅ **29/29** |
| 无障碍 E2E | ✅ **35/35** |
| 存储压力 | ✅ **9/9** |
| 多标签长期压力 | ✅ **15/15** |
| Dev server（5173，新目录） | ✅ HTTP 200，页面与 `/src/main.tsx` 正常 |
| 删除旧目录后 5173 仍可用 | ✅（证明服务来自新工作区） |

## 四、目录结构（新工作区）

```
F:\DeepSeekHarness\FlowDay\
├── .git\                 完整历史（39 提交 / 3 标签）
├── src\                  应用源码
├── scripts\              基准/压力/E2E 脚本 + 被忽略的审计辅助脚本
├── public\bench-blank.html
├── docs\                 各阶段报告、性能数据、截图证据
│   └── phase4.5\         含本报告与 PHASE4.5-FINAL-ACCEPTANCE-REPORT.md
├── tools\                PDF 导出辅助（可选）
├── index.html / vite.config.ts / package.json / package-lock.json
├── node_modules\         npm ci 重建
└── dist\                 build 产物
```

## 五、运维注意

- **F 盘请勿改盘符/格式化**：该盘同时承载 DSH 数据根（`F:\DeepSeekHarness\.dsh` + 共享工作区），盘符变化会导致 C: 联接与项目路径同时失效。
- `F:\DeepSeekHarness` 已按 DSH 迁移说明授予当前用户完全控制；新增子目录经继承生效，沙箱（workspace-write）可正常写入。
- 启动：`cd F:\DeepSeekHarness\FlowDay && npm run dev`（默认 5173）。
- 若需再次搬迁：`git clone --no-hardlinks F:\DeepSeekHarness\FlowDay <新路径>` + `npm ci` 即可，标签与历史随 `.git` 保留。
- 备份：只需备份 `F:\DeepSeekHarness\FlowDay`（含 `.git`），不含 `node_modules`/`dist` 也可完全恢复。

## 六、DSH 菜单中的专属工作区（已注册）

迁移后已在 DSH 侧把本项目注册为一个**独立工作区**，不再混在默认工作区的会话列表里：

| 项 | 值 |
|---|---|
| 菜单显示名 | **FlowDay** |
| 工作区路径 | `F:\DeepSeekHarness\FlowDay` |
| 注册位置 | `F:\DeepSeekHarness\.dsh\storages\workspace.json`（`tables.workspaces` 中的 title/path/sessionIds） |
| 当前会话数 | 1 个（工作区建立时创建的空白「新会话」，可直接用于本项目对话） |
| 截图 | `screenshots-migration/dsh-workspace-menu.png`（脱敏版本） |

> 说明：该截图已脱敏——头像与显示名、与 FlowDay 无关的会话标题均作不透明遮挡，桌面与任务栏已裁除；未脱敏原图仅作内部审计证据保留，不纳入交付材料。

操作方式：左侧边栏「工作区」→ 点击 **FlowDay** → 在该工作区内「新会话」；此后该工作区的会话列表只出现 FlowDay 项目相关会话，默认工作区不受影响。

**已知限制（DSH 设计）**：DSH 不支持把已有会话移动到另一个工作区（会话右键仅有归档/置顶等操作）。迁移前那段对话仍归属默认工作区；若必须把旧会话也归入 FlowDay 工作区，需在退出 DSH 后修改工作区注册表中的 sessionIds 再重启，属破坏性操作，须人工确认后执行。

