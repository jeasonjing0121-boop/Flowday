// Phase 5.0-a D2 专项 E2E：项目 CRUD / 归档 / 删除（不删任务）/ 移动端入口 / 键盘
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
  setViewport,
  startBrowser,
  stopBrowser,
  wait,
  waitFor,
  waitForBrowser,
} from './lib/e2e-harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', '.tmp', 'e2e-5a');
const R = makeRunner('e2e-projects');
const browser = startBrowser({ port: 9510 });

const clickText = async (cdp, text, scope = 'body') => {
  const ok = await cdp.evaluate(`(() => {
    const root = document.querySelector(${JSON.stringify(scope)}) || document.body;
    const target = Array.from(root.querySelectorAll('button, a')).find((el) => (el.textContent || '').includes(${JSON.stringify(text)}));
    if (!target) return false;
    target.click();
    return true;
  })()`);
  if (!ok) throw new Error(`找不到按钮：${text}`);
  await wait(140);
};

const appState = (cdp) => cdp.evaluate('window.__FD_STATE__ || null');

const emptyData = {
  version: 1,
  tasks: [],
  projects: [],
  habits: [],
  habitLogs: [],
  settings: { name: '', theme: 'light', weekStart: 1, aiEnabled: true, demoData: false, onboarded: true },
};

try {
  await waitForBrowser(browser.port);
  const { cdp } = await openTab(browser.port, BASE + '/today');
  await navigate(cdp, BASE + '/today');
  await seedAppState(cdp, emptyData, 5);
  await navigate(cdp, BASE + '/projects');
  await waitFor(cdp, 'Boolean(document.querySelector("[data-fd-projects-page]"))', 8000, '项目页渲染');

  // 1) 空状态
  R.check('空状态展示「创建第一个项目」', await cdp.evaluate('document.body.textContent.includes("创建第一个项目")'));

  // 2) 创建项目（键盘：Enter 提交）
  await click(cdp, '[data-fd-project-create]');
  await waitFor(cdp, 'Boolean(document.querySelector("[data-fd-project-editor=create]"))', 5000, '创建弹窗');
  R.check('创建弹窗自动聚焦名称输入', await cdp.evaluate('document.activeElement && document.activeElement.id === "project-name"'));
  await setInput(cdp, '#project-name', '工作项目');
  await cdp.evaluate(`(() => { document.querySelector('#project-name').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return true; })()`);
  await wait(300);
  await waitFor(cdp, 'Boolean(document.querySelector("[data-project-id]"))', 6000, '项目卡片');
  let state = await appState(cdp);
  R.eq('创建项目：写入 1 个项目', state?.projects?.length, 1);
  R.eq('创建项目：名称正确', state?.projects?.[0]?.name, '工作项目');
  R.eq('创建项目：默认未归档', state?.projects?.[0]?.archived, false);

  // 3) 编辑名称与颜色
  await cdp.evaluate('document.querySelector("[aria-label^=\\"编辑项目\\"]").click()');
  await waitFor(cdp, 'Boolean(document.querySelector("[data-fd-project-editor=edit]"))', 5000, '编辑弹窗');
  await setInput(cdp, '#project-name', '工作与成长');
  await cdp.evaluate('document.querySelector("[data-project-color=\\"#2F7477\\"]").click()');
  await click(cdp, '[data-fd-project-save]');
  await wait(300);
  state = await appState(cdp);
  R.eq('编辑项目：名称更新', state?.projects?.[0]?.name, '工作与成长');
  R.eq('编辑项目：颜色更新', state?.projects?.[0]?.color, '#2f7477');
  R.check('列表卡片展示新名称', await cdp.evaluate('document.body.textContent.includes("工作与成长")'));

  // 4) 进入详情并新建任务（任务编辑器内联新建项目已在 D2 覆盖于单元；此处走详情页）
  const projectId = state.projects[0].id;
  await navigate(cdp, `${BASE}/projects/${projectId}`);
  await waitFor(cdp, `Boolean(document.querySelector("[data-fd-project-detail=\\"${projectId}\\"]"))`, 6000, '详情页');
  R.check('详情页展示完成率', await exists(cdp, '[data-fd-project-percent]'));
  await click(cdp, '[data-fd-project-add-task]');
  await waitFor(cdp, 'Boolean(document.querySelector("#task-title"))', 5000, '任务弹窗');
  await setInput(cdp, '#task-title', '写周报');
  await clickText(cdp, '添加任务');
  await wait(400);
  state = await appState(cdp);
  R.eq('详情页新建任务：任务落在该项目', state?.tasks?.[0]?.projectId, projectId);
  R.check('详情页展示该任务', await cdp.evaluate('document.body.textContent.includes("写周报")'));

  // 5) 完成一条任务 → 完成率 100%
  await cdp.evaluate('document.querySelector("[data-testid=task-toggle]").click()');
  await wait(400);
  R.eq('完成后完成率 100%', await cdp.evaluate('document.querySelector("[data-fd-project-percent]").getAttribute("data-fd-project-percent")'), '100');
  R.eq('完成后未完成计数 0', await cdp.evaluate('document.querySelector("[data-fd-project-open]").textContent.trim()'), '0');

  // 6) 返回列表并归档 → 活动区为空、归档区可恢复
  await navigate(cdp, BASE + '/projects');
  await waitFor(cdp, 'Boolean(document.querySelector("[data-project-id]"))', 6000, '项目列表');
  await cdp.evaluate('document.querySelector("[aria-label^=\\"归档项目\\"]").click()');
  await wait(300);
  state = await appState(cdp);
  R.eq('归档：archived=true（任务保留）', [state?.projects?.[0]?.archived, state?.tasks?.length], [true, 1]);
  R.eq('归档后活动区无卡片', await cdp.evaluate('document.querySelectorAll("[data-project-id]").length'), 0);
  await click(cdp, '[data-fd-archived-section] > button');
  await wait(200);
  R.check('归档区展开显示项目', await exists(cdp, '[data-archived-project]'));
  await clickText(cdp, '恢复', '[data-archived-project]');
  await wait(300);
  state = await appState(cdp);
  R.eq('恢复：archived=false', state?.projects?.[0]?.archived, false);

  // 7) 删除项目：任务保留并归未分类
  await waitFor(cdp, 'Boolean(document.querySelector("[data-project-id]"))', 6000, '项目卡片（恢复后）');
  await cdp.evaluate('document.querySelector("[aria-label^=\\"删除项目\\"]").click()');
  await waitFor(cdp, 'Boolean(document.querySelector("[data-fd-project-delete]"))', 5000, '删除弹窗');
  R.check('删除弹窗说明任务会移到未分类', await cdp.evaluate('document.body.textContent.includes("未分类") && document.body.textContent.includes("不会被删除")'));
  await click(cdp, '[data-fd-project-delete-confirm]');
  await wait(500);
  state = await appState(cdp);
  R.eq('删除项目：项目数 0', state?.projects?.length, 0);
  R.eq('删除项目：任务数不变', state?.tasks?.length, 1);
  R.eq('删除项目：关联任务 projectId 清空', state?.tasks?.[0]?.projectId ?? null, null);
  R.check('删除后回到空状态', await cdp.evaluate('document.body.textContent.includes("还没有项目")'));

  // 8) 未知项目 id：安全空态
  await navigate(cdp, `${BASE}/projects/does-not-exist`);
  R.check('未知项目 id 渲染缺失空态', await waitFor(cdp, 'Boolean(document.querySelector("[data-fd-project-missing]"))', 5000, '缺失空态'));

  // 9) 未定义 projectId 的安全降级：加载时由 sanitize 清理，任务保留且页面不崩溃
  const orphanData = {
    ...emptyData,
    settings: { ...emptyData.settings },
    tasks: [
      {
        id: 't_orphan',
        title: '孤儿任务',
        date: new Date().toISOString().slice(0, 10),
        priority: 3,
        projectId: 'ghost-project',
        completed: false,
        createdAt: new Date().toISOString(),
        source: 'manual',
      },
    ],
  };
  await seedAppState(cdp, orphanData, 9);
  await navigate(cdp, BASE + '/projects');
  await waitFor(cdp, 'Boolean(document.querySelector("[data-fd-projects-page]"))', 6000, '孤儿数据加载');
  state = await appState(cdp);
  R.eq('未定义 projectId：任务保留', state?.tasks?.length, 1);
  R.eq('未定义 projectId：加载时安全清空', state?.tasks?.[0]?.projectId ?? null, null);
  R.check('未定义 projectId：页面正常渲染无崩溃', await exists(cdp, '[data-fd-projects-page]'));

  // 10) 移动端：底部导航仍 5 项 + 任务页分段进入项目
  await setViewport(cdp, 390, 844, true);
  await navigate(cdp, BASE + '/tasks');
  await wait(400);
  R.eq('移动端底部导航 5 项（未新增第 6 项）', await cdp.evaluate('document.querySelectorAll("[aria-label=底部导航] a").length'), 5);
  R.check('移动端任务页有「项目」分段', await cdp.evaluate('document.body.textContent.includes("项目视图")'));
  await clickText(cdp, '项目', '[aria-label="任务与项目视图"]');
  await wait(600);
  R.check('移动端通过分段进入项目页', (await cdp.evaluate('location.pathname')) === '/projects');

  // 11) 弹窗关闭后焦点归还
  await setViewport(cdp, 1280, 900, false);
  await navigate(cdp, BASE + '/projects');
  await wait(400);
  const focusOk = await cdp.evaluate(`(async () => {
    const trigger = document.querySelector('[data-fd-project-create]');
    trigger.focus();
    trigger.click();
    await new Promise((r) => setTimeout(r, 250));
    const closeBtn = Array.from(document.querySelectorAll('[data-fd-dialog] button')).find((b) => (b.getAttribute('aria-label') || '').includes('关闭'));
    if (!closeBtn) return 'no-close';
    closeBtn.click();
    await new Promise((r) => setTimeout(r, 350));
    return document.activeElement === trigger ? 'restored' : document.activeElement?.getAttribute('data-fd-project-create') === '1' ? 'restored' : 'lost';
  })()`);
  R.eq('关闭项目弹窗后焦点归还触发按钮', focusOk, 'restored');

  const report = R.writeReport(OUT, { base: BASE });
  process.exitCode = report.failed > 0 ? 1 : 0;
} catch (err) {
  console.error('e2e-projects 执行异常：', err.message);
  process.exitCode = 1;
} finally {
  await stopBrowser(browser);
}
