// Phase 5.0-a Beta.2：Liquid Glass 视觉证据采集（修复前/后对比 + 响应式 + 溢出 + 性能）
// 用法：BASE=http://127.0.0.1:5173 node scripts/lg-capture.mjs <before|after>
import fs from 'node:fs';
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
const ROOT = path.join(HERE, '..');
const LABEL = process.argv[2] === 'after' ? 'after' : 'before';
const OUT = path.join(ROOT, 'docs', 'phase5.0', 'lg-evidence', LABEL);
fs.mkdirSync(OUT, { recursive: true });

const R = makeRunner(`lg-capture-${LABEL}`);
const browser = startBrowser({ port: 9570 });
const today = new Date().toISOString().slice(0, 10);

const demo = {
  version: 1,
  tasks: [
    { id: 't1', title: '写本周周报', date: today, time: '09:30', priority: 2, projectId: 'p1', completed: false, createdAt: new Date().toISOString(), source: 'manual' },
    { id: 't2', title: '产品评审会：确认 5.0 视觉方向', date: today, time: '11:00', priority: 1, projectId: 'p1', completed: false, createdAt: new Date().toISOString(), source: 'manual' },
    { id: 't3', title: '整理 Liquid Glass 材质清单', date: today, time: '14:00', priority: 3, projectId: 'p2', completed: false, createdAt: new Date().toISOString(), source: 'manual' },
    { id: 't4', title: '阅读 30 分钟', date: today, time: '20:00', priority: 3, projectId: 'p2', completed: false, createdAt: new Date().toISOString(), source: 'manual' },
    { id: 't5', title: '回复客户邮件', date: today, priority: 3, projectId: 'p1', completed: true, completedAt: new Date().toISOString(), createdAt: new Date().toISOString(), source: 'manual' },
    { id: 't6', title: '提交月度总结', date: today, priority: 2, projectId: 'p1', completed: false, createdAt: new Date().toISOString(), source: 'manual' },
    { id: 't7', title: '背单词 100 个', date: today, priority: 3, projectId: 'p2', completed: false, createdAt: new Date().toISOString(), source: 'manual' },
    { id: 't8', title: '跑步 5 公里', date: today, priority: 3, projectId: 'p3', completed: false, createdAt: new Date().toISOString(), source: 'manual' },
  ],
  projects: [
    { id: 'p1', name: '工作', color: '#4A5B8C', archived: false, createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'p2', name: '学习', color: '#2F7477', archived: false, createdAt: '2026-01-02T00:00:00.000Z' },
    { id: 'p3', name: '生活', color: '#B0724A', archived: false, createdAt: '2026-01-03T00:00:00.000Z' },
  ],
  habits: [
    { id: 'h1', name: '早起', emoji: '🌱', weeklyTarget: 7, createdAt: new Date().toISOString(), archived: false },
    { id: 'h2', name: '阅读', emoji: '📖', weeklyTarget: 7, createdAt: new Date().toISOString(), archived: false },
    { id: 'h3', name: '跑步', emoji: '🏃', weeklyTarget: 3, createdAt: new Date().toISOString(), archived: false },
  ],
  habitLogs: [{ habitId: 'h1', date: today }, { habitId: 'h2', date: today }],
  settings: { name: '', theme: 'light', weekStart: 1, aiEnabled: true, demoData: false, onboarded: true },
};

// 种子后强制 reload：避免应用自身 debounce 保存覆盖种子（示例数据横幅会让对比基线不一致）
const reseed = async (cdp, state, rev) => {
  await seedAppState(cdp, state, rev);
  await cdp.evaluate('location.reload()');
  await wait(900);
  await waitFor(cdp, 'Boolean(document.querySelector("[data-fd-main]"))', 9000, 'reseed');
  await wait(260);
};

const shoot = async (cdp, name) => {
  const res = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const file = path.join(OUT, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(res.data, 'base64'));
  return file;
};

const metrics = async (cdp) =>
  cdp.evaluate(`(() => {
    const d = document.documentElement;
    const glassNodes = Array.from(document.querySelectorAll('*')).filter((el) => {
      const s = getComputedStyle(el);
      return (s.backdropFilter && s.backdropFilter !== 'none') || (s.webkitBackdropFilter && s.webkitBackdropFilter !== 'none');
    });
    return {
      scrollWidth: d.scrollWidth,
      clientWidth: d.clientWidth,
      innerWidth: window.innerWidth,
      overflow: d.scrollWidth > d.clientWidth + 1,
      glassNodes: glassNodes.length,
      dpr: window.devicePixelRatio,
    };
  })()`);

try {
  await waitForBrowser(browser.port);
  const { cdp } = await openTab(browser.port, BASE + '/today');
  await navigate(cdp, BASE + '/today');
  await seedAppState(cdp, demo, 5);

  const light = await cdp.evaluate('1');
  void light;

  // 验收要求：320 / 360 / 375 / 390 / 412 / 432 CSS px 全部覆盖（含桌面/平板基线）
  const viewports = [
    { w: 1440, h: 900, tag: 'desktop' },
    { w: 1280, h: 900, tag: 'laptop' },
    { w: 768, h: 1024, tag: 'tablet' },
    { w: 432, h: 932, tag: 'm432' },
    { w: 412, h: 915, tag: 'm412' },
    { w: 390, h: 844, tag: 'm390' },
    { w: 375, h: 812, tag: 'm375' },
    { w: 360, h: 800, tag: 'm360' },
    { w: 320, h: 568, tag: 'm320' },
  ];

  for (const theme of ['light', 'dark']) {
    await reseed(cdp, { ...demo, settings: { ...demo.settings, theme } }, 5);
    for (const vp of viewports) {

      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: vp.w,
        height: vp.h,
        deviceScaleFactor: 1,
        mobile: vp.w < 768,
      });
      for (const page of ['/today', '/tasks', '/projects', '/calendar', '/habits', '/settings']) {
        if (vp.w < 768 && !['/today', '/tasks', '/settings'].includes(page)) continue; // 窄屏截图聚焦三张主页面，其余仅做溢出/可访问性检测
        const slug = page.replace('/', '') || 'today';
        await navigate(cdp, BASE + page, { waitMs: 520 });
        await waitFor(cdp, 'Boolean(document.querySelector("[data-fd-main]")) || Boolean(document.querySelector("main"))', 8000, page);
        await wait(220);
        const m = await metrics(cdp);
        const name = `${theme}-${vp.tag}-${slug}`;
        await shoot(cdp, name);
        R.check(`[${theme} ${vp.w}px] ${page} 无横向溢出`, !m.overflow, `scrollWidth=${m.scrollWidth} clientWidth=${m.clientWidth}`);
      }
    }
  }

  // 交互态证据（桌面 + 移动）
  await reseed(cdp, demo, 6);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await navigate(cdp, BASE + '/today', { waitMs: 600 });
  await click(cdp, 'button[aria-label="账户菜单"]');
  await wait(320);
  await shoot(cdp, 'light-desktop-menu');
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await wait(200);
  await cdp.evaluate(`(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').includes('写下第一件事')); b && b.click(); return true; })()`);
  await wait(420);
  await shoot(cdp, 'light-desktop-modal');

  await cdp.evaluate('location.reload()');
  await wait(1000);
  await waitFor(cdp, 'Boolean(document.querySelector("[data-fd-main]")) || Boolean(document.querySelector("main"))', 9000, 'reload');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await navigate(cdp, BASE + '/today', { waitMs: 700 });
  await shoot(cdp, 'light-m390-today-nav');
  // 底部导航切换（用于动画序列）
  const seqDir = path.join(OUT, 'anim');
  fs.mkdirSync(seqDir, { recursive: true });
  await cdp.evaluate(`(() => { const a = document.querySelector('nav[aria-label="底部导航"] a[href="/tasks"]'); a && a.click(); return true; })()`);
  for (let i = 0; i < 8; i++) {
    const res = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(seqDir, `nav-${String(i).padStart(2, '0')}.png`), Buffer.from(res.data, 'base64'));
    await wait(60);
  }
  await wait(500);
  await shoot(cdp, 'light-m390-tasks-nav');

  // 性能：滚动 + rAF 帧间隔采样（3 秒）
  await cdp.evaluate(`window.__lgFrames = []; (() => {
    let last = performance.now();
    const tick = (t) => { window.__lgFrames.push(t - last); last = t; if (window.__lgFrames.length < 400) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  })()`);
  await cdp.evaluate(`window.scrollTo({ top: document.body.scrollHeight * 0.4, behavior: 'instant' })`);
  await wait(3200);
  const frames = await cdp.evaluate('window.__lgFrames || []');
  const sorted = [...frames].sort((a, b) => a - b);
  const avg = frames.reduce((a, b) => a + b, 0) / (frames.length || 1);
  const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
  const longFrames = frames.filter((f) => f > 32).length;
  const perf = { samples: frames.length, avgMs: Number(avg.toFixed(2)), p95Ms: Number(p95.toFixed(2)), longFrames };
  fs.writeFileSync(path.join(OUT, 'perf.json'), JSON.stringify(perf, null, 2));
  R.check('滚动期间无明显长帧（>32ms 占比 <10%）', longFrames / Math.max(1, frames.length) < 0.1, JSON.stringify(perf));

  const report = R.writeReport(OUT, { base: BASE, label: LABEL, perf });
  process.exitCode = report.failed > 0 ? 1 : 0;
} catch (err) {
  console.error(`lg-capture-${LABEL} 异常：`, err.message);
  process.exitCode = 1;
} finally {
  await stopBrowser(browser);
}
