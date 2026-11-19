/**
 * Phase 4.5-D 无障碍证据截图：焦点可见性、skip link、弹窗焦点、深色焦点、320 重排、三宽度。
 * 输出目录：docs/phase4.5/screenshots-d/
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ROOT = process.cwd();
const OUT = path.join(ROOT, 'docs/phase4.5/screenshots-d');
const PROFILE = path.join(os.tmpdir(), 'flowday-shots-45d');
const PORT = 9410;
const BASE = process.env.BASE || 'http://127.0.0.1:5173';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });
fs.rmSync(PROFILE, { recursive: true, force: true });

class CDP {
  constructor(ws) {
    this.ws = new WebSocket(ws);
    this.seq = 0;
    this.pending = new Map();
  }
  async open() {
    await new Promise((res, rej) => {
      this.ws.addEventListener('open', res, { once: true });
      this.ws.addEventListener('error', () => rej(new Error('ws')), { once: true });
    });
    this.ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}
const ev = async (cdp, e) => {
  const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (exceptionDetails) throw new Error('EVAL: ' + (exceptionDetails.exception?.description || exceptionDetails.text));
  return result.value;
};
async function press(cdp, key, opts = {}) {
  const base = { key, code: key === ' ' ? 'Space' : key, windowsVirtualKeyCode: key === 'Enter' ? 13 : key === 'Tab' ? 9 : key === 'Escape' ? 27 : 0, nativeVirtualKeyCode: key === 'Enter' ? 13 : 0, modifiers: opts.shift ? 8 : 0 };
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
  if (key === 'Enter') await cdp.send('Input.dispatchKeyEvent', { type: 'char', text: '\r', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  await sleep(opts.wait ?? 150);
}
async function go(cdp, route) {
  await cdp.send('Page.navigate', { url: BASE + route });
  for (let i = 0; i < 100; i++) {
    if ((await ev(cdp, 'location.pathname').catch(() => '')) === route) break;
    await sleep(50);
  }
  for (let i = 0; i < 120; i++) {
    if (await ev(cdp, 'Boolean(window.__FD_STORAGE__ && window.__FD_STORAGE__.ready)')) return;
    await sleep(60);
  }
}
async function shot(cdp, name) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(data, 'base64'));
  console.log('shot ' + name);
}
async function seed(cdp) {
  await cdp.send('Page.navigate', { url: BASE + '/vite.svg' });
  await sleep(700);
  await ev(cdp, `(async () => {
    await new Promise((resolve) => { const r = indexedDB.deleteDatabase('flowday-db'); r.onsuccess = resolve; r.onerror = resolve; r.onblocked = resolve; });
    const db = await new Promise((resolve, reject) => { const req = indexedDB.open('flowday-db', 1); req.onupgradeneeded = () => { const d = req.result; d.createObjectStore('app'); d.createObjectStore('meta'); }; req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
    const pad = (x) => String(x).padStart(2, '0');
    const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    const shift = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
    const now = new Date().toISOString();
    const tasks = [
      { id: 't1', title: '完成无障碍审计清单', date: shift(0), priority: 1, completed: false, notes: '键盘/屏幕阅读器/对比度', createdAt: now, source: 'manual' },
      { id: 't2', title: '键盘全流程回归', date: shift(0), priority: 2, completed: false, createdAt: now, source: 'manual' },
      { id: 't3', title: '已完成的样例任务', date: shift(0), priority: 3, completed: true, completedAt: now, createdAt: now, source: 'manual' },
    ];
    const habits = [{ id: 'h1', name: '晨间拉伸', target: 1, unit: '次', color: '#34C759', createdAt: now }];
    const data = { version: 1, tasks, projects: [{ id: 'p1', name: '产品迭代', color: '#5B5CBF', createdAt: now }], habits, habitLogs: [], settings: { name: '无障碍', theme: 'light', weekStart: 1, aiEnabled: true, demoData: false } };
    const tx = db.transaction(['app', 'meta'], 'readwrite');
    tx.objectStore('app').put({ schemaVersion: 2, updatedAt: now, revision: 1, writerId: 'shots', data }, 'state');
    tx.objectStore('meta').put({ revision: 1, updatedAt: now, writerId: 'shots' }, 'sync:v1');
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    db.close();
    return true;
  })()`);
}
async function setTheme(cdp, theme) {
  await go(cdp, '/settings');
  await ev(cdp, `(() => { const b = [...document.querySelectorAll('[aria-label="主题"] button')].find((x) => x.textContent.trim() === '${theme === 'dark' ? '深色' : '浅色'}'); if (b) b.click(); return Boolean(b); })()`);
  await sleep(600);
}
async function main() {
  const child = spawn(EDGE, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--headless=new', '--disable-gpu', '--no-first-run', '--window-size=1280,900', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  try {
    for (let i = 0; i < 100; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
        if (r.ok) break;
      } catch {}
      await sleep(200);
    }
    const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter((t) => t.type === 'page')[0];
    const cdp = new CDP(page.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await seed(cdp);

    // 1) 键盘焦点：skip link
    await go(cdp, '/today');
    await sleep(400);
    await ev(cdp, 'document.body.focus()');
    await press(cdp, 'Tab', { wait: 250 });
    await shot(cdp, 'light-skip-link-focus');

    // 2) 键盘焦点：导航项
    await ev(cdp, `(() => { const a = [...document.querySelectorAll('nav a')].find((x) => x.textContent.trim() === '任务'); if (a) a.focus(); return Boolean(a); })()`);
    await sleep(250);
    await shot(cdp, 'light-nav-focus-ring');

    // 3) 弹窗内初始焦点（标题输入 + 焦点环）
    await ev(cdp, `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('新建任务')); if (b) b.focus(); return true; })()`);
    await press(cdp, 'Enter', { wait: 600 });
    await shot(cdp, 'light-modal-initial-focus');
    await press(cdp, 'Escape', { wait: 300 });

    // 4) 深色：任务勾选焦点环
    await setTheme(cdp, 'dark');
    await go(cdp, '/tasks');
    await sleep(400);
    await ev(cdp, `(() => { const b = document.querySelector('[data-testid="task-toggle"]'); if (b) b.focus(); return Boolean(b); })()`);
    await sleep(250);
    await shot(cdp, 'dark-task-toggle-focus');

    // 5) 深色弹窗焦点
    await ev(cdp, `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('新建任务')); if (b) b.focus(); return true; })()`);
    await press(cdp, 'Enter', { wait: 600 });
    await shot(cdp, 'dark-modal-initial-focus');
    await press(cdp, 'Escape', { wait: 300 });
    await setTheme(cdp, 'light');

    // 6) 320 重排
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 720, deviceScaleFactor: 1, mobile: true });
    await go(cdp, '/tasks');
    await sleep(500);
    await shot(cdp, 'reflow-320-tasks');
    await go(cdp, '/today');
    await sleep(400);
    await shot(cdp, 'reflow-320-today');

    // 7) 三宽度
    for (const w of [390, 768, 1280]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: w < 768 });
      await go(cdp, '/tasks');
      await sleep(500);
      await shot(cdp, `width-${w}-tasks`);
    }
    await cdp.send('Emulation.clearDeviceMetricsOverride');
    // 8) 移动端底部导航焦点
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await go(cdp, '/today');
    await sleep(400);
    await ev(cdp, `(() => { const a = [...document.querySelectorAll('nav a')].find((x) => x.textContent.trim() === '习惯'); if (a) a.focus(); return Boolean(a); })()`);
    await sleep(250);
    await shot(cdp, 'mobile-bottom-nav-focus');
    await cdp.send('Emulation.clearDeviceMetricsOverride');
    console.log('DONE');
  } finally {
    try { child.kill(); } catch {}
    await sleep(600);
    try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
  }
}
main().catch((e) => {
  console.error('SHOTS FAILED', e);
  process.exit(1);
});
