// FlowDay Phase 4.2 R4：滚动位置行为校验（条件变化才回顶；数据变化不回顶）
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const OUT_DIR = path.join(ROOT, 'docs', 'phase4.2');
const PROFILE = path.join(ROOT, '.tmp', 'bench-4.2-scroll');
const BASE = process.env.BASE || 'http://127.0.0.1:5173';
const PORT = 9348;
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
async function navigate(url) { await cdp.send('Page.navigate', { url }); await sleep(250); }
async function waitFor(expr, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await evaluate(expr)) return true; await sleep(10); }
  return false;
}

const LIB = String.raw`
window.__GEN = (n) => {
  const pad = (x) => String(x).padStart(2, '0');
  const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tasks = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(today.getTime() + ((i % 60) - 20) * 86400000);
    tasks.push({ id: 'bt_' + i, title: (i % 7 === 0 ? '周报整理 ' : '基准任务 ') + i, date: iso(d), priority: (i % 3) + 1, completed: i % 5 === 0, createdAt: new Date(today.getTime() - i * 60000).toISOString(), source: 'manual' });
  }
  return { version: 1, tasks, projects: [], habits: [], habitLogs: [], settings: { name: '', theme: 'light', weekStart: 1, aiEnabled: true, demoData: false } };
};
window.__SEED = async (n) => {
  await new Promise((resolve) => { const r = indexedDB.deleteDatabase('flowday-db'); r.onsuccess = resolve; r.onerror = resolve; r.onblocked = resolve; });
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open('flowday-db', 1);
    req.onupgradeneeded = () => { const d = req.result; if (!d.objectStoreNames.contains('app')) d.createObjectStore('app'); if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta'); };
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
  const tx = db.transaction('app', 'readwrite');
  tx.objectStore('app').put({ schemaVersion: 2, updatedAt: new Date().toISOString(), data: window.__GEN(n) }, 'state');
  await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
  db.close();
  return n;
};
window.__UI = {
  setInput: (v) => { const el = document.querySelector('#task-search'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); },
  listTop: () => { const el = [...document.querySelectorAll('section.fd-card')][0]; return el ? el.getBoundingClientRect().top + window.scrollY : 0; },
};
`;

async function main() {
  const child = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--headless=new', '--disable-gpu',
    '--no-first-run', '--no-default-browser-check', '--window-size=1440,900', 'about:blank',
  ], { stdio: 'ignore' });
  try {
    const version = await waitDevtools();
    cdp = new CDP(await pageWs());
    await cdp.open();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: LIB });
    await navigate(`${BASE}/vite.svg`);
    await evaluate(LIB);
    await evaluate('window.__SEED(5000)');
    await navigate(`${BASE}/tasks`);
    await waitFor(`document.querySelectorAll('[data-task-id]').length > 0`, 15000);
    await sleep(500);

    // 1) 滚动到列表中部，然后勾选一条任务（数据变化，不应回顶）
    await evaluate('window.scrollTo(0, 4000)');
    await sleep(300);
    const beforeToggle = await evaluate('window.scrollY');
    await evaluate(`(() => {
      const rows = [...document.querySelectorAll('[data-task-id]')];
      const visible = rows.find((r) => {
        const rect = r.getBoundingClientRect();
        return rect.top > 0 && rect.top < window.innerHeight;
      });
      const btn = visible && visible.querySelector('[data-testid="task-toggle"]');
      if (btn) btn.click();
      return true;
    })()`);
    await sleep(900);
    const afterToggle = await evaluate('window.scrollY');

    // 2) 修改搜索条件（有效条件变化，应回到列表顶部）
    const queryAt = await evaluate('window.__UI.setInput("周报")');
    await waitFor(`document.body.innerText.includes("筛选结果")`, 3000);
    await sleep(400);
    const afterQuery = await evaluate('window.scrollY');
    const listTop = await evaluate('window.__UI.listTop()');

    // 3) 清空搜索后仍保持在列表上方（不额外跳动）
    await evaluate('window.__UI.setInput("")');
    await sleep(500);
    const afterClear = await evaluate('window.scrollY');

    const result = {
      meta: { phase: '4.2-r4-scroll', base: BASE, browserVersion: version.Browser, dataset: 5000 },
      dataChangeKeptScroll: Math.abs(afterToggle - beforeToggle) <= 8,
      beforeToggle,
      afterToggle,
      conditionChangeResetToTop: afterQuery <= listTop + 80,
      afterQuery,
      listTop,
      clearKeptPosition: Math.abs(afterClear - afterQuery) <= 80,
      afterClear,
    };
    console.log(JSON.stringify(result));
    fs.writeFileSync(path.join(OUT_DIR, 'perf-4.2-scroll.json'), JSON.stringify(result, null, 2), 'utf8');
    console.log('已写出 perf-4.2-scroll.json');
  } finally {
    try { cdp?.ws?.close(); } catch { /* ignore */ }
    try { child.kill(); } catch { /* ignore */ }
    await sleep(400);
    try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 }); } catch { /* ignore */ }
  }
}
main().catch((e) => { console.error('SCROLL BENCH FAILED:', e); process.exit(1); });
