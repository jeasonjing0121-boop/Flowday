// Phase 5.0-B / B4 视觉证据：v3 材质截图、近景裁切、按钮状态、滚动高光连续帧
// 用法：node scripts/b4-visual.mjs
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
const OUT = path.join(ROOT, 'docs', 'phase5.0', 'phase-b4-evidence');
fs.mkdirSync(OUT, { recursive: true });

const today = new Date().toISOString().slice(0, 10);
const demo = {
  version: 1,
  tasks: Array.from({ length: 12 }, (_, i) => ({
    id: `t${i}`,
    title: `任务 ${i + 1}：材质观测条目，用于观察玻璃与内容的空间层次`,
    date: today,
    priority: (i % 4) + 1,
    projectId: i % 2 === 0 ? 'p1' : 'p2',
    completed: false,
    createdAt: new Date().toISOString(),
    source: 'manual',
  })),
  projects: [
    { id: 'p1', name: '工作', color: '#4A5B8C', archived: false, createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'p2', name: '学习', color: '#2F7477', archived: false, createdAt: '2026-01-02T00:00:00.000Z' },
  ],
  habits: [{ id: 'h1', name: '早起', emoji: '🌱', weeklyTarget: 7, createdAt: new Date().toISOString(), archived: false }],
  habitLogs: [],
  settings: { name: '', theme: 'light', weekStart: 1, aiEnabled: true, demoData: false, onboarded: true },
};

const R = makeRunner('b4-visual');
const browser = startBrowser({ port: 9621 });
const report = { shots: [], frames: 0, backdrop: {}, notes: {} };

// 注意：headless 是软件渲染，DPR=2 的全页 backdrop-filter 合成会超时（真机有 GPU）。
// 全页用 DPR=1；近景用 clip + scale:2 放大，保证细节可评审。
const setViewport = (cdp, w, h, mobile) =>
  cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });

const shot = async (cdp, name) => {
  const res = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(res.data, 'base64'));
  report.shots.push(`${name}.png`);
  return `${name}.png`;
};

const clipRect = async (cdp, name, rect, pad = 8) => {
  if (!rect) return null;
  const clip = {
    x: Math.max(0, rect.x - pad),
    y: Math.max(0, rect.y - pad),
    width: Math.min(rect.width + pad * 2, 1600),
    height: Math.min(rect.height + pad * 2, 900),
    scale: 2,
  };
  const res = await cdp.send('Page.captureScreenshot', { format: 'png', clip });
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(res.data, 'base64'));
  report.shots.push(`${name}.png`);
  return `${name}.png`;
};

const cardRect = (cdp) =>
  cdp.evaluate(`(() => {
    const cards = Array.from(document.querySelectorAll('main section.fd-card'));
    const el = cards.find((c) => { const r = c.getBoundingClientRect(); return r.width > 200 && r.height > 80; });
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  })()`);

const clipShot = async (cdp, name, selector, pad = 8) => {
  const box = await cdp.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  })()`);
  if (!box) return null;
  const clip = {
    x: Math.max(0, box.x - pad),
    y: Math.max(0, box.y - pad),
    width: Math.min(box.width + pad * 2, 1600),
    height: Math.min(box.height + pad * 2, 900),
    scale: 2,
  };
  const res = await cdp.send('Page.captureScreenshot', { format: 'png', clip });
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(res.data, 'base64'));
  report.shots.push(`${name}.png`);
  return `${name}.png`;
};

const countBackdrop = async (cdp) =>
  cdp.evaluate(`(() => {
    const all = Array.from(document.querySelectorAll('*'));
    const withBf = all.filter((el) => { const s = getComputedStyle(el); const bf = s.backdropFilter || s.webkitBackdropFilter; return bf && bf !== 'none'; });
    const pseudos = all.filter((el) => { const b = getComputedStyle(el, '::before'); const bf = b.backdropFilter || b.webkitBackdropFilter; return bf && bf !== 'none'; });
    return { elements: withBf.length, elementBefore: pseudos.length, names: withBf.slice(0, 10).map((e) => (e.className || '').toString().split(' ').slice(0, 2).join('.')) };
  })()`);

try {
  await waitForBrowser(browser.port);
  const { cdp } = await openTab(browser.port, BASE + '/today');
  await navigate(cdp, BASE + '/today', { waitMs: 900 });
  await seedAppState(cdp, demo, 91);
  await cdp.evaluate('location.reload()');
  await wait(1500);
  await waitFor(cdp, 'Boolean(document.querySelector("[data-fd-main]"))', 9000, 'boot');

  // ---------- 桌面 浅色 / 深色 ----------
  for (const theme of ['light', 'dark']) {
    await seedAppState(cdp, { ...demo, settings: { ...demo.settings, theme } }, 91);
    await cdp.evaluate('location.reload()');
    await wait(1400);
    await waitFor(cdp, 'Boolean(document.querySelector("[data-fd-main]"))', 9000, `boot-${theme}`);
    await setViewport(cdp, 1440, 900, false);
    await navigate(cdp, BASE + '/today', { waitMs: 700 });
    await wait(320);
    await shot(cdp, `v3-${theme}-desktop-today`);
    await clipShot(cdp, `v3-${theme}-closeup-header`, 'header > div', 10);
    await clipRect(cdp, `v3-${theme}-closeup-card`, await cardRect(cdp), 10);
    await navigate(cdp, BASE + '/tasks', { waitMs: 650 });
    await wait(260);
    await shot(cdp, `v3-${theme}-desktop-tasks`);
  }

  // ---------- 移动端 390（浅色） ----------
  await seedAppState(cdp, demo, 91);
  await cdp.evaluate('location.reload()');
  await wait(1300);
  await waitFor(cdp, 'Boolean(document.querySelector("[data-fd-main]"))', 9000, 'boot-mobile');
  await setViewport(cdp, 390, 844, true);
  await navigate(cdp, BASE + '/today', { waitMs: 750 });
  await wait(320);
  report.backdrop.mobileHome = await countBackdrop(cdp);
  await shot(cdp, 'v3-light-mobile-today');
  await clipShot(cdp, 'v3-light-closeup-tabbar', 'nav[aria-label="底部导航"]', 10);

  // ---------- 移动端深色近景 ----------
  await seedAppState(cdp, { ...demo, settings: { ...demo.settings, theme: 'dark' } }, 91);
  await cdp.evaluate('location.reload()');
  await wait(1400);
  await waitFor(cdp, 'Boolean(document.querySelector("[data-fd-main]"))', 9000, 'boot-dark-mobile');
  await setViewport(cdp, 390, 844, true);
  await navigate(cdp, BASE + '/today', { waitMs: 750 });
  await wait(320);
  await shot(cdp, 'v3-dark-mobile-today');
  await clipShot(cdp, 'v3-dark-closeup-tabbar', 'nav[aria-label="底部导航"]', 10);
  await clipShot(cdp, 'v3-dark-closeup-header', 'header > div', 10);
  await seedAppState(cdp, demo, 91);
  await cdp.evaluate('location.reload()');
  await wait(1300);
  await waitFor(cdp, 'Boolean(document.querySelector("[data-fd-main]"))', 9000, 'boot-light-again');

  // ---------- 弹窗（近景用） ----------
  await navigate(cdp, BASE + '/tasks', { waitMs: 650 });
  await cdp.evaluate(`(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').includes('新建任务')); if (b) b.click(); return Boolean(b); })()`);
  await wait(600);
  await shot(cdp, 'v3-light-mobile-modal');
  await clipShot(cdp, 'v3-light-closeup-modal', '[data-fd-dialog="modal"]', 12);
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await wait(450);

  // ---------- 按钮三态（弹窗主按钮：normal / hover / active） ----------
  await setViewport(cdp, 390, 844, true);
  await navigate(cdp, BASE + '/tasks', { waitMs: 700 });
  await wait(250);
  await cdp.evaluate(`(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').includes('新建任务')); if (b) b.click(); return Boolean(b); })()`);
  await wait(550);
  const btnBox = await cdp.evaluate(`(() => {
    const b = document.querySelector('[data-fd-dialog="modal"] .fd-btn-primary');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  })()`);
  if (btnBox) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
    await wait(160);
    await clipRect(cdp, 'v3-btn-normal', btnBox, 16);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: btnBox.x + btnBox.width / 2, y: btnBox.y + btnBox.height / 2 });
    await wait(220);
    await clipRect(cdp, 'v3-btn-hover', btnBox, 16);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: btnBox.x + btnBox.width / 2, y: btnBox.y + btnBox.height / 2, button: 'left', clickCount: 1 });
    await wait(150);
    await clipRect(cdp, 'v3-btn-active', btnBox, 16);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: btnBox.x + btnBox.width / 2, y: btnBox.y + btnBox.height / 2, button: 'left', clickCount: 1 });
    await wait(250);
    report.notes.buttonStates = true;
  } else {
    report.notes.buttonStates = 'button-not-found';
  }
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await wait(400);

  // ---------- 滚动高光连续帧（GIF 素材）：390 宽度滚动 220px ----------
  await setViewport(cdp, 390, 844, true);
  await navigate(cdp, BASE + '/today', { waitMs: 700 });
  await wait(320);
  const seqDir = path.join(OUT, 'scroll-frames');
  fs.mkdirSync(seqDir, { recursive: true });
  for (let i = 0; i < 12; i++) {
    await cdp.evaluate(`window.scrollTo(0, ${i * 20})`);
    await wait(70);
    const res = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(seqDir, `scroll-${String(i).padStart(2, '0')}.png`), Buffer.from(res.data, 'base64'));
    report.frames += 1;
  }
  report.notes.specularShift = await cdp.evaluate(`(() => ({
    scroll: getComputedStyle(document.documentElement).getPropertyValue('--lg-scroll').trim(),
    shift: getComputedStyle(document.querySelector('nav[aria-label="底部导航"]'), '::after').transform,
    headerShift: getComputedStyle(document.querySelector('header > div') || document.querySelector('header'), '::after').transform,
  }))()`);

  fs.writeFileSync(path.join(OUT, 'b4-metrics.json'), JSON.stringify(report, null, 2));
  R.check('材质截图采集完成', report.shots.length >= 8, `${report.shots.length} 张`);
  R.check('滚动连续帧采集完成', report.frames === 12, `${report.frames} 帧`);
  R.check('移动端二次采样层受控（≤3）', report.backdrop.mobileHome.elementBefore <= 3, JSON.stringify(report.backdrop.mobileHome));
  const res = R.writeReport(OUT, { base: BASE, shots: report.shots.length, frames: report.frames });
  process.exitCode = res.failed > 0 ? 1 : 0;
} catch (err) {
  console.error('b4-visual 异常：', err.message);
  process.exitCode = 1;
} finally {
  await stopBrowser(browser);
}
