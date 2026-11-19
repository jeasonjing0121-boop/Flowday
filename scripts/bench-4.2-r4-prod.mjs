// FlowDay Phase 4.2 R4 生产构建测量（无 dev 埋点，用 DOM 信号作为结果显示时刻）
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const OUT_DIR = path.join(ROOT, 'docs', 'phase4.2');
const PROFILE = path.join(ROOT, '.tmp', 'bench-4.2-r4-prod');
const BASE = process.env.BASE || 'http://127.0.0.1:4173';
const PORT = 9347;
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
async function waitFor(expr, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(expr)) return true;
    await sleep(10);
  }
  return false;
}

function stats(values) {
  const v = values.filter((x) => typeof x === 'number' && Number.isFinite(x));
  if (!v.length) return { repeats: values, median: null, max: null, min: null };
  const sorted = [...v].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { repeats: values.map((x) => (Number.isFinite(x) ? Number(x.toFixed(1)) : x)), median: Number(median.toFixed(1)), max: Number(sorted[sorted.length - 1].toFixed(1)), min: Number(sorted[0].toFixed(1)) };
}

const LIB = String.raw`
window.__GEN = (n) => {
  const pad = (x) => String(x).padStart(2, '0');
  const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const projects = [{ id: 'p_work', name: '工作', color: '#4A5B8C' }];
  const tasks = [];
  for (let i = 0; i < n; i++) {
    const off = (i % 60) - 20;
    const d = new Date(today.getTime() + off * 86400000);
    tasks.push({
      id: 'bt_' + i, title: (i % 7 === 0 ? '周报整理 ' : '基准任务 ') + i,
      notes: i % 3 === 0 ? '备注内容 ' + i : undefined,
      date: iso(d), priority: (i % 3) + 1, projectId: 'p_work', completed: i % 5 === 0,
      completedAt: i % 5 === 0 ? new Date(today.getTime() - (i % 30) * 86400000).toISOString() : undefined,
      createdAt: new Date(today.getTime() - i * 60000).toISOString(), source: 'manual',
    });
  }
  return { version: 1, tasks, projects, habits: [], habitLogs: [], settings: { name: '', theme: 'light', weekStart: 1, aiEnabled: true, demoData: false } };
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
window.__UI = {
  input: () => document.querySelector('#task-search'),
  setInput: (value) => {
    const el = window.__UI.input();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return performance.now();
  },
  composeStart: () => window.__UI.input().dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })),
  composeEnd: (value) => {
    const el = window.__UI.input();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    const at = performance.now();
    el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: value }));
    return at;
  },
  filteredShown: () => Boolean(document.querySelector('[data-fd-group="filtered"]')),
  waitFiltered: async (want, from, timeoutMs) => {
    const t0 = typeof from === 'number' ? from : performance.now();
    const deadline = performance.now() + (timeoutMs || 5000);
    while (performance.now() < deadline) {
      if (window.__UI.filteredShown() === want) return performance.now() - t0;
      await new Promise((r) => setTimeout(r, 5));
    }
    return -1;
  },
  total: () => (window.__FD_STATE__ ? window.__FD_STATE__.tasks.length : 0),
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

    const result = {
      meta: {
        phase: '4.2-r4-prod',
        generatedAt: new Date().toISOString(),
        base: BASE,
        repeats: REPEATS,
        browserVersion: version.Browser,
        method: '生产构建（无 dev 埋点）：以 [data-fd-group="filtered"] 的出现/消失作为结果已显示信号；延迟从最后一次输入/组合结束事件起算',
      },
      bySize: {},
    };

    for (const n of SIZES) {
      const type5 = [];
      const enter = [];
      const ime = [];
      const clear = [];
      const imeDuring = [];
      for (let rep = 0; rep < REPEATS; rep++) {
        await navigate(`${BASE}/vite.svg`);
        await sleep(500);
        const seeded = await evaluate(`window.__SEED(${n})`);
        if (seeded !== n) throw new Error('seed failed');
        await navigate(`${BASE}/tasks`);
        await waitFor(`document.querySelectorAll('[data-task-id]').length > 0`, 15000);
        await sleep(300);

        // 连续输入 5 次
        const t5 = await evaluate(`(async () => {
          const seq = ['周', '周报', '周报', '周报整', '周报'];
          let last = performance.now();
          for (const v of seq) {
            last = window.__UI.setInput(v);
            await new Promise((r) => setTimeout(r, 30));
          }
          const delay = await window.__UI.waitFiltered(true, last, 5000);
          return delay;
        })()`);
        type5.push(t5);
        await evaluate(`window.__UI.setInput('')`);
        await evaluate(`window.__UI.waitFiltered(false, performance.now(), 3000)`);
        await sleep(150);

        // Enter 立即搜索
        const enterSetup = await evaluate(`(() => { const el = window.__UI.input(); el.focus(); return window.__UI.setInput('周报'); })()`);
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
        enter.push(await evaluate(`window.__UI.waitFiltered(true, ${enterSetup}, 3000)`));
        await evaluate(`window.__UI.setInput('')`);
        await evaluate(`window.__UI.waitFiltered(false, performance.now(), 3000)`);
        await sleep(150);

        // 中文输入法
        const imeRes = await evaluate(`(async () => {
          window.__UI.composeStart();
          window.__UI.setInput('zhou');
          await new Promise((r) => setTimeout(r, 60));
          window.__UI.setInput('zhoub');
          await new Promise((r) => setTimeout(r, 60));
          const during = window.__UI.filteredShown();
          const endedAt = window.__UI.composeEnd('周报');
          const delay = await window.__UI.waitFiltered(true, endedAt, 3000);
          return { delay, during };
        })()`);
        imeDuring.push(imeRes.during);
        ime.push(imeRes.delay);
        await evaluate(`window.__UI.setInput('')`);
        await evaluate(`window.__UI.waitFiltered(false, performance.now(), 3000)`);
        await sleep(150);

        // 清空搜索
        await evaluate(`window.__UI.setInput('周报')`);
        await evaluate(`window.__UI.waitFiltered(true, performance.now(), 3000)`);
        const clearAt = await evaluate(`window.__UI.setInput('')`);
        clear.push(await evaluate(`window.__UI.waitFiltered(false, ${clearAt}, 3000)`));
        await sleep(120);
      }
      result.bySize[n] = {
        type5: stats(type5),
        enter: stats(enter),
        ime: stats(ime),
        imeNoSearchDuringComposition: imeDuring.every((x) => x === false),
        clear: stats(clear),
      };
      console.log(`[prod ${n}] type5`, JSON.stringify(result.bySize[n].type5), 'enter', JSON.stringify(result.bySize[n].enter), 'ime', JSON.stringify(result.bySize[n].ime), 'clear', JSON.stringify(result.bySize[n].clear));
    }

    fs.writeFileSync(path.join(OUT_DIR, 'perf-4.2-r4-prod.json'), JSON.stringify(result, null, 2), 'utf8');
    console.log('已写出 perf-4.2-r4-prod.json');
  } finally {
    try { cdp?.ws?.close(); } catch { /* ignore */ }
    try { child.kill(); } catch { /* ignore */ }
    await sleep(400);
    try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 }); } catch { /* ignore */ }
  }
}
main().catch((e) => { console.error('R4 PROD BENCH FAILED:', e); process.exit(1); });
