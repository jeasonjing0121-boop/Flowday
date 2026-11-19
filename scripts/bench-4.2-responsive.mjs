// FlowDay Phase 4.2 - 大数据量下的移动端/平板布局校验（临时 profile，不影响用户数据）
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const OUT_DIR = path.join(ROOT, 'docs', 'phase4.2');
const PROFILE = path.join(ROOT, '.tmp', 'bench-4.2-mobile');
const BASE = process.env.BASE || 'http://127.0.0.1:5173';
const PORT = 9345;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.rmSync(PROFILE, { recursive: true, force: true });

class CDP {
  constructor(wsUrl) { this.ws = new WebSocket(wsUrl); this.seq = 0; this.pending = new Map(); }
  async open() {
    await new Promise((res, rej) => {
      this.ws.addEventListener('open', res, { once: true });
      this.ws.addEventListener('error', () => rej(new Error('ws error')), { once: true });
    });
    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params })); });
  }
}
let cdp;
async function evaluate(expression) {
  const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (exceptionDetails) throw new Error((exceptionDetails.exception?.description ?? exceptionDetails.text).slice(0, 300));
  return result.value;
}
async function waitDevtools() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) return r.json(); } catch { /* retry */ }
    await sleep(200);
  }
  throw new Error('devtools not ready');
}
async function pageWs() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  return list.find((t) => t.type === 'page').webSocketDebuggerUrl;
}
async function navigate(url) {
  await cdp.send('Page.navigate', { url });
  await sleep(250);
}

const GEN = String.raw`
window.__GEN = (n) => {
  const pad = (x) => String(x).padStart(2, '0');
  const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const projects = [{ id: 'p_work', name: '工作', color: '#4A5B8C' }, { id: 'p_study', name: '学习', color: '#2F7477' }, { id: 'p_life', name: '生活', color: '#B0724A' }];
  const tasks = [];
  for (let i = 0; i < n; i++) {
    const off = (i % 60) - 20;
    const d = new Date(today.getTime() + off * 86400000);
    tasks.push({
      id: 'bt_' + i, title: (i % 7 === 0 ? '周报整理 ' : '基准任务 ') + i, notes: i % 3 === 0 ? '备注 ' + i : undefined,
      date: iso(d), priority: (i % 3) + 1, projectId: projects[i % 3].id, completed: i % 5 === 0,
      createdAt: new Date(today.getTime() - i * 60000).toISOString(), source: 'manual',
    });
  }
  return { version: 1, tasks, projects, habits: [], habitLogs: [], settings: { name: '', theme: 'light', weekStart: 1, aiEnabled: true, demoData: false } };
};
window.__SEED = async (n) => {
  await new Promise((resolve) => { const r = indexedDB.deleteDatabase('flowday-db'); r.onsuccess = resolve; r.onerror = resolve; r.onblocked = resolve; });
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open('flowday-db', 1);
    req.onupgradeneeded = () => { const d = req.result; if (!d.objectStoreNames.contains('app')) d.createObjectStore('app'); if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta'); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const tx = db.transaction('app', 'readwrite');
  tx.objectStore('app').put({ schemaVersion: 2, updatedAt: new Date().toISOString(), data: window.__GEN(n) }, 'state');
  await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
  db.close();
  return n;
};
`;

async function main() {
  const child = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--headless=new', '--disable-gpu',
    '--no-first-run', '--no-default-browser-check', 'about:blank',
  ], { stdio: 'ignore' });
  try {
    const version = await waitDevtools();
    cdp = new CDP(await pageWs());
    await cdp.open();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: GEN });
    await navigate(`${BASE}/vite.svg`);
    await evaluate(GEN);

    const results = {};
    for (const [name, width, height] of [['mobile', 390, 844], ['tablet', 768, 1024], ['desktop', 1440, 900]]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 768 });
      await navigate(`${BASE}/vite.svg`);
      await sleep(500);
      await evaluate('window.__SEED(5000)');
      await navigate(`${BASE}/tasks`);
      {
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline) {
          const n = await evaluate(`document.querySelectorAll('[data-task-id]').length`);
          if (n > 0) break;
          await sleep(60);
        }
      }
      await sleep(700);
      const info = await evaluate(`(() => {
        const rows = document.querySelectorAll('[data-task-id]').length;
        const overflowX = document.documentElement.scrollWidth > window.innerWidth + 1;
        const nav = document.querySelector('nav.fd-glass');
        const navVisible = nav ? getComputedStyle(nav).display !== 'none' : false;
        const body = document.body.innerText;
        return { rows, overflowX, navVisible, pageHeight: document.documentElement.scrollHeight, hasTasksHeading: body.includes('全部任务') };
      })()`);
      // 滚动到底部再回到顶部，确认虚拟列表可继续渲染
      const scrollCheck = await evaluate(`(async () => {
        window.scrollTo(0, document.documentElement.scrollHeight);
        await new Promise((r) => setTimeout(r, 400));
        const bottomRows = document.querySelectorAll('[data-task-id]').length;
        const scrolled = window.scrollY;
        window.scrollTo(0, 0);
        await new Promise((r) => setTimeout(r, 300));
        return { bottomRows, scrolled, topRows: document.querySelectorAll('[data-task-id]').length };
      })()`);
      results[name] = { viewport: width + 'x' + height, ...info, ...scrollCheck };
      console.log(name, JSON.stringify(results[name]));
    }

    fs.writeFileSync(path.join(OUT_DIR, 'perf-4.2-responsive.json'), JSON.stringify({ meta: { phase: '4.2-responsive', base: BASE, browserVersion: version.Browser, dataset: 5000 }, results }, null, 2), 'utf8');
    console.log('已写出 perf-4.2-responsive.json');
  } finally {
    try { cdp?.ws?.close(); } catch { /* ignore */ }
    try { child.kill(); } catch { /* ignore */ }
    await sleep(400);
    try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 }); } catch { /* ignore */ }
  }
}
main().catch((e) => { console.error('RESPONSIVE BENCH FAILED:', e); process.exit(1); });
