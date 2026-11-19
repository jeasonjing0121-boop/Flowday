/**
 * Phase 4.5-C 视觉基线/对比截图：浅色+深色 × 主要页面 + 弹窗/菜单/Toast。
 * 用法：SHOTS_DIR=docs/phase4.5/screenshots-c/before node scripts/shots-4.5c.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ROOT = process.cwd();
const OUT = path.join(ROOT, process.env.SHOTS_DIR || 'docs/phase4.5/screenshots-c/before');
const PROFILE = path.join(os.tmpdir(), 'flowday-shots-45c');
const PORT = 9396;
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
  // 先等待文档真正切换（避免 evaluate 命中旧页面上下文导致 ready 误判）
  for (let i = 0; i < 100; i++) {
    const url = await ev(cdp, 'location.pathname').catch(() => '');
    if (url === route) break;
    await sleep(50);
  }
  for (let i = 0; i < 100; i++) {
    const ready = await ev(cdp, 'Boolean(window.__FD_STORAGE__ && window.__FD_STORAGE__.ready)');
    if (ready) return;
    await sleep(60);
  }
  throw new Error('page not ready: ' + route);
}

async function shot(cdp, name) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(data, 'base64'));
  console.log('shot ' + name);
}

const clickText = (cdp, text, scope = '') =>
  ev(cdp, `(() => { const root = ${scope ? `document.querySelector('${scope}')` : 'document'}; const b = [...root.querySelectorAll('button, a')].find((x) => x.textContent.trim() === '${text}'); if (b) { b.click(); return true; } return false; })()`);

async function setTheme(cdp, theme) {
  await go(cdp, '/settings');
  const label = theme === 'dark' ? '深色' : '浅色';
  const clicked = await ev(cdp, `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '${label}'); if (b) b.click(); return Boolean(b); })()`);
  if (!clicked) throw new Error('theme button not found: ' + label);
  // 等待主题真实生效（dataset 由应用主题 effect 写入）
  for (let i = 0; i < 50; i++) {
    const applied = await ev(cdp, `document.documentElement.dataset.theme === '${theme}'`);
    if (applied) break;
    await sleep(60);
  }
  const applied = await ev(cdp, `document.documentElement.dataset.theme === '${theme}'`);
  if (!applied) throw new Error('theme not applied: ' + theme);
  await sleep(400);
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
    const projects = [{ id: 'pj1', name: '产品迭代', color: '#5B5CBF', createdAt: now }];
    const tasks = [
      { id: 't1', title: '撰写 Phase 4.5 视觉规范', date: shift(0), priority: 1, completed: false, projectId: 'pj1', notes: '统一 Token / 玻璃层次 / 组件状态', createdAt: now, source: 'manual' },
      { id: 't2', title: '评审液态玻璃高光参数', date: shift(0), priority: 2, completed: false, createdAt: now, source: 'manual' },
      { id: 't3', title: '整理深色模式对比度', date: shift(0), priority: 3, completed: true, completedAt: now, createdAt: now, source: 'manual' },
      { id: 't4', title: '校准弹窗进入动效曲线', date: shift(1), priority: 2, completed: false, createdAt: now, source: 'manual' },
      { id: 't5', title: '回归多标签一致性', date: shift(2), priority: 1, completed: false, projectId: 'pj1', createdAt: now, source: 'manual' },
      { id: 't6', title: '补充组件状态截图', date: shift(-1), priority: 3, completed: true, completedAt: now, createdAt: now, source: 'manual' },
      { id: 't7', title: '阅读 Apple HIG 材质章节', date: shift(3), priority: 3, completed: false, createdAt: now, source: 'manual' },
    ];
    const habits = [
      { id: 'h1', name: '晨间拉伸', target: 1, unit: '次', color: '#34C759', createdAt: now },
      { id: 'h2', name: '阅读 30 分钟', target: 1, unit: '次', color: '#007AFF', createdAt: now },
    ];
    const habitLogs = [
      { id: 'hl1', habitId: 'h1', date: shift(0), count: 1, note: '' },
      { id: 'hl2', habitId: 'h1', date: shift(-1), count: 1, note: '' },
      { id: 'hl3', habitId: 'h2', date: shift(-1), count: 1, note: '' },
    ];
    const data = { version: 1, tasks, projects, habits, habitLogs, settings: { name: '流', theme: 'light', weekStart: 1, aiEnabled: true, demoData: false } };
    const tx = db.transaction(['app', 'meta'], 'readwrite');
    tx.objectStore('app').put({ schemaVersion: 2, updatedAt: now, revision: 1, writerId: 'shots', data }, 'state');
    tx.objectStore('meta').put({ revision: 1, updatedAt: now, writerId: 'shots' }, 'sync:v1');
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    db.close();
    return true;
  })()`);
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
    const pages = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const page = pages.filter((t) => t.type === 'page')[0];
    const cdp = new CDP(page.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } }).catch(() => undefined);

    await seed(cdp);

    for (const theme of ['light', 'dark']) {
      await setTheme(cdp, theme);
      for (const route of ['/today', '/tasks', '/calendar', '/habits', '/assistant', '/settings']) {
        await go(cdp, route);
        await sleep(500);
        await shot(cdp, `${theme}-${route.slice(1) || 'today'}`);
      }
      // 任务编辑器弹窗
      await go(cdp, '/today');
      await clickText(cdp, '新建任务');
      await sleep(600);
      await shot(cdp, `${theme}-modal-editor`);
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await sleep(400);
      // 头像菜单
      await ev(cdp, `document.querySelector('[aria-label="账户菜单"]').click()`);
      await sleep(400);
      await shot(cdp, `${theme}-menu-avatar`);
      await ev(cdp, `document.querySelector('[aria-label="账户菜单"]').click()`);
      await sleep(300);
      // 确认框（设置-清空本地数据）
      await go(cdp, '/settings');
      await clickText(cdp, '清空本地数据');
      await sleep(500);
      await shot(cdp, `${theme}-modal-confirm`);
      await ev(cdp, `(() => { const b = [...document.querySelectorAll('[data-fd-confirm] button')].find((x) => x.textContent.trim() === '取消'); if (b) b.click(); return true; })()`);
      await sleep(300);
      // Toast（成功：导出备份）
      await ev(cdp, `document.querySelector('[aria-label="账户菜单"]').click()`);
      await sleep(300);
      await clickText(cdp, '导出 JSON 备份');
      await sleep(500);
      await shot(cdp, `${theme}-toast-success`);
      await sleep(2400);
      if (theme === 'light') {
        // 错误 Toast + 导入预览错误态（仅浅色拍一次）
        const bad = path.join(ROOT, '.tmp', 'shots-bad.json');
        fs.mkdirSync(path.join(ROOT, '.tmp'), { recursive: true });
        fs.writeFileSync(bad, '{"app":"FlowDay","formatVersion":1,"schemaVersion":2,"checksum":{"alg":"sha-256","value":"' + '0'.repeat(64) + '"},"data":{"version":1,"tasks":[],"projects":[],"habits":[],"habitLogs":[],"settings":{"name":"","theme":"light","weekStart":1,"aiEnabled":true,"demoData":false}}}', 'utf8');
        await go(cdp, '/settings');
        const { root } = await cdp.send('DOM.getDocument');
        const inputs = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: 'input[type=file]' });
        await cdp.send('DOM.setFileInputFiles', { files: [bad], nodeId: inputs.nodeIds[0] });
        await sleep(900);
        await shot(cdp, 'light-modal-import-error');
        await ev(cdp, `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '取消' && x.closest('[data-fd-import-preview]')); if (b) b.click(); return true; })()`);
        await sleep(300);
        // 空状态（任务页搜索无结果）
        await go(cdp, '/tasks');
        await ev(cdp, `(() => { const i = document.querySelector('input[placeholder*="搜索"]'); if (!i) return false; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, '不存在的任务xyz'); i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
        await sleep(700);
        await shot(cdp, 'light-tasks-noresult');
      }
    }
    console.log('DONE ' + OUT);
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
