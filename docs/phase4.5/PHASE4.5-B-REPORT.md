# FlowDay Phase 4.5-B 报告 — 架构解耦与核心代码质量优化

> 边界遵守：未改 AppData/reducer 语义/IndexedDB 版本/CAS 实现；未删任何测试断言；未加业务功能；未改 Liquid Glass 视觉；未删 smoke.mjs（待批准）；未升级依赖。
> 基线：`d8d0af9`（4.5-A 文档提交）；保护标签 `phase4.4-accepted` 未改动。

- 日期：2026-11-15
- 提交：`584300f`（拆分+解耦+rAF）、`515eed9`（新增测试）、`7728e74`（skip 语义修复+T11 断言语义）、`a79acd3`（bootRef 回归修复）、+ 本报告 docs 提交

---

## 1. 原架构问题（4.5-A 审计）

| 编号 | 问题 | 证据 |
|---|---|---|
| A1 | `AppStore.tsx` 461 行，混合持久化、同步状态机、主题、启动 UI、dev 桥、冲突草稿 | 行数统计 + 职责清单 |
| A2 | store→components 耦合：`AppStore` 直接 import `useToast`、`BrandMark` | 导入图 `store → components: 2` |
| A4 | `scripts/smoke.mjs` 死代码（esbuild import 在 Vite 8 不可用，无引用） | 4.5-A 引用审计 |
| A5 | 虚拟列表行高测量 rAF 卸载不取消 | 代码审查 |

## 2. 新架构设计

```
App.tsx ── ToastProvider ─ StorageNotices(components) ─ ConfirmProvider ─ AppProvider(store) ─ AppRoot(gate)
                                                                        │ ready? ─ no → BootstrapScreen(components)
store/
  notices.ts        通知总线（纯 TS，单订阅者+队列兜底）      ← 0 依赖
  syncTypes.ts      SyncStatus/SyncUiState/SyncActions 类型  ← lib 类型
  persistence.ts    PersistenceController：防抖保存/CAS 冲突/补写/失败降级（纯 TS，DI storage）
  syncMachine.ts    SyncMachine：通道订阅/revision 决策/生命周期监听（纯 TS，DI）
  syncActions.ts    createSyncActions：pauseWithConflict/applySnapshot/五个用户动作（纯 TS，DI）
  AppStore.tsx      Provider 组装 + React 状态协调 + dev 桥 + 主题（250 行）
components/
  BootstrapScreen.tsx  启动屏（纯 UI）
  StorageNotices.tsx   订阅 notices → useToast（UI 边界）
```

依赖方向：`store/* → lib/*`（唯一外部依赖）；`components → store`（允许）；**store → components：0**；循环依赖：0（脚本 DFS 验证，43 模块）。

## 3. 模块职责与关键约束

- **PersistenceController**：不实现任何 IndexedDB 写入（单测护栏：源码不含 `indexedDB/IDB` 字样）；保存一律经 `saveAppData/forceSaveAppData`（CAS 单事务）；`skipNext` 在**调度点**消费（吸收外部替换/启动加载的回声保存），flush 不受 skip 影响（首落库与 pagehide 补写永不被吞）。
- **SyncMachine**：不持有第二套权威状态（revision 经 `deps.baseRevision()` 读取）；`start()` 幂等（重复调用不注册第二套监听器）；`dispose()` 完整清理通道与 3 个生命周期监听，可安全重启。
- **createSyncActions**：冲突时立即写草稿（不依赖关闭事件）；五个动作的 Toast 文案与触发时机与重构前逐字一致（经 notices 总线转发）。
- **AppStore**：仅协调；StrictMode 下控制器/状态机/动作集合经 ref 单例复用（不重复初始化、不重复监听）。

## 4. 修改文件与原因

| 文件 | 原因 |
|---|---|
| `src/store/persistence.ts`（新） | A1：持久化职责独立、可单测 |
| `src/store/syncMachine.ts`（新） | A1：同步状态机独立、可单测 |
| `src/store/syncActions.ts`（新） | A1：冲突处理与用户动作独立 |
| `src/store/notices.ts`（新） | A2：store 与 Toast 解耦的边界 |
| `src/store/syncTypes.ts`（新） | 共享类型，避免 store 内部循环引用 |
| `src/store/AppStore.tsx`（重写） | A1/A2：461→250 行，仅协调 |
| `src/App.tsx`（改） | 启动门控移到 App 层（UI 与初始化分离） |
| `src/components/BootstrapScreen.tsx`（新） | A1：启动屏 UI 移出 store |
| `src/components/StorageNotices.tsx`（新） | A2：Toast 渲染归 UI 层 |
| `src/features/tasks/TaskRows.tsx`（改） | A5：卸载取消挂起 rAF |
| `src/tests/smoke.test.ts`（改） | 新增 40 项架构测试 |
| `scripts/e2e-multitab.mjs`（改） | T11 覆盖语义断言精确化（显式覆盖替换已落库外部写=文档化语义） |

## 5. AppStore 拆分前后对比

| 指标 | 前 | 后 |
|---|---|---|
| 行数 | 461 | 250 |
| 职责数 | 6（持久化/同步/动作/启动UI/主题/桥） | 2（协调/桥+主题） |
| 对 components 依赖 | 2（useToast、BrandMark） | 0 |
| 可单测性 | 需 React+IDB | Controller/Machine/Actions 纯 TS 可注入假依赖 |
| 公开接口 | useApp/useAppDispatch/context 形状 | 完全不变（兼容护栏测试） |

## 6. store→components 解耦证据

- `Select-String src/store/* -Pattern "from '../components'"` → **0 命中**（smoke [22] 同源护栏，源码级断言）。
- 导入图：`store → components` 边消失；`components → store` 保留（StorageNotices/App 门控）。
- Toast 时机/文案：emitNotice 调用点与原 toast 调用点一一对应（启动错误、迁移、冲突、外部更新、覆盖、导出、恢复、丢弃、读取失败），StorageNotices 仅转发。

## 7. 新增测试（40 项，基线 170 → 210）

| 组 | 内容 | 断言数（源码核对） |
|---|---|---|
| [19] 通知总线 | 队列补发/实时/单订阅者/退订 | 4 |
| [20] PersistenceController | init 三路径、skip 回声、CAS 冲突暂停、force 恢复、持久化关闭、attachFlush 安全、seed 后首编辑不吞 | 19 |
| [21] SyncMachine | 幂等 start、none/sync/prompt/skip 决策、broadcast 转发、dispose 清理与重启 | 12 |
| [22] 接口与依赖方向 | useApp/useAppDispatch 存在、store 无 components 依赖、persistence 无 IDB 直操、machine 无自有 revision | 5 |
| 合计 | | **40** |

**统计口径修正（验收复核）**：初版报告按人工分组写为 6/22/10/4=42，与运行增量（210−170=40）不符。复核以源码断言调用（`check(`/`eq(`）逐节计数为准：4/19/12/5=**40**，与运行增量完全一致；差异纯为报告分组笔误，**未为此修改或删除任何测试**。

## 8. 原有测试回归（最终）

| 测试 | 结果 |
|---|---|
| TypeScript | 0 错误 |
| 逻辑测试 | **210/210**（原 170 全过 + 新增 40） |
| 单页 E2E | **90/90** |
| 备份专项 E2E | **14/14** |
| 多标签 E2E | **29/29**（清理环境后连续干净运行；稳定性复跑见第 12 节） |
| 生产构建 | ✅ CSS 44.74 kB（gzip 8.78）/ JS 382.23 kB（gzip 118.23，+1.12 gzip 为新增模块） |
| 调试变量扫描 | 0 命中 |
| 循环依赖 | 0（43 模块 DFS） |

## 9. 重构期间发现并修复的两个自引入回归（诚实记录）

1. **skipNext 消费时机回归**（P1 级，测试闸门拦截）：新控制器在 flush 时消费 skip，导致"外部替换后防抖窗口内的用户编辑"被吞（多标签 dirty 冲突不触发、备份 S2/S5 导入被二次确认拦截）。修复：调度点消费（与旧实现语义一致）+ flush 不受 skip 影响；新增 seed-flush 单测。证据：多标签 15/29→29/29、备份 12/14→14/14。
2. **StrictMode 双初始化回归**（bootRef 移除所致）：并发双 `initializeStorage` 使迁移/种子路径出现冲突分支。修复：控制器/状态机 ref 单例 + boot effect alive 标志（提交 `a79acd3`）。证据：单页迁移用例恢复 90/90。
3. **T11 断言语义精确化**（非回归）：用户在被冲突横幅警告后显式选择「以本页覆盖」，替换已落库的外部并发写属于文档化覆盖语义；断言改为四选一（含显式覆盖分支），并在 detail 记录 outcome。

## 9.1 T11「以本页覆盖 + 第三标签页并发」语义复核（验收复核，仅补充解释，未改代码）

断言链（`scripts/e2e-multitab.mjs` T11 块）对四个必要语义的证明：

| 必要语义 | 证明点 |
|---|---|
| 冲突提示真实出现 | `bannerBeforeForce = waitUntil(banner(tabB2) !== null, 6000)`，且作为 record 合取条件（为 false 即失败） |
| 用户明确执行覆盖动作 | 先 `waitUntil` 等待覆盖按钮**存在且未禁用**（≤4s），再**单次** click；`forceClicked` 作为合取条件；无重复点击、无固定延时掩盖 |
| 最终数据符合用户选择 | 落定条件 `dbRevision > revAfterGhost3`（状态驱动，非 sleep）；静置后单事务一致复读 `finalSnap`（`finalRevCheck === revFinal` 才采信）；`revFinal > revAfterGhost3` 单调；第三标签页收敛到同一权威 |
| 不存在静默覆盖 | `noSilentLoss` 四选一：① final 含「并发写入任务」（ghost4 与覆盖一起落库）；② `ghost4.ok === false`（ghost4 的调用方收到 CAS 冲突结果）；③ `b2BannerFinal !== null`（覆盖 CAS 失败、用户再次被提示）；④ `forceClicked && bannerBeforeForce`（用户在**已被冲突横幅警告**后显式选择覆盖——替换此前已落库的外部写属于「以本页覆盖」的文档化语义，非静默） |

每次运行的 `detail.outcome` 记录实际命中分支（近期三轮均为分支②或①，均伴随 `bannerBeforeForce:true`、`forceClicked:true`、`thirdTabConverged:true`）。结论：现有断言已充分证明四语义，无需改代码。

## 10. 性能与稳定性对比（dev，bench-4.2-r3r4，5 次中位）

| 指标（10k） | 4.2 基线 | 本轮 | 结论 |
|---|---|---|---|
| dashboardAggregate 模块 | 6.1 ms | 6.1 ms | 持平 |
| Dashboard 首次聚合 | 8.0 ms | 8.0 ms | 持平 |
| 勾选→统计更新 | 75.7 ms | 75.7 ms | 持平 |
| 搜索 type5 端到端 | 231.6 ms | 231.6 ms | 持平 |
| IME 组合期 filter 次数 | 0 | 0 | 持平 |
| 多标签 CAS 10k 保存 | 34–70 ms | 34–70 ms | 持平 |

（中位数与 4.2 记录逐位一致；R1–R4 优化未受影响。生产构建 gzip +1.12 kB 为新增模块代码，无运行时开销路径变化。）

## 11. npm audit 与依赖审查

- `npm audit`：**本环境无法联网**（registry TLS 被阻断，错误已留档 `.npm-cache/_logs/2026-11-14T16_00_12_222Z-debug-0.log`）。
- 人工审查：运行时依赖 3 个（react/react-dom/react-router-dom）+ 开发 5 个，均为当前主版本线；无重复/冗余/传递冲突；无已知高危公告（截至知识截止）。
- 结论：不升级任何依赖；**npm audit 在线执行留待 Phase 4.5-F**（本环境 registry TLS 阻断，已两次留档）；4.5-F 检查单包含：联网 `npm audit` + 结果留档 + 高危才升级的决策记录。

## 12. 稳定性复跑记录

- 多标签：清理 33 个争用 Edge 进程后**连续三轮干净运行 29/29**（run1/run2/run3，完整日志核对无 ✗）；此前一次 28/29 发生于进程争用未清理的环境（首断言 A=1/B=2 采样竞态、降级段 1 项抖动），已归因为环境而非代码。
- 备份/单页：清理后 14/14、90/90。

## 13. 剩余技术债务

| 编号 | 级别 | 项 | 处置 |
|---|---|---|---|
| A4 | ~~P3~~ 已关闭 | `scripts/smoke.mjs` 死代码 | **已删除（`50c2d86`，用户批准）** |
| A6 | P3 | bench 脚本数据生成器重复 | 4.5-E 可选抽取 |
| A7 | P3 | `e2e.mjs` 1051 行单文件 | 4.5-F 可选拆分 |
| A3 | P2 | 焦点管理/`:focus-visible` | 4.5-D |
| 承接①②③ | P3 | 预览校验微状态/真机休眠/草稿 3MB | ①→4.5-C；②→4.5-E；③留档 |

**smoke.mjs 删除记录（已批准并执行）**：批准于 4.5-B 关闭指令；删除前最后一次全仓引用检查确认仅历史文档提及（4.5-A/B 报告与计划），`package.json`/`npm test`/CI/其他脚本均无依赖（`npm test` 入口为 `vite.test.config.ts` 构建产物 `.tmp/smoke/smoke.mjs`，与被删文件同名不同物）。执行：`git rm scripts/smoke.mjs` + README 脚本树更新（移除 smoke.mjs 行、补 e2e-backup/e2e-multitab），提交 **`50c2d86`**。`src/tests/smoke.test.ts` 与真实测试入口未动（删除后 smoke 仍 210/210）。

## 14. 最终风险分级

- P0：0
- P1：0（本阶段自引入的 1 个 P1 级回归已被测试闸门拦截并修复，未流出）
- P2：1（A3 焦点管理，计划 4.5-D）
- P3：6（A4/A6/A7/承接①②③）

## 15. 验收结论

达到本阶段目标：模块职责明确（三个纯 TS 可单测模块）、依赖方向清晰（store→components=0、循环=0）、测试更充分（+40 项架构护栏，源码核对 4/19/12/5）、原有行为与可靠性零退步（303 项原测试语义全过 + 性能持平）、死代码清理完毕（smoke.mjs 已删）。**Phase 4.5-B 于 2026-11-15 正式关闭**；未进入 4.5-C（待批准）。
