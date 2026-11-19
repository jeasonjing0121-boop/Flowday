// Beta.2 动画证据：逐帧采集关键交互（底部导航胶囊位移 / 菜单生长 / 弹窗展开 / 分段控件滑动）
// 用法：node scripts/lg-anim-capture.mjs <before|after>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_BASE as BASE,
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
const ROOT = path.join(HERE, '..');
const LABEL = process.argv[2] === 'after' ? 'after' : 'before';
const OUT = path.join(ROOT, 'docs', 'phase5.0', 'lg-evidence', LABEL, 'anim');
fs.mkdirSync(OUT, { recursive: true });

const R = makeRunner(`lg-anim-${LABEL}`);
const browser = startBrowser({ port: 9581 });
const today = new Date().toISOString().slice(0, 10);
const demo = {
  version: 1,
  tasks: [
    { id: 't1', title: '写本周周报', date: today, time: '09:30', priority: 2, projectId: 'p1', completed: false, createdAt: new Date().toISOString(), source: 'manual' },
    { id: 't2', title: '产品评审会：确认 5.0 视觉方向', date: today, time: '11:00', priority: 1, projectId: 'p1', completed: false, createdAt: new Date().toISOString(), source: 'manual' },
    { id: 't3', title: '整理 Liquid Glass 材质清单', date: today, time: '14:00', priority: 3, projectId: 'p2', completed: false, createdAt: new Date().toISOString(), source: 'manual' },
  ],
  projects: [
    { id: 'p1', name: '工作', color: '#4A5B8C', archived: false, createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'p2', name: '学习', color: '#2F7477', archived: false, createdAt: '2026-01-02T00:00:00.000Z' },
  ],
  habits: [{ id: 'h1', name: '早起', emoji: '🌱', weeklyTarget: 7, createdAt: new Date().toISOString(), archived: false }],
  habitLogs: [],
  settings: { name: '', theme: 'light', weekStart: 1, aiEnabled: true, demoData: false, onboarded: true },
};

const frames = async (cdp, tag, count = 10, gap = 55) => {
  for (let i = 0; i < count; i++) {
    const res = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, `${tag}-${String(i).padStart(2, '0')}.png`), Buffer.from(res.data, 'base64'));
    await wait(gap);
  }
};

try {
  await waitForBrowser(browser.port);
  const { cdp } = await openTab(browser.port, BASE + '/today');
  await navigate(cdp, BASE + '/today', { waitMs: 900 });
  await seedAppState(cdp, demo, 11);
  await cdp.evaluate('location.reload()');
  await wait(1200);
  await waitFor(cdp, 'Boolean(document.querySelector("[data-fd-main]"))', 9000, 'boot');

  // 1) 移动端底部导航：胶囊位移
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await navigate(cdp, BASE + '/today', { waitMs: 700 });
  await wait(320);
  await cdp.evaluate(`(() => { const a = document.querySelector('nav[aria-label="底部导航"] a[href="/tasks"]'); if (a) a.click(); return true; })()`);
  await frames(cdp, 'nav-to-tasks', 12, 50);
  await wait(420);

  // 2) 账户菜单生长
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
  await navigate(cdp, BASE + '/today', { waitMs: 700 });
  await wait(300);
  await cdp.evaluate(`(() => { const b = document.querySelector('button[aria-label="账户菜单"]'); if (b) b.click(); return true; })()`);
  await frames(cdp, 'menu-open', 8, 45);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await wait(260);

  // 3) 弹窗展开（任务编辑器）
  await cdp.evaluate(`(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').includes('新建任务')); if (b) b.click(); return true; })()`);
  await frames(cdp, 'modal-open', 8, 45);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await wait(300);

  // 4) 分段控件滑动（任务/项目）
  await navigate(cdp, BASE + '/tasks', { waitMs: 700 });
  await wait(260);
  const segOk = await cdp.evaluate(`(() => { const b = Array.from(document.querySelectorAll('[role="group"] button')).find((x) => (x.textContent || '').trim() === '项目'); if (b) b.click(); return Boolean(b); })()`);
  if (segOk) await frames(cdp, 'seg-switch', 8, 45);

  R.check('动画帧采集完成', fs.readdirSync(OUT).length >= 30, `${fs.readdirSync(OUT).length} frames`);
  const report = R.writeReport(OUT, { label: LABEL, frames: fs.readdirSync(OUT).length });
  process.exitCode = report.failed > 0 ? 1 : 0;
} catch (err) {
  console.error(`lg-anim-${LABEL} 异常：`, err.message);
  process.exitCode = 1;
} finally {
  await stopBrowser(browser);
}
