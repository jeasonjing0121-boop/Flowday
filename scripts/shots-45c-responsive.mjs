/**
 * Phase 4.5-C 补充核验：390 / 768 / 1280 三宽度响应式回归 + 项目标签 UI 截图。
 * 输出：docs/phase4.5/screenshots-c/responsive/*.png + responsive-report.json
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ROOT = process.cwd();
const OUT = path.join(ROOT, 'docs/phase4.5/screenshots-c/responsive');
const PROFILE = path.join(os.tmpdir(), 'flowday-shots-resp');
const PORT = 9399;
const BASE = process.env.BASE || 'http://127.0.0.1:5173';
const WIDTHS = [390, 768, 1280];
const PAGES = ['/today', '/tasks', '/calendar', '/habits', '/assistant', '/settings'];
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
      this.ws.addEventListener('error', () => rej(new Error('ws error')), { once: true });
    });
    this.ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) p.reject(new Error(m.error.message));
        else p.resolve(m.result);
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

const ev = async (cdp, expression) => {
  const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (exceptionDetails) throw new Error('EVAL: ' + (exceptionDetails.exception?.description || exceptionDetails.text));
  return result.value;
};

async function go(cdp, route) {
  await cdp.send('Page.navigate', { url: BASE + route });
  for (let i = 0; i < 100; i++) {
    const url = await ev(cdp, 'location.pathname').catch(() => '');
    if (url === route) break;
    await sleep(50);
  }
  for (let i = 0; i < 100; i++) {
    if (await ev(cdp, 'Boolean(window.__FD_STORAGE__ && window.__FD_STORAGE__.ready)')) return;
    await sleep(60);
  }
  throw new Error('not ready: ' + route);
}

async function shot(cdp, name) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(data, 'base64'));
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
    const projects = [
      { id: 'pj1', name: '产品迭代', color: '#5B5CBF', createdAt: now },
      { id: 'pj2', name: '个人成长', color: '#2F7477', createdAt: now },
    ];
    const tasks = [
      { id: 't1', title: '撰写 Phase 4.5 视觉规范', date: shift(0), priority: 1, completed: false, projectId: 'pj1', notes: '统一 Token / 玻璃层次 / 组件状态', createdAt: now, source: 'manual' },
      { id: 't2', title: '评审液态玻璃高光参数', date: shift(0), priority: 2, completed: false, projectId: 'pj2', createdAt: now, source: 'manual' },
      { id: 't3', title: '整理深色模式对比度', date: shift(0), priority: 3, completed: true, completedAt: now, createdAt: now, source: 'manual' },
      { id: 't4', title: '校准弹窗进入动效曲线', date: shift(1), priority: 2, completed: false, createdAt: now, source: 'manual' },
      { id: 't5', title: '回归多标签一致性', date: shift(2), priority: 1, completed: false, projectId: 'pj1', createdAt: now, source: 'manual' },
      { id: 't6', title: '补充组件状态截图', date: shift(-1), priority: 3, completed: true, completedAt: now, createdAt: now, source: 'manual' },
    ];
    const habits = [
      { id: 'h1', name: '晨间拉伸', target: 1, unit: '次', color: '#34C759', createdAt: now },
      { id: 'h2', name: '阅读 30 分钟', target: 1, unit: '次', color: '#007AFF', createdAt: now },
    ];
    const habitLogs = [
      { id: 'hl1', habitId: 'h1', date: shift(0), count: 1, note: '' },
      { id: 'hl2', habitId: 'h2', date: shift(-1), count: 1, note: '' },
    ];
    const data = { version: 1, tasks, projects, habits, habitLogs, settings: { name: '流', theme: 'light', weekStart: 1, aiEnabled: true, demoData: false } };
    const tx = db.transaction(['app', 'meta'], 'readwrite');
    tx.objectStore('app').put({ schemaVersion: 2, updatedAt: now, revision: 1, writerId: 'resp', data }, 'state');
    tx.objectStore('meta').put({ revision: 1, updatedAt: now, writerId: 'resp' }, 'sync:v1');
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    db.close();
    return true;
  })()`);
}

const overflowExpr = `(() => {
  const de = document.documentElement;
  const over = de.scrollWidth - de.clientWidth;
  const offenders = [...document.querySelectorAll('body *')]
    .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > de.clientWidth + 1 || r.left < -1); })
    .slice(0, 5)
    .map((el) => (el.tagName.toLowerCase() + '.' + String(el.className || '').split(' ').slice(0, 2).join('.')));
  return { over, offenders };
})()`;

const report = { generatedAt: new Date().toISOString(), widths: {} };

async function main() {
  const child = spawn(EDGE, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
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

    for (const width of WIDTHS) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
      await sleep(400);
      const entry = { pages: {}, modal: null, menu: null };
      for (const route of PAGES) {
        await go(cdp, route);
        await sleep(500);
        entry.pages[route] = await ev(cdp, overflowExpr);
        await shot(cdp, `${width}${route.replace('/', '-')}`);
      }
      // 弹窗是否在可视范围内 + 溢出
      await go(cdp, '/today');
      await ev(cdp, `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('新建任务')); if (b) b.click(); return true; })()`);
      await sleep(600);
      entry.modal = await ev(cdp, `(() => {
        const el = [...document.querySelectorAll('[role="dialog"] > div')].pop();
        if (!el) return { found: false };
        const r = el.getBoundingClientRect();
        return { found: true, top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), vw: innerWidth, vh: innerHeight, within: r.top >= -1 && r.bottom <= innerHeight + 1 && r.left >= -1 && r.right <= innerWidth + 1, over: document.documentElement.scrollWidth - document.documentElement.clientWidth };
      })()`);
      await shot(cdp, `${width}-modal-editor`);
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await sleep(400);
      // 头像菜单是否裁切
      await ev(cdp, `document.querySelector('[aria-label="账户菜单"]').click()`);
      await sleep(500);
      entry.menu = await ev(cdp, `(() => {
        const btn = document.querySelector('[aria-label="账户菜单"]');
        const menu = [...document.querySelectorAll('div')].find((d) => d.className.includes('w-52'));
        if (!menu) return { found: false };
        const r = menu.getBoundingClientRect();
        return { found: true, top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom), vw: innerWidth, vh: innerHeight, clipped: r.right > innerWidth + 1 || r.top < -1 || r.bottom > innerHeight + 1 || (btn ? r.left < btn.getBoundingClientRect().left - 200 : false) };
      })()`);
      await shot(cdp, `${width}-menu-avatar`);
      await ev(cdp, `document.body.click()`);
      await sleep(300);
      // 项目标签 UI（无独立项目页 → 记录实际结构所在位置）
      await go(cdp, '/tasks');
      await sleep(400);
      entry.projectChips = await ev(cdp, `(() => { const chips = [...document.querySelectorAll('span')].filter((s) => ['产品迭代', '个人成长'].includes(s.textContent.trim())); return { count: chips.length, texts: chips.slice(0, 4).map((c) => c.textContent.trim()) }; })()`);
      await shot(cdp, `${width}-tasks-project-chips`);
      await ev(cdp, `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('新建任务')); if (b) b.click(); return true; })()`);
      await sleep(600);
      entry.projectSelect = await ev(cdp, `(() => { const sel = document.querySelector('#task-project'); if (!sel) return { found: false }; return { found: true, options: [...sel.options].map((o) => o.textContent.trim()), label: (sel.closest('div')?.querySelector('label')?.textContent || '').trim() }; })()`);
      await shot(cdp, `${width}-modal-project-select`);
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await sleep(300);
      report.widths[width] = entry;
    }
    // 390 深色（玻璃层级核验）
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: true });
    await go(cdp, '/settings');
    await ev(cdp, `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '深色'); if (b) b.click(); return true; })()`);
    await sleep(800);
    await go(cdp, '/today');
    await sleep(400);
    await shot(cdp, '390-dark-today');
    report.dark390 = await ev(cdp, `document.documentElement.dataset.theme`);
    fs.writeFileSync(path.join(OUT, 'responsive-report.json'), JSON.stringify(report, null, 2), 'utf8');
    console.log(JSON.stringify(report, null, 2));
  } finally {
    try { child.kill(); } catch {}
    await sleep(600);
    try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
  }
}

main().catch((e) => {
  console.error('RESPONSIVE CHECK FAILED', e);
  process.exit(1);
});
