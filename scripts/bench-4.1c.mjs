// FlowDay Phase 4.1 - 第三轮：直接调用真实生产模块测量（Vite dev server 提供 ESM）
// 不修改任何生产代码；临时 profile，独立于用户数据
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const OUT_DIR = path.join(ROOT, 'docs', 'phase4.1');
const PROFILE = path.join(ROOT, '.tmp', 'bench-edge-profile-c');
const BASE = 'http://127.0.0.1:5173';
const PORT = 9340;
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
  const deadline = Date.now() + 40000;
  while (Date.now() < deadline) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) return r.json(); } catch { /* retry */ }
    await sleep(250);
  }
  throw new Error('devtools not ready');
}
async function pageWs() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  return list.find((t) => t.type === 'page').webSocketDebuggerUrl;
}
async function navigate(url) {
  await cdp.send('Page.navigate', { url });
  await sleep(300);
}

function stats(values) {
  const v = values.filter((x) => typeof x === 'number' && Number.isFinite(x));
  const sorted = [...v].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { repeats: values.map((x) => Number(x.toFixed(2))), median: Number(median.toFixed(2)), max: Number(sorted[sorted.length - 1].toFixed(2)), min: Number(sorted[0].toFixed(2)) };
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
`;

const SEED = String.raw`
window.__SEED = async (data) => {
  await new Promise((resolve) => { const r = indexedDB.deleteDatabase('flowday-db'); r.onsuccess = resolve; r.onerror = resolve; r.onblocked = resolve; });
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open('flowday-db', 1);
    req.onupgradeneeded = () => { const d = req.result; if (!d.objectStoreNames.contains('app')) d.createObjectStore('app'); if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta'); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const tx = db.transaction('app', 'readwrite');
  tx.objectStore('app').put({ schemaVersion: 2, updatedAt: new Date().toISOString(), data }, 'state');
  await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
  db.close();
  return data.tasks.length;
};
`;

const RUN = String.raw`
(async () => {
  if (window.__RESULT) return window.__RESULT;
  const data = window.__GEN.__pendingN;
  return true;
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
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: GEN });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: SEED });
    await navigate(`${BASE}/vite.svg`);
    await evaluate(GEN);
    await evaluate(SEED);

    const result = {
      meta: {
        phase: '4.1-modules',
        generatedAt: new Date().toISOString(),
        repeats: REPEATS,
        browserVersion: version.Browser,
        note: '直接 import Vite dev server 暴露的真实生产模块（/src/lib/selectors.ts、/src/lib/data.ts、/src/lib/storage/db.ts、/src/lib/storage/backup.ts），测量真实函数耗时',
      },
      modules: {},
    };

    for (const n of SIZES) {
      const data = await evaluate(`window.__GEN(${n})`);
      await evaluate(`window.__SEED(window.__GEN(${n}))`);
      const out = await evaluate(`(async () => {
        const sel = await import('/src/lib/selectors.ts');
        const dataMod = await import('/src/lib/data.ts');
        const dbMod = await import('/src/lib/storage/db.ts');
        const backup = await import('/src/lib/storage/backup.ts');
        const data = window.__GEN(${n});
        const time = (fn) => {
          const samples = [];
          let n = 0;
          for (let i = 0; i < 5; i++) {
            const t0 = performance.now();
            const r = fn();
            samples.push(performance.now() - t0);
            n = typeof r === 'number' ? r : (Array.isArray(r) ? r.length : 0);
          }
          samples.sort((a, b) => a - b);
          return { ms: samples[2], max: samples[4], n };
        };
        const timeAsync = async (fn) => {
          const samples = [];
          let n = 0;
          for (let i = 0; i < 5; i++) {
            const t0 = performance.now();
            const r = await fn();
            samples.push(performance.now() - t0);
            n = typeof r === 'number' ? r : (Array.isArray(r) ? r.length : 0);
          }
          samples.sort((a, b) => a - b);
          return { ms: samples[2], max: samples[4], n };
        };
        const json = JSON.stringify(data);
        const res = {
          tasks: data.tasks.length,
          jsonBytes: new TextEncoder().encode(json).length,
          sortTasks: time(() => sel.sortTasks(data.tasks)),
          todayStats: time(() => sel.todayStats(data)),
          last7DayCompletion: time(() => sel.last7DayCompletion(data)),
          focusTasks: time(() => sel.focusTasks(data)),
          filterQuery: time(() => sel.filterTasks(data.tasks, { query: '周报' })),
          filterPriority: time(() => sel.filterTasks(data.tasks, { priority: 1 })),
          filterStatusDone: time(() => sel.filterTasks(data.tasks, { status: 'done' })),
          filterDateToday: time(() => sel.filterTasks(data.tasks, { date: 'today' })),
          sanitizeImportedData: time(() => dataMod.sanitizeImportedData(data)),
          parseImportedData: time(() => dataMod.parseImportedData(json)),
          migrateStoredState: null,
          validateBackup: time(() => backup.validateBackup(JSON.stringify(backup.createBackup(data)))),
          jsonStringify: time(() => JSON.stringify(data)),
          jsonParse: time(() => JSON.parse(json)),
          idbReadState: await timeAsync(() => dbMod.getState()),
          idbWriteState: await timeAsync(() => dbMod.putState(data)),
        };
        const schemaMod = await import('/src/lib/storage/schema.ts');
        {
          const samples = [];
          for (let i = 0; i < 5; i++) {
            const t0 = performance.now();
            schemaMod.migrateStoredState({ schemaVersion: 2, data });
            samples.push(performance.now() - t0);
          }
          samples.sort((a, b) => a - b);
          res.migrateStoredState = { ms: samples[2], max: samples[4], n: data.tasks.length };
        }
        return res;
      })()`);
      result.modules[n] = out;
      console.log(`[真实模块] ${n}: sort=${out.sortTasks.ms.toFixed(1)} stats=${out.todayStats.ms.toFixed(1)} last7=${out.last7DayCompletion.ms.toFixed(1)} filterQuery=${out.filterQuery.ms.toFixed(1)} sanitize=${out.sanitizeImportedData.ms.toFixed(1)} idbRead=${out.idbReadState.ms.toFixed(1)} idbWrite=${out.idbWriteState.ms.toFixed(1)} jsonKB=${Math.round(out.jsonBytes / 1024)}`);
    }

    // 事务开销：100 次空事务 vs 一次包含 100 个 put 的事务（10k 数据）
    const txCost = await evaluate(`(async () => {
      const dbMod = await import('/src/lib/storage/db.ts');
      const db = await new Promise((resolve, reject) => { const r = indexedDB.open('tx-bench-4-1', 1); r.onupgradeneeded = () => r.result.createObjectStore('app'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      const data = window.__GEN(10000);
      const store = () => db.transaction('app', 'readwrite').objectStore('app');
      // 预热
      { const tx = db.transaction('app', 'readwrite'); tx.objectStore('app').put({ data }, 'state'); await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; }); }
      const seq = [];
      const t0 = performance.now();
      for (let i = 0; i < 50; i++) {
        const tx = db.transaction('app', 'readwrite');
        tx.objectStore('app').put({ data }, 'state');
        await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
      }
      seq.push((performance.now() - t0) / 50);
      const t1 = performance.now();
      const ofs = await new Promise((resolve) => { const r = db.transaction('app', 'readonly'); const q = r.objectStore('app').openCursor(); q.onsuccess = () => resolve(1); });
      const oneRead = performance.now() - t1;
      db.close();
      await new Promise((resolve) => { const r = indexedDB.deleteDatabase('tx-bench-4-1'); r.onsuccess = resolve; r.onerror = resolve; r.onblocked = resolve; });
      return { avgSequentialTransaction: seq[0], singleCursorRead: oneRead, ofs };
    })()`);
    result.transactionCost = txCost;
    console.log('事务开销：', JSON.stringify(txCost));

    fs.writeFileSync(path.join(OUT_DIR, 'perf-raw-modules.json'), JSON.stringify(result, null, 2), 'utf8');
    console.log('已写出 perf-raw-modules.json');
  } finally {
    try { cdp?.ws?.close(); } catch { /* ignore */ }
    try { child.kill(); } catch { /* ignore */ }
    await sleep(500);
    try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 }); } catch { /* Edge 仍占用，忽略 */ }
  }
}
main().catch((e) => { console.error('BENCH-C FAILED:', e); process.exit(1); });
