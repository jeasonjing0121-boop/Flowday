// Phase 5.0-a D5 专项 E2E：首次引导（触发条件 / 三步流程 / 跳过 / 复习 / 不重复打扰）
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_BASE as BASE,
  click,
  exists,
  makeRunner,
  navigate,
  openTab,
  seedAppState,
  setInput,
  startBrowser,
  stopBrowser,
  wait,
  waitFor,
  waitForBrowser,
} from './lib/e2e-harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', '.tmp', 'e2e-5a');
const R = makeRunner('e2e-onboarding');
const browser = startBrowser({ port: 9530 });
const today = new Date().toISOString().slice(0, 10);

const empty = (patch = {}) => ({
  version: 1,
  tasks: [],
  projects: [],
  habits: [],
  habitLogs: [],
  settings: { name: '', theme: 'light', weekStart: 1, aiEnabled: true, demoData: false, onboarded: false, ...patch },
});

const appState = (cdp) => cdp.evaluate('window.__FD_STATE__ || null');
const onboardingVisible = (cdp) => exists(cdp, '[data-fd-onboarding]');

try {
  await waitForBrowser(browser.port);
  const { cdp } = await openTab(browser.port, BASE + '/today');
  await navigate(cdp, BASE + '/today');

  // 1) 全新空用户 → 自动出现引导
  await seedAppState(cdp, empty(), 1);
  await navigate(cdp, BASE + '/today');
  await waitFor(cdp, 'Boolean(document.querySelector("[data-fd-onboarding]"))', 9000, '首次引导出现');
  R.eq('全新用户自动出现引导（第 1 步）', await cdp.evaluate('document.querySelector("[data-fd-onboarding]").getAttribute("data-fd-onboarding")'), '1');

  // 2) 三步流程：建项目 → 建任务 → 完成
  await click(cdp, '[data-fd-onboarding-next]');
  await wait(250);
  await waitFor(cdp, 'Boolean(document.querySelector("#onboarding-project-name"))', 5000, '第 2 步');
  await setInput(cdp, '#onboarding-project-name', '我的第一个项目');
  await click(cdp, '[data-fd-onboarding-create-project]');
  await wait(300);
  R.eq('进入第 3 步', await cdp.evaluate('document.querySelector("[data-fd-onboarding]").getAttribute("data-fd-onboarding")'), '3');
  await setInput(cdp, '#onboarding-task-title', '整理今天的待办');
  await click(cdp, '[data-fd-onboarding-finish]');
  await wait(600);
  let state = await appState(cdp);
  R.eq('引导创建了 1 个项目', state?.projects?.length, 1);
  R.eq('引导创建了 1 条任务', state?.tasks?.length, 1);
  R.eq('任务归属引导创建的项目', state?.tasks?.[0]?.projectId, state?.projects?.[0]?.id);
  R.eq('完成后写入 onboarded 标记', state?.settings?.onboarded, true);
  R.check('完成后引导关闭', !(await onboardingVisible(cdp)));

  // 3) 刷新后不重复打扰
  await cdp.evaluate('location.reload()');
  await wait(1200);
  await waitFor(cdp, 'Boolean(window.__FD_STATE__)', 9000, '刷新后状态');
  await wait(500);
  R.check('已完成引导后刷新不再弹出', !(await onboardingVisible(cdp)));

  // 4) 跳过流程：记录完成状态，且不再弹出
  await seedAppState(cdp, empty(), 5);
  await navigate(cdp, BASE + '/today');
  await waitFor(cdp, 'Boolean(document.querySelector("[data-fd-onboarding-skip]"))', 9000, '跳过按钮');
  await click(cdp, '[data-fd-onboarding-skip]');
  await wait(500);
  state = await appState(cdp);
  R.eq('跳过也记录 onboarded', state?.settings?.onboarded, true);
  R.check('跳过后引导关闭', !(await onboardingVisible(cdp)));

  // 5) 示例数据 → 不弹引导
  await seedAppState(cdp, empty({ demoData: true }), 7);
  await navigate(cdp, BASE + '/today');
  await wait(900);
  R.check('示例数据不弹引导', !(await onboardingVisible(cdp)));

  // 6) 已有数据 → 不弹引导
  await seedAppState(
    cdp,
    {
      ...empty({ onboarded: false }),
      projects: [{ id: 'p1', name: '工作', color: '#4A5B8C', archived: false }],
      tasks: [{ id: 't1', title: '已有任务', date: today, priority: 3, completed: false, createdAt: new Date().toISOString(), source: 'manual' }],
    },
    8
  );
  await navigate(cdp, BASE + '/today');
  await wait(900);
  R.check('已有项目与任务的老用户不被打扰', !(await onboardingVisible(cdp)));

  // 7) 设置页「重新查看」→ 回顾模式，不重置标记
  await seedAppState(cdp, empty({ onboarded: true }), 9);
  await navigate(cdp, BASE + '/settings');
  await waitFor(cdp, 'Boolean(document.querySelector("[data-fd-replay-onboarding]"))', 6000, '设置页入口');
  await click(cdp, '[data-fd-replay-onboarding]');
  await waitFor(cdp, 'Boolean(document.querySelector("[data-fd-onboarding-review=\\"1\\"]"))', 6000, '回顾模式');
  R.check('回顾模式标记为 review', await exists(cdp, '[data-fd-onboarding-review="1"]'));
  R.check('回顾模式提示不会重置状态', await cdp.evaluate('document.body.textContent.includes("不会重置你的引导状态")'));
  await click(cdp, '[data-fd-onboarding-skip]');
  await wait(400);
  state = await appState(cdp);
  R.eq('回顾后 onboarded 保持 true', state?.settings?.onboarded, true);
  R.check('回顾后关闭引导', !(await onboardingVisible(cdp)));

  const report = R.writeReport(OUT, { base: BASE });
  process.exitCode = report.failed > 0 ? 1 : 0;
} catch (err) {
  console.error('e2e-onboarding 执行异常：', err.message);
  process.exitCode = 1;
} finally {
  await stopBrowser(browser);
}
