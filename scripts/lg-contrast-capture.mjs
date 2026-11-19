// Beta.2 可读性实测：采集「玻璃材质上的文字」探针 + 截图，交给 Python 计算对比度
// 用法：node scripts/lg-contrast-capture.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_BASE as BASE, navigate, openTab, seedAppState, startBrowser, stopBrowser, wait, waitFor, waitForBrowser } from './lib/e2e-harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const OUT = path.join(ROOT, 'docs', 'phase5.0', 'lg-evidence', 'contrast');
fs.mkdirSync(OUT, { recursive: true });

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

const browsers = startBrowser({ port: 9582 });
const probes = [];
let index = 0;

const collect = async (cdp, scene, theme, viewport) => {
  const list = await cdp.evaluate(`(() => {
    const pick = (sel, role) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width < 4 || r.height < 4) return null;
      return {
        role,
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        color: cs.color,
        fontSize: parseFloat(cs.fontSize),
        fontWeight: Number(cs.fontWeight) || 400,
        text: (el.textContent || '').trim().slice(0, 24),
      };
    };
    return [
      pick('header h1', 'glass-header-title'),
      pick('header p', 'glass-header-meta'),
      pick('aside nav a span', 'glass-sidebar-label'),
      pick('aside p', 'glass-sidebar-note'),
      pick('main section h2', 'card-heading'),
      pick('main section p', 'card-body'),
      pick('main section .text-ink-3', 'card-muted'),
    ].filter(Boolean);
  })()`);
  for (const item of list) {
    probes.push({ scene, theme, viewport, index: index++, ...item });
  }
  const res = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, `${theme}-${scene}-${viewport}.png`), Buffer.from(res.data, 'base64'));
};

try {
  await waitForBrowser(browsers.port);
  const { cdp } = await openTab(browsers.port, BASE + '/today');
  await navigate(cdp, BASE + '/today', { waitMs: 900 });
  await seedAppState(cdp, demo, 21);

  for (const theme of ['light', 'dark']) {
    await seedAppState(cdp, { ...demo, settings: { ...demo.settings, theme } }, 21);
    await cdp.evaluate('location.reload()');
    await wait(1200);
    await waitFor(cdp, 'Boolean(document.querySelector("[data-fd-main]"))', 9000, 'boot');
    for (const vp of [{ w: 1280, h: 860, tag: 'desktop' }, { w: 390, h: 844, tag: 'mobile' }]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: vp.w < 768 });
      for (const page of ['/today', '/settings']) {
        await navigate(cdp, BASE + page, { waitMs: 700 });
        await wait(280);
        await collect(cdp, page.replace('/', '') || 'today', theme, vp.tag);
      }
    }
  }
  fs.writeFileSync(path.join(OUT, 'probes.json'), JSON.stringify(probes, null, 2));
  console.log(`contrast probes: ${probes.length} → ${path.relative(ROOT, OUT)}`);
} finally {
  await stopBrowser(browsers);
}
