// Phase 5.0-a D3 专项 E2E：删除撤销（8s 窗口）、连续删除、路由切换、刷新、多标签
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_BASE as BASE,
  click,
  makeRunner,
  navigate,
  openTab,
  seedAppState,
  startBrowser,
  stopBrowser,
  wait,
  waitFor,
  waitForBrowser,
} from './lib/e2e-harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', '.tmp', 'e2e-5a');
const R = makeRunner('e2e-undo');
const browser = startBrowser({ port: 9520 });
const today = new Date().toISOString().slice(0, 10);

const task = (id, title) => ({
  id,
  title,
  date: today,
  priority: 3,
  completed: false,
  createdAt: new Date().toISOString(),
  source: 'manual',
});

const seed = (tasks) => ({
  version: 1,
  tasks,
  projects: [],
  habits: [],
  habitLogs: [],
  settings: { name: '', theme: 'light', weekStart: 1, aiEnabled: true, demoData: false, onboarded: true },
});

const appState = (cdp) => cdp.evaluate('window.__FD_STATE__ || null');
const hasUndoAction = (cdp) => cdp.evaluate('Boolean(document.querySelector("[data-fd-toast-action]"))');

const deleteFirstTask = async (cdp) => {
  await cdp.evaluate('document.querySelector("[aria-label=\\"删除任务\\"]").click()');
  await waitFor(cdp, 'Boolean(document.querySelector("[data-fd-confirm]"))', 5000, '删除确认');
  await click(cdp, '[data-fd-confirm-ok]');
  await wait(300);
};

try {
  await waitForBrowser(browser.port);
  const { cdp } = await openTab(browser.port, BASE + '/tasks');
  await navigate(cdp, BASE + '/tasks');
  await seedAppState(cdp, seed([task('t_a', '任务甲'), task('t_b', '任务乙'), task('t_c', '任务丙')]), 20);
  await navigate(cdp, BASE + '/tasks');
  await waitFor(cdp, 'document.querySelectorAll("[data-task-id]").length >= 3', 8000, '三条任务');

  // 1) 删除后出现撤销入口
  await deleteFirstTask(cdp);
  let state = await appState(cdp);
  R.eq('删除立即生效（任务数 2）', state?.tasks?.length, 2);
  R.check('Toast 出现「撤销」动作', await hasUndoAction(cdp));

  // 2) 撤销恢复原任务（同 id / 同标题 / 同字段）
  await click(cdp, '[data-fd-toast-action]');
  await wait(400);
  state = await appState(cdp);
  R.eq('撤销后任务数回到 3', state?.tasks?.length, 3);
  const restored = state?.tasks?.find((t) => t.id === 't_a');
  R.eq('撤销恢复同 id 任务', Boolean(restored), true);
  R.eq('撤销恢复标题与日期', [restored?.title, restored?.date], ['任务甲', today]);
  R.check('撤销后 Toast 收起', !(await hasUndoAction(cdp)));

  // 3) 刷新后删除仍然生效（撤销不跨刷新）
  await deleteFirstTask(cdp);
  await wait(400);
  await cdp.evaluate('location.reload()');
  await wait(1200);
  await waitFor(cdp, 'Boolean(window.__FD_STATE__)', 8000, '刷新后状态');
  state = await appState(cdp);
  R.eq('刷新后删除已持久化（2 条）', state?.tasks?.length, 2);
  R.check('刷新后不再提供撤销入口', !(await hasUndoAction(cdp)));

  // 4) 连续删除：仅最后一次可撤销
  await deleteFirstTask(cdp);
  await deleteFirstTask(cdp);
  state = await appState(cdp);
  R.eq('连续删除两次后剩 0 条', state?.tasks?.length, 0);
  R.eq('仅保留一个撤销入口', await cdp.evaluate('document.querySelectorAll("[data-fd-toast-action]").length'), 1);
  await click(cdp, '[data-fd-toast-action]');
  await wait(400);
  state = await appState(cdp);
  R.eq('撤销只恢复最后一次删除（1 条）', state?.tasks?.length, 1);

  // 5) 路由切换（SPA 内导航）后仍可撤销
  await seedAppState(cdp, seed([task('t_r', '路由测试')]), 30);
  await navigate(cdp, BASE + '/tasks');
  await waitFor(cdp, 'document.querySelectorAll("[data-task-id]").length === 1', 8000, '单条任务');
  await deleteFirstTask(cdp);
  await click(cdp, 'a[href="/calendar"]');
  await wait(700);
  R.check('离开路由后撤销入口仍在', await hasUndoAction(cdp));
  await click(cdp, '[data-fd-toast-action]');
  await wait(500);
  state = await appState(cdp);
  R.eq('跨路由撤销成功恢复任务', state?.tasks?.length, 1);

  // 6) 超时后确认删除（8s 窗口）
  await deleteFirstTask(cdp);
  R.check('超时测试前撤销入口存在', await hasUndoAction(cdp));
  await wait(8700);
  R.check('8 秒后撤销入口消失', !(await hasUndoAction(cdp)));
  state = await appState(cdp);
  R.eq('超时后任务保持删除', state?.tasks?.length, 0);

  // 7) 多标签：A 删除并撤销，B 不丢失数据且版本单调
  const second = await openTab(browser.port, BASE + '/tasks');
  await navigate(second.cdp, BASE + '/tasks');
  await wait(600);
  await seedAppState(cdp, seed([task('t_mt', '多标签任务')]), 40);
  await navigate(cdp, BASE + '/tasks');
  await navigate(second.cdp, BASE + '/tasks');
  await waitFor(cdp, 'document.querySelectorAll("[data-task-id]").length === 1', 8000, '标签A任务');
  await waitFor(second.cdp, 'Boolean(window.__FD_STATE__)', 8000, '标签B状态');
  const revBefore = await cdp.evaluate('window.__FD_STORAGE__.revision');
  await deleteFirstTask(cdp);
  await wait(600);
  await click(cdp, '[data-fd-toast-action]');
  let revAfter = revBefore;
  try {
    revAfter = await waitFor(cdp, `window.__FD_STORAGE__.revision > ${revBefore} ? window.__FD_STORAGE__.revision : 0`, 8000, '撤销写入');
  } catch {
    revAfter = await cdp.evaluate('window.__FD_STORAGE__.revision');
  }
  R.check('多标签：撤销写入使 revision 前进', revAfter > revBefore, `${revBefore} -> ${revAfter}`);
  const stateA = await appState(cdp);
  R.eq('多标签：A 侧任务恢复', stateA?.tasks?.length, 1);
  await navigate(second.cdp, BASE + '/tasks');
  await waitFor(second.cdp, 'Boolean(window.__FD_STATE__)', 8000, '标签B刷新后状态');
  await waitFor(second.cdp, 'window.__FD_STATE__.tasks.length === 1', 8000, '标签B数据收敛');
  const stateB = await second.cdp.evaluate('window.__FD_STATE__ || null');
  R.eq('多标签：B 侧最终数据一致（无静默丢失）', stateB?.tasks?.length, 1);
  R.eq('多标签：B 侧看到同一任务', stateB?.tasks?.[0]?.id, 't_mt');
  second.cdp.close();

  const report = R.writeReport(OUT, { base: BASE });
  process.exitCode = report.failed > 0 ? 1 : 0;
} catch (err) {
  console.error('e2e-undo 执行异常：', err.message);
  process.exitCode = 1;
} finally {
  await stopBrowser(browser);
}
