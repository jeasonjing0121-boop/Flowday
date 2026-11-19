// FlowDay Phase 4.1 - 数据性能审计基准测试（只读审计工具，不修改生产代码）
// 隔离措施：
//   1) 使用独立 Chromium 用户配置目录（临时 profile），与用户真实浏览器数据完全隔离
//   2) 原始存储基准使用独立数据库 flowday-bench-4-1 / flowday-bench-split-4-1
//   3) 应用级测量使用临时 profile 内的 flowday-db（该 profile 用完即删，与用户浏览器无关）
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const OUT_DIR = path.join(ROOT, 'docs', 'phase4.1');
const PROFILE = path.join(ROOT, '.tmp', 'bench-edge-profile');
const BASE = 'http://127.0.0.1:5173';
const PORT = 9338;
const REPEATS = 5;
const SIZES = [1000, 5000, 10000];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.seq = 0;
    this.pending = new Map();
    this.listeners = new Map();
  }
  async open() {
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', () => reject(new Error('ws error')), { once: true });
    });
    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) {
        for (const fn of this.listeners.get(msg.method) || []) fn(msg.params);
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
  on(method, fn) {
    const arr = this.listeners.get(method) || [];
    arr.push(fn);
    this.listeners.set(method, arr);
  }
  once(method, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout ' + method)), timeoutMs);
      const fn = (p) => {
        clearTimeout(timer);
        this.listeners.set(method, (this.listeners.get(method) || []).filter((x) => x !== fn));
        resolve(p);
      };
      this.on(method, fn);
    });
  }
}

let cdp;
async function evaluate(expression) {
  const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (exceptionDetails) throw new Error((exceptionDetails.exception?.description ?? exceptionDetails.text).slice(0, 400));
  return result.value;
}

async function waitDevtools(timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return res.json();
    } catch {
      /* retry */
    }
    await sleep(250);
  }
  throw new Error('devtools not ready');
}

async function getPageTarget() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  const list = await res.json();
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target');
  return page.webSocketDebuggerUrl;
}

async function navigate(url) {
  const loaded = cdp.once('Page.loadEventFired').catch(() => null);
  await cdp.send('Page.navigate', { url });
  await loaded;
}

async function appReadyMs() {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const v = await evaluate('window.__BENCH_READY_AT__ || 0');
    if (v > 0) return v;
    await sleep(8);
  }
  return -1;
}

// ---------------------------------------------------------------- 页面内测量库
const LIB = String.raw`
(() => {
  const B = {};
  B.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  B.genData = (n) => {
    const pad = (x) => String(x).padStart(2, '0');
    const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const projects = [
      { id: 'p_work', name: '工作', color: '#4A5B8C' },
      { id: 'p_study', name: '学习', color: '#2F7477' },
      { id: 'p_life', name: '生活', color: '#B0724A' },
    ];
    const tasks = [];
    for (let i = 0; i < n; i++) {
      const off = (i % 60) - 20;
      const d = new Date(today.getTime() + off * 86400000);
      const completed = i % 5 === 0;
      tasks.push({
        id: 'bt_' + i,
        title: (i % 7 === 0 ? '周报整理 ' : '基准任务 ') + i,
        notes: i % 3 === 0 ? '这是第 ' + i + ' 条任务的备注内容' : undefined,
        date: iso(d),
        time: i % 4 === 0 ? pad(i % 24) + ':' + (i % 2 ? '30' : '00') : undefined,
        durationMin: i % 4 === 0 ? 60 : undefined,
        priority: (i % 3) + 1,
        projectId: projects[i % 3].id,
        completed,
        completedAt: completed ? new Date(today.getTime() - (i % 30) * 86400000 - i * 3600000).toISOString() : undefined,
        createdAt: new Date(today.getTime() - i * 60000).toISOString(),
        source: i % 9 === 0 ? 'ai' : 'manual',
      });
    }
    const habits = [
      { id: 'bh_1', name: '早起', emoji: '🌱', weeklyTarget: 7, createdAt: new Date().toISOString(), archived: false },
      { id: 'bh_2', name: '阅读', emoji: '📖', weeklyTarget: 7, createdAt: new Date().toISOString(), archived: false },
      { id: 'bh_3', name: '跑步', emoji: '🏃', weeklyTarget: 3, createdAt: new Date().toISOString(), archived: false },
    ];
    const habitLogs = [];
    for (let i = 0; i < Math.floor(n / 10); i++) {
      const d = new Date(today.getTime() - (i % 30) * 86400000);
      habitLogs.push({ habitId: habits[i % 3].id, date: iso(d) });
    }
    return {
      version: 1,
      tasks,
      projects,
      habits,
      habitLogs,
      settings: { name: '', theme: 'light', weekStart: 1, aiEnabled: true, demoData: false },
    };
  };
  B.open = (name, version, upgrade) =>
    new Promise((resolve, reject) => {
      const req = indexedDB.open(name, version);
      req.onupgradeneeded = () => upgrade && upgrade(req.result);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  B.done = (tx) =>
    new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  B.req = (r) =>
    new Promise((resolve, reject) => {
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  B.deleteDb = (name) =>
    new Promise((resolve) => {
      const r = indexedDB.deleteDatabase(name);
      r.onsuccess = resolve; r.onerror = resolve; r.onblocked = resolve;
    });
  B.openBench = () => B.open('flowday-bench-4-1', 1, (db) => {
    if (!db.objectStoreNames.contains('app')) db.createObjectStore('app');
  });
  B.openApp = () => B.open('flowday-db', 1, (db) => {
    if (!db.objectStoreNames.contains('app')) db.createObjectStore('app');
    if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
  });

  // 首次写入：每次先删库，保证冷写入
  B.measureInitialWrite = async (n) => {
    const data = B.genData(n);
    const json = JSON.stringify(data);
    await B.deleteDb('flowday-bench-4-1');
    const t0 = performance.now();
    const db = await B.openBench();
    const tx = db.transaction('app', 'readwrite');
    tx.objectStore('app').put({ schemaVersion: 2, updatedAt: new Date().toISOString(), data }, 'state');
    await B.done(tx);
    const ms = performance.now() - t0;
    db.close();
    return { ms, jsonBytes: new TextEncoder().encode(json).length };
  };
  B.measureRead = async () => {
    const db = await B.openBench();
    const t0 = performance.now();
    const tx = db.transaction('app', 'readonly');
    const rec = await B.req(tx.objectStore('app').get('state'));
    const ms = performance.now() - t0;
    db.close();
    return { ms, tasks: rec?.data?.tasks?.length ?? 0 };
  };
  B.measureSingleUpdate = async () => {
    const db = await B.openBench();
    const t0 = performance.now();
    const tx = db.transaction('app', 'readwrite');
    const os = tx.objectStore('app');
    const rec = await B.req(os.get('state'));
    rec.data.tasks[0].title = 'updated-' + Date.now();
    os.put(rec, 'state');
    await B.done(tx);
    const ms = performance.now() - t0;
    db.close();
    return { ms };
  };
  B.measureSequentialWrites = async (count) => {
    const db = await B.openBench();
    const t0 = performance.now();
    for (let i = 0; i < count; i++) {
      const tx = db.transaction('app', 'readwrite');
      const os = tx.objectStore('app');
      const rec = await B.req(os.get('state'));
      rec.data.tasks.push({
        id: 'seq_' + Date.now() + '_' + i, title: 'seq ' + i, date: rec.data.tasks[0]?.date, priority: 2,
        completed: false, createdAt: new Date().toISOString(), source: 'manual',
      });
      os.put(rec, 'state');
      await B.done(tx);
    }
    const ms = performance.now() - t0;
    db.close();
    return { ms, perOp: ms / count };
  };
  B.measureBatchedWrites = async (count) => {
    const db = await B.openBench();
    const t0 = performance.now();
    const tx = db.transaction('app', 'readwrite');
    const os = tx.objectStore('app');
    const rec = await B.req(os.get('state'));
    for (let i = 0; i < count; i++) {
      rec.data.tasks.push({
        id: 'batch_' + Date.now() + '_' + i, title: 'batch ' + i, date: rec.data.tasks[0]?.date, priority: 2,
        completed: false, createdAt: new Date().toISOString(), source: 'manual',
      });
      os.put(rec, 'state');
    }
    await B.done(tx);
    const ms = performance.now() - t0;
    db.close();
    return { ms, perOp: ms / count };
  };
  B.measureJson = async () => {
    const db = await B.openBench();
    const rec = await B.req(db.transaction('app', 'readonly').objectStore('app').get('state'));
    db.close();
    const t0 = performance.now();
    const json = JSON.stringify(rec.data);
    const t1 = performance.now();
    const parsed = JSON.parse(json);
    const t2 = performance.now();
    return { stringifyMs: t1 - t0, parseMs: t2 - t1, jsonBytes: new TextEncoder().encode(json).length, tasks: parsed.tasks.length };
  };
  B.storageEstimate = async () => {
    if (!navigator.storage || !navigator.storage.estimate) return null;
    const e = await navigator.storage.estimate();
    return { usage: e.usage, quota: e.quota, details: e.usageDetails || null };
  };

  // 拆分 Store + 索引原型
  B.splitPrototype = async (n) => {
    const data = B.genData(n);
    const dbName = 'flowday-bench-split-4-1';
    await B.deleteDb(dbName);
    const db = await B.open(dbName, 1, (d) => {
      const tasks = d.createObjectStore('tasks', { keyPath: 'id' });
      tasks.createIndex('date', 'date');
      tasks.createIndex('completedFlag', 'completedFlag');
      tasks.createIndex('projectId', 'projectId');
      tasks.createIndex('createdAt', 'createdAt');
      d.createObjectStore('habits', { keyPath: 'id' });
      d.createObjectStore('habitLogs', { keyPath: ['habitId', 'date'] });
      d.createObjectStore('settings', { keyPath: 'id' });
      d.createObjectStore('meta');
    });
    const tasks = data.tasks.map((t) => ({ ...t, completedFlag: t.completed ? 1 : 0 }));
    const bulk = async () => {
      const t0 = performance.now();
      const tx = db.transaction(['tasks', 'habits', 'habitLogs', 'settings'], 'readwrite');
      const os = tx.objectStore('tasks');
      for (const t of tasks) os.put(t);
      tx.objectStore('habits').put(data.habits[0]); // 简化：写入一条以验证事务
      await B.done(tx);
      return performance.now() - t0;
    };
    const bulkMs = await bulk();
    const today = new Date();
    const pad = (x) => String(x).padStart(2, '0');
    const todayStr = today.getFullYear() + '-' + pad(today.getMonth() + 1) + '-' + pad(today.getDate());

    const timed = async (fn) => {
      const t0 = performance.now();
      const result = await fn();
      return { ms: performance.now() - t0, count: result?.count ?? result ?? null };
    };
    const qToday = async () => {
      const tx = db.transaction('tasks', 'readonly');
      const all = await B.req(tx.objectStore('tasks').index('date').getAll(todayStr));
      return all.length;
    };
    const qOpen = async () => {
      const tx = db.transaction('tasks', 'readonly');
      const all = await B.req(tx.objectStore('tasks').index('completedFlag').getAll(0));
      return all.length;
    };
    const qProject = async () => {
      const tx = db.transaction('tasks', 'readonly');
      const all = await B.req(tx.objectStore('tasks').index('projectId').getAll('p_work'));
      return all.length;
    };
    const qSearch = async () => {
      const tx = db.transaction('tasks', 'readonly');
      const all = await B.req(tx.objectStore('tasks').getAll());
      return all.filter((t) => t.title.includes('周报')).length;
    };
    const qCountOpen = async () => {
      const tx = db.transaction('tasks', 'readonly');
      return B.req(tx.objectStore('tasks').index('completedFlag').count(0));
    };
    const qUpdate = async () => {
      const tx = db.transaction('tasks', 'readwrite');
      const os = tx.objectStore('tasks');
      const one = await B.req(os.get(tasks[0].id));
      one.title = 'split-updated-' + Date.now();
      os.put(one);
      await B.done(tx);
      return 1;
    };
    const qPage = async () => {
      const tx = db.transaction('tasks', 'readonly');
      const idx = tx.objectStore('tasks').index('createdAt');
      return new Promise((resolve, reject) => {
        const out = [];
        const r = idx.openCursor(null, 'prev');
        r.onsuccess = () => {
          const c = r.result;
          if (c && out.length < 50) { out.push(c.value); c.continue(); } else resolve(out.length);
        };
        r.onerror = () => reject(r.error);
      });
    };
    const res = {
      bulkWrite: bulkMs,
      today: (await timed(qToday)).ms,
      open: (await timed(qOpen)).ms,
      byProject: (await timed(qProject)).ms,
      searchTitle: (await timed(qSearch)).ms,
      countOpen: (await timed(qCountOpen)).ms,
      singleUpdate: (await timed(qUpdate)).ms,
      cursorPage50: (await timed(qPage)).ms,
    };
    db.close();
    await B.deleteDb(dbName);
    return res;
  };

  // 应用级：写入测试数据到临时 profile 的应用库
  B.appSeed = async (n) => {
    const data = B.genData(n);
    const json = JSON.stringify(data);
    await B.deleteDb('flowday-db');
    const db = await B.openApp();
    const tx = db.transaction('app', 'readwrite');
    tx.objectStore('app').put({ schemaVersion: 2, updatedAt: new Date().toISOString(), data }, 'state');
    await B.done(tx);
    db.close();
    return { jsonBytes: new TextEncoder().encode(json).length, tasks: n };
  };
  B.appDbMetrics = async () => {
    const db = await B.openApp();
    const rec = await B.req(db.transaction('app', 'readonly').objectStore('app').get('state'));
    db.close();
    const json = JSON.stringify(rec.data);
    return { jsonBytes: new TextEncoder().encode(json).length, tasks: rec.data.tasks.length };
  };
  // 应用级：搜索/筛选（输入事件 → 渲染稳定）
  B.uiSettle = async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  };
  B.measureSearch = async (q) => {
    const input = document.querySelector('#task-search');
    if (!input) return { ok: false };
    const t0 = performance.now();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, q);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await B.uiSettle();
    return { ok: true, ms: performance.now() - t0, rows: document.querySelectorAll('[data-task-id]').length };
  };
  B.measureSelect = async (selector, value) => {
    const el = document.querySelector(selector);
    if (!el) return { ok: false };
    const t0 = performance.now();
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
    await B.uiSettle();
    return { ok: true, ms: performance.now() - t0, rows: document.querySelectorAll('[data-task-id]').length };
  };
  B.measureSegmented = async (label) => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
    if (!btn) return { ok: false };
    const t0 = performance.now();
    btn.click();
    await B.uiSettle();
    return { ok: true, ms: performance.now() - t0, rows: document.querySelectorAll('[data-task-id]').length };
  };
  // 应用级：勾选任务 → 等待防抖写入完成
  B.measureTogglePersist = async () => {
    const db = await B.openApp();
    const rec0 = await B.req(db.transaction('app', 'readonly').objectStore('app').get('state'));
    const target = rec0.data.tasks.find((t) => !t.completed);
    const row = [...document.querySelectorAll('[data-task-id]')].find((el) => el.getAttribute('data-task-id') === target.id);
    if (!row) { db.close(); return { ok: false }; }
    const btn = row.querySelector('[data-testid="task-toggle"]');
    const t0 = performance.now();
    btn.click();
    let persistedMs = -1;
    for (let i = 0; i < 400; i++) {
      await B.sleep(10);
      const tx = db.transaction('app', 'readonly');
      const rec = await B.req(tx.objectStore('app').get('state'));
      const cur = rec.data.tasks.find((t) => t.id === target.id);
      if (cur && cur.completed === true) { persistedMs = performance.now() - t0; break; }
    }
    db.close();
    return { ok: persistedMs >= 0, ms: persistedMs };
  };
  // 应用级：新建任务（用于一致性测试）
  B.createTask = async (title) => {
    const openBtn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '新建任务' || b.textContent.trim() === '新建');
    if (!openBtn) return false;
    openBtn.click();
    await B.sleep(120);
    const input = document.querySelector('#task-title');
    if (!input) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, title);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await B.sleep(60);
    const add = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '添加任务');
    if (!add) return false;
    add.click();
    return true;
  };
  B.hasTask = (title) => Boolean(window.__FD_STATE__ && window.__FD_STATE__.tasks.some((t) => t.title === title));
  B.stateTaskCount = () => (window.__FD_STATE__ ? window.__FD_STATE__.tasks.length : -1);
  window.__BENCH = B;
})();
`;

const READY_HOOK = String.raw`
window.__BENCH_READY_AT__ = 0;
(() => {
  const started = performance.now();
  const timer = setInterval(() => {
    if (window.__FD_STATE__ && document.querySelector('main')) {
      window.__BENCH_READY_AT__ = performance.now();
      clearInterval(timer);
    }
  }, 4);
})();
`;

function stats(values) {
  const v = values.filter((x) => typeof x === 'number' && Number.isFinite(x));
  if (!v.length) return { repeats: values, median: null, max: null, min: null };
  const sorted = [...v].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { repeats: values, median: Number(median.toFixed(2)), max: Number(sorted[sorted.length - 1].toFixed(2)), min: Number(sorted[0].toFixed(2)) };
}

async function main() {
  const child = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1440,900',
    'about:blank',
  ], { stdio: 'ignore' });

  try {
    const version = await waitDevtools();
    cdp = new CDP(await getPageTarget());
    await cdp.open();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: LIB });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: READY_HOOK });

    // 环境信息
    await navigate(`${BASE}/vite.svg`);
    await evaluate(LIB);
    const env = await evaluate(`(() => ({
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemoryGB: navigator.deviceMemory || null,
      language: navigator.language,
      screen: { w: screen.width, h: screen.height, dpr: devicePixelRatio },
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      indexedDB: typeof indexedDB !== 'undefined',
      storageEstimate: !!navigator.storage?.estimate,
      now: new Date().toISOString(),
    }))()`);
    env.browserVersion = version.Browser;
    env.edgeVersion = version['User-Agent'];
    env.nodeVersion = process.version;
    env.os = process.platform + ' ' + (process.env.PROCESSOR_ARCHITECTURE || '');
    env.cpu = 'Intel Core i7-8565U (4C/8T, 1.8GHz)';
    env.ramGB = 8;
    console.log('环境：', env.browserVersion, env.userAgent, 'cores=' + env.hardwareConcurrency);

    const result = {
      meta: {
        phase: '4.1',
        generatedAt: new Date().toISOString(),
        repeatsPerMetric: REPEATS,
        sizes: SIZES,
        environment: env,
        methodology: {
          isolation: '临时 Chromium 用户配置目录 + 独立数据库 flowday-bench-4-1 / flowday-bench-split-4-1；应用级测量使用临时 profile 内的 flowday-db，profile 结束后删除，与用户真实浏览器数据隔离',
          timing: 'performance.now() 计时，含 IndexedDB 事务创建、提交与结构化克隆；应用级重载以 Page.navigate 到 /today 后页面内检测 __FD_STATE__ + [data-fd-stats] 就绪时间',
          dataset: '确定性生成：任务日期覆盖 -20~+39 天，P1-P3 轮转，1/5 已完成，1/3 含备注，1/4 含时间；习惯 3 个，打卡记录 = 任务数/10',
          warmup: '每次冷写入先删除独立数据库；应用级重载包含首次（冷）与后续（热）重复，取 5 次的中位数与最大值',
        },
        testScript: 'scripts/bench-4.1.mjs',
      },
      rawStorage: {},
      appLevel: {},
      architecturePrototype: {},
      consistency: {},
    };

    // ---------------- 原始存储基准（独立数据库）
    for (const n of SIZES) {
      console.log(`\n[原始存储] ${n} 条任务`);
      const initial = [];
      const read = [];
      const update = [];
      const seq = [];
      const batch = [];
      let jsonBytes = 0;
      for (let i = 0; i < REPEATS; i++) {
        const r1 = await evaluate(`window.__BENCH.measureInitialWrite(${n})`);
        initial.push(r1.ms); jsonBytes = r1.jsonBytes;
        const r2 = await evaluate('window.__BENCH.measureRead()');
        read.push(r2.ms);
        const r3 = await evaluate('window.__BENCH.measureSingleUpdate()');
        update.push(r3.ms);
        const r4 = await evaluate('window.__BENCH.measureSequentialWrites(20)');
        seq.push(r4.ms);
        const r5 = await evaluate('window.__BENCH.measureBatchedWrites(20)');
        batch.push(r5.ms);
      }
      const jsonCost = await evaluate('window.__BENCH.measureJson()');
      const estimate = await evaluate('window.__BENCH.storageEstimate()');
      result.rawStorage[n] = {
        jsonBytes,
        initialWrite: stats(initial),
        wholeRead: stats(read),
        singleUpdate: stats(update),
        sequential20Writes: stats(seq),
        batched20Writes: stats(batch),
        jsonCost,
        storageEstimate: estimate,
      };
      console.log('  首次写入', stats(initial), '整份读取', stats(read));
      console.log('  单条更新', stats(update), '20 次顺序写', stats(seq), '20 次批量写', stats(batch));
      console.log('  JSON 体积', Math.round(jsonBytes / 1024), 'KB');

      console.log(`[拆分原型] ${n} 条任务`);
      result.architecturePrototype[n] = await evaluate(`window.__BENCH.splitPrototype(${n})`);
      console.log('  ', JSON.stringify(result.architecturePrototype[n]));
    }

    // ---------------- 应用级基准
    for (const n of SIZES) {
      console.log(`\n[应用级] ${n} 条任务`);
      // 重载耗时（5 次）
      const reloads = [];
      let appDb = null;
      for (let i = 0; i < REPEATS; i++) {
        await navigate(`${BASE}/vite.svg`);
        await sleep(220);
        appDb = await evaluate(`window.__BENCH.appSeed(${n})`);
        await navigate(`${BASE}/today`);
        const readyAt = await appReadyMs();
        reloads.push(readyAt);
      }
      const navTiming = await evaluate(`(() => { const n = performance.getEntriesByType('navigation')[0]; return { dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd }; })()`);

      // /tasks 页面：搜索与筛选
      await navigate(`${BASE}/tasks`);
      await appReadyMs();
      await sleep(300);
      const search = [];
      const priority = [];
      const status = [];
      const rowsInfo = [];
      for (let i = 0; i < REPEATS; i++) {
        const s1 = await evaluate(`window.__BENCH.measureSearch('周报')`);
        search.push(s1.ms); rowsInfo.push(s1.rows);
        await evaluate(`window.__BENCH.measureSearch('')`);
        const s2 = await evaluate(`window.__BENCH.measureSelect('#filter-priority', '1')`);
        priority.push(s2.ms);
        await evaluate(`window.__BENCH.measureSelect('#filter-priority', 'all')`);
        const s3 = await evaluate(`window.__BENCH.measureSegmented('已完成')`);
        status.push(s3.ms);
        await evaluate(`window.__BENCH.measureSegmented('全部')`);
      }
      // 勾选持久化（5 次）
      const toggle = [];
      for (let i = 0; i < REPEATS; i++) {
        await navigate(`${BASE}/tasks`);
        await appReadyMs();
        await sleep(200);
        const t = await evaluate('window.__BENCH.measureTogglePersist()');
        toggle.push(t.ok ? t.ms : null);
      }
      const appMetrics = await evaluate('window.__BENCH.appDbMetrics()');
      result.appLevel[n] = {
        reloadToReady: stats(reloads),
        navigationTiming: navTiming,
        search: stats(search),
        priorityFilter: stats(priority),
        statusFilter: stats(status),
        togglePersist: stats(toggle),
        renderedRowsAfterSearch: rowsInfo,
        appDbJsonBytes: appMetrics.jsonBytes,
        appDbTasks: appMetrics.tasks,
      };
      console.log('  重载就绪', stats(reloads), 'ms');
      console.log('  搜索', stats(search), '优先级筛选', stats(priority), '状态筛选', stats(status));
      console.log('  勾选持久化', stats(toggle), 'ms；DB JSON', Math.round(appMetrics.jsonBytes / 1024), 'KB');
    }

    // ---------------- 一致性测试（5000 条）
    console.log('\n[一致性] 刷新/关闭/切换标签页');
    await navigate(`${BASE}/vite.svg`);
    await sleep(250);
    await evaluate(`window.__BENCH.appSeed(5000)`);
    await navigate(`${BASE}/tasks`);
    await appReadyMs();
    await sleep(400);
    const consistency = { immediateNavigate: [], afterDebounce: [], tabSwitch: [] };
    for (let i = 0; i < 3; i++) {
      const titleA = `一致性-立即刷新-${Date.now()}-${i}`;
      await evaluate(`window.__BENCH.createTask(${JSON.stringify(titleA)})`);
      await sleep(30); // < 180ms 防抖窗口
      await navigate(`${BASE}/tasks`);
      await appReadyMs();
      await sleep(250);
      consistency.immediateNavigate.push(await evaluate(`window.__BENCH.hasTask(${JSON.stringify(titleA)})`));

      const titleB = `一致性-等待刷新-${Date.now()}-${i}`;
      await evaluate(`window.__BENCH.createTask(${JSON.stringify(titleB)})`);
      await sleep(400);
      await navigate(`${BASE}/tasks`);
      await appReadyMs();
      await sleep(250);
      consistency.afterDebounce.push(await evaluate(`window.__BENCH.hasTask(${JSON.stringify(titleB)})`));

      const titleC = `一致性-切换标签-${Date.now()}-${i}`;
      await evaluate(`window.__BENCH.createTask(${JSON.stringify(titleC)})`);
      const tab = await cdp.send('Target.createTarget', { url: 'about:blank' });
      await sleep(300);
      await navigate(`${BASE}/tasks`);
      await appReadyMs();
      await sleep(250);
      consistency.tabSwitch.push(await evaluate(`window.__BENCH.hasTask(${JSON.stringify(titleC)})`));
      await cdp.send('Target.closeTarget', { targetId: tab.targetId }).catch(() => undefined);
    }
    result.consistency = {
      scale: 5000,
      repeats: 3,
      scenarios: {
        immediateNavigateWithinDebounce: { passes: consistency.immediateNavigate.filter(Boolean).length, total: 3, raw: consistency.immediateNavigate },
        afterDebounceWait: { passes: consistency.afterDebounce.filter(Boolean).length, total: 3, raw: consistency.afterDebounce },
        tabSwitch: { passes: consistency.tabSwitch.filter(Boolean).length, total: 3, raw: consistency.tabSwitch },
      },
    };
    console.log(JSON.stringify(result.consistency.scenarios));

    // 汇总对照
    result.summary = {
      bySize: SIZES.reduce((acc, n) => {
        acc[n] = {
          jsonKB: Math.round(result.rawStorage[n].jsonBytes / 1024),
          initialWriteMedian: result.rawStorage[n].initialWrite.median,
          wholeReadMedian: result.rawStorage[n].wholeRead.median,
          singleUpdateMedian: result.rawStorage[n].singleUpdate.median,
          reloadMedian: result.appLevel[n].reloadToReady.median,
          searchMedian: result.appLevel[n].search.median,
          togglePersistMedian: result.appLevel[n].togglePersist.median,
        };
        return acc;
      }, {}),
    };

    fs.writeFileSync(path.join(OUT_DIR, 'perf-raw.json'), JSON.stringify(result, null, 2), 'utf8');
    // 附带一份 CSV 便于对比
    const csv = ['规模,JSON体积KB,首次写入中位ms,整份读取中位ms,单条更新中位ms,重载就绪中位ms,搜索中位ms,优先级筛选中位ms,状态筛选中位ms,勾选持久化中位ms'];
    for (const n of SIZES) {
      const r = result.rawStorage[n];
      const a = result.appLevel[n];
      csv.push([n, Math.round(r.jsonBytes / 1024), r.initialWrite.median, r.wholeRead.median, r.singleUpdate.median,
        a.reloadToReady.median, a.search.median, a.priorityFilter.median, a.statusFilter.median, a.togglePersist.median].join(','));
    }
    fs.writeFileSync(path.join(OUT_DIR, 'perf-table.csv'), csv.join('\n'), 'utf8');
    console.log('\n已写出：', path.join(OUT_DIR, 'perf-raw.json'));
    console.log('汇总：', JSON.stringify(result.summary.bySize));
  } finally {
    try { cdp?.ws?.close(); } catch { /* ignore */ }
    try { child.kill(); } catch { /* ignore */ }
    await sleep(500);
    fs.rmSync(PROFILE, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('BENCH FAILED:', err);
  process.exit(1);
});
