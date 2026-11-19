// FlowDay Phase 4.1 - 生产构建（vite preview）下的页面重载耗时测量
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const OUT_DIR = path.join(ROOT, 'docs', 'phase4.1');
const PROFILE = path.join(ROOT, '.tmp', 'bench-edge-profile-reload');
const BASE = 'http://127.0.0.1:4173';
const PORT = 9341;
const REPEATS = 5;
const SIZES = [1000, 5000, 10000];
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

function stats(values) {
  const v = values.filter((x) => typeof x === 'number' && x > 0);
  const sorted = [...v].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { repeats: values.map((x) => Number.isFinite(x) ? Number(x.toFixed(1)) : x), median: Number(median.toFixed(1)), max: Number(sorted[sorted.length - 1].toFixed(1)), min: Number(sorted[0].toFixed(1)) };
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
    const completed = i % 5 === 0;
    tasks.push({
      id: 'bt_' + i, title: (i % 7 === 0 ? '周报整理 ' : '基准任务 ') + i,
      notes: i % 3 === 0 ? '这是第 ' + i + ' 条任务的备注内容' : undefined,
      date: iso(d), time: i % 4 === 0 ? pad(i % 24) + ':00' : undefined, durationMin: i % 4 === 0 ? 60 : undefined,
      priority: (i % 3) + 1, projectId: projects[i % 3].id, completed,
      completedAt: completed ? new Date(today.getTime() - (i % 30) * 86400000).toISOString() : undefined,
      createdAt: new Date(today.getTime() - i * 60000).toISOString(), source: i % 9 === 0 ? 'ai' : 'manual',
    });
  }
  const habits = [
    { id: 'bh_1', name: '早起', emoji: '🌱', weeklyTarget: 7, createdAt: new Date().toISOString(), archived: false },
    { id: 'bh_2', name: '阅读', emoji: '📖', weeklyTarget: 7, createdAt: new Date().toISOString(), archived: false },
    { id: 'bh_3', name: '跑步', emoji: '🏃', weeklyTarget: 3, createdAt: new Date().toISOString(), archived: false },
  ];
  const habitLogs = [];
  for (let i = 0; i < Math.floor(n / 10); i++) habitLogs.push({ habitId: habits[i % 3].id, date: iso(new Date(today.getTime() - (i % 30) * 86400000)) });
  return { version: 1, tasks, projects, habits, habitLogs, settings: { name: '', theme: 'light', weekStart: 1, aiEnabled: true, demoData: false } };
};
window.__SEED = async (n) => {
  await new Promise((resolve) => { const r = indexedDB.deleteDatabase('flowday-db'); r.onsuccess = resolve; r.onerror = resolve; r.onblocked = resolve; });
  for (let attempt = 0; attempt < 4; attempt++) {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('flowday-db', 1);
      req.onupgradeneeded = () => { const d = req.result; if (!d.objectStoreNames.contains('app')) d.createObjectStore('app'); if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta'); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const tx = db.transaction('app', 'readwrite');
    tx.objectStore('app').put({ schemaVersion: 2, updatedAt: new Date().toISOString(), data: window.__GEN(n) }, 'state');
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    const rec = await new Promise((resolve) => { const r = db.transaction('app', 'readonly').objectStore('app').get('state'); r.onsuccess = () => resolve(r.result); r.onerror = () => resolve(null); });
    db.close();
    if ((rec?.data?.tasks?.length ?? -1) === n) return n;
    await new Promise((r) => setTimeout(r, 300));
  }
  return -1;
};
`;

const READY = String.raw`
window.__BENCH_READY_AT__ = 0;
(() => {
  const timer = setInterval(() => {
    if (document.querySelector('main') && document.querySelector('[data-fd-stats]')) {
      window.__BENCH_READY_AT__ = performance.now();
      clearInterval(timer);
    }
  }, 4);
})();
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
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: GEN });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: READY });
    await navigate(`${BASE}/vite.svg`);
    await evaluate(GEN);

    const result = { meta: { phase: '4.1-production-reload', base: BASE, repeats: REPEATS, browserVersion: version.Browser, note: 'vite preview 生产构建；页面就绪判定：main + [data-fd-stats] 出现' }, bySize: {} };
    for (const n of SIZES) {
      const samples = [];
      for (let i = 0; i < REPEATS; i++) {
        await navigate(`${BASE}/vite.svg`);
        await sleep(700);
        const seeded = await evaluate(`window.__SEED(${n})`);
        if (seeded !== n) throw new Error('seed failed ' + n);
        await navigate(`${BASE}/today`);
        let ready = 0;
        const deadline = Date.now() + 20000;
        while (Date.now() < deadline) {
          ready = await evaluate('window.__BENCH_READY_AT__ || 0');
          if (ready > 0) break;
          await sleep(8);
        }
        samples.push(ready);
      }
      result.bySize[n] = { reloadToReady: stats(samples) };
      console.log(`[生产重载] ${n}:`, JSON.stringify(result.bySize[n].reloadToReady));
    }
    fs.writeFileSync(path.join(OUT_DIR, 'perf-raw-reload-prod.json'), JSON.stringify(result, null, 2), 'utf8');
    console.log('已写出 perf-raw-reload-prod.json');
  } finally {
    try { cdp?.ws?.close(); } catch { /* ignore */ }
    try { child.kill(); } catch { /* ignore */ }
    await sleep(500);
    try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 }); } catch { /* ignore */ }
  }
}
main().catch((e) => { console.error('RELOAD BENCH FAILED:', e); process.exit(1); });
