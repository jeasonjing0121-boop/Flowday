// FlowDay Phase 4.2 R3/R4 基准：Dashboard 聚合、搜索防抖/IME 真实测量
// 用法：node scripts/bench-4.2-r3r4.mjs  （开发服务器 5173；dev 埋点用于计数）
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const OUT_DIR = path.join(ROOT, 'docs', 'phase4.2');
const BASE = process.env.BASE || 'http://127.0.0.1:5173';
const PROFILE = path.join(ROOT, '.tmp', 'bench-4.2-r3r4');
const PORT = Number(process.env.CDP_PORT || 9346);
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
  if (exceptionDetails) throw new Error((exceptionDetails.exception?.description ?? exceptionDetails.text).slice(0, 400));
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
async function waitFor(expr, timeout = 10000) {
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
  return { repeats: values.map((x) => (Number.isFinite(x) ? Number(x.toFixed(2)) : x)), median: Number(median.toFixed(2)), max: Number(sorted[sorted.length - 1].toFixed(2)), min: Number(sorted[0].toFixed(2)) };
}

const LIB = String.raw`
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
      notes: i % 3 === 0 ? '备注内容 ' + i : undefined,
      date: iso(d), time: i % 4 === 0 ? pad(i % 24) + ':00' : undefined, durationMin: i % 4 === 0 ? 60 : undefined,
      priority: (i % 3) + 1, projectId: projects[i % 3].id, completed,
      completedAt: completed ? new Date(today.getTime() - (i % 30) * 86400000).toISOString() : undefined,
      createdAt: new Date(today.getTime() - i * 60000).toISOString(), source: i % 9 === 0 ? 'ai' : 'manual',
    });
  }
  const habits = [
    { id: 'bh_1', name: '早起', emoji: '🌱', weeklyTarget: 7, createdAt: new Date().toISOString(), archived: false },
    { id: 'bh_2', name: '阅读', emoji: '📖', weeklyTarget: 7, createdAt: new Date().toISOString(), archived: false },
  ];
  const habitLogs = [{ habitId: 'bh_1', date: iso(today) }];
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
window.__UI = {
  resetCounters: () => {
    window.__FD_PAGE_RENDERS__ = 0;
    window.__FD_FILTER_COUNT__ = 0;
    window.__FD_FILTER_MS__ = 0;
    window.__FD_LAST_FILTERED_LEN__ = null;
    window.__FD_FILTER_LAST_KEY__ = undefined;
    window.__FD_AGG_MS__ = 0;
    window.__FD_AGG_COUNT__ = 0;
    window.__FD_DASH_RENDERS__ = 0;
  },
  counters: () => ({
    filterCount: window.__FD_FILTER_COUNT__ || 0,
    filterMs: window.__FD_FILTER_MS__ || null,
    filteredLen: window.__FD_LAST_FILTERED_LEN__ ?? null,
    pageRenders: window.__FD_PAGE_RENDERS__ || 0,
    aggMs: window.__FD_AGG_MS__ || null,
    aggCount: window.__FD_AGG_COUNT__ || 0,
    dashRenders: window.__FD_DASH_RENDERS__ || 0,
  }),
  input: () => document.querySelector('#task-search'),
  setInput: (value) => {
    const el = window.__UI.input();
    if (!el) return null;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return el.value;
  },
  composeStart: () => { const el = window.__UI.input(); if (el) el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); },
  composeEnd: (value) => {
    const el = window.__UI.input();
    if (!el) return null;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: value }));
    return el.value;
  },
  keydown: (key) => { const el = window.__UI.input(); if (el) el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); },
  waitFilteredLen: async (expected, timeoutMs, from) => {
    const t0 = typeof from === 'number' ? from : performance.now();
    const deadline = performance.now() + (timeoutMs || 5000);
    while (performance.now() < deadline) {
      if (window.__FD_LAST_FILTERED_LEN__ === expected) return performance.now() - t0;
      await new Promise((r) => setTimeout(r, 5));
    }
    return -1;
  },
  waitPendingGone: async (timeoutMs) => {
    const t0 = performance.now();
    const deadline = t0 + (timeoutMs || 5000);
    while (performance.now() < deadline) {
      if (!document.body.innerText.includes('搜索中…')) return performance.now() - t0;
      await new Promise((r) => setTimeout(r, 5));
    }
    return -1;
  },
  total: () => (window.__FD_STATE__ ? window.__FD_STATE__.tasks.length : 0),
  // R3 模块高精度测量
  r3: async (n) => {
    const sel = await import('/src/lib/selectors.ts');
    const data = window.__GEN(n);
    const today = new Date();
    const pad = (x) => String(x).padStart(2, '0');
    const todayKey = today.getFullYear() + '-' + pad(today.getMonth() + 1) + '-' + pad(today.getDate());
    const timeIt = (fn) => { const t0 = performance.now(); const r = fn(); return { ms: performance.now() - t0, result: r }; };
    const oldOne = () => {
      const stats = sel.todayStats(data);
      const focus = sel.focusTasks(data, 3);
      const timeline = sel.todayOpenTasks(data).filter((t) => t.time).sort((a, b) => (a.time || '').localeCompare(b.time || '') || a.priority - b.priority);
      const week = sel.last7DayCompletion(data);
      return { stats, focus, timeline, week };
    };
    const oldSamples = [];
    const newSamples = [];
    for (let i = 0; i < 5; i++) oldSamples.push(timeIt(oldOne).ms);
    let agg;
    for (let i = 0; i < 5; i++) {
      const r = timeIt(() => sel.dashboardAggregate(data, todayKey));
      newSamples.push(r.ms);
      agg = r.result;
    }
    const old = oldOne();
    const mismatches = [];
    if (JSON.stringify([agg.total, agg.done, agg.open, agg.percent]) !== JSON.stringify([old.stats.total, old.stats.done, old.stats.open, old.stats.percent])) mismatches.push('stats');
    if (JSON.stringify(agg.focus.map((t) => t.id)) !== JSON.stringify(old.focus.map((t) => t.id))) mismatches.push('focus');
    if (JSON.stringify(agg.week) !== JSON.stringify(old.week)) mismatches.push('week');
    if (JSON.stringify(agg.timeline.map((t) => t.id)) !== JSON.stringify(old.timeline.map((t) => t.id))) mismatches.push('timeline');
    const oldChecked = sel.activeHabits(data).filter((h) => sel.isHabitChecked(data, h.id, todayKey)).length;
    if (agg.habitChecked !== oldChecked) mismatches.push('habits');
    return { oldSamples, newSamples, oldMedian: oldSamples.slice().sort((a, b) => a - b)[2], newMedian: newSamples.slice().sort((a, b) => a - b)[2], mismatches, scansOld: 11, scansNew: agg.scans };
  },
  // R3 应用级：Dashboard 就绪后读取埋点
  dashInfo: () => ({
    aggMs: window.__FD_AGG_MS__ || null,
    aggCount: window.__FD_AGG_COUNT__ || 0,
    dashRenders: window.__FD_DASH_RENDERS__ || 0,
    statsJson: (document.querySelector('[data-fd-stats]') || { getAttribute: () => null }).getAttribute('data-fd-stats'),
  }),
  waitStatsChange: async (expectedJson, timeoutMs) => {
    const t0 = performance.now();
    const deadline = t0 + (timeoutMs || 8000);
    while (performance.now() < deadline) {
      const el = document.querySelector('[data-fd-stats]');
      if (el && el.getAttribute('data-fd-stats') === expectedJson) return performance.now() - t0;
      await new Promise((r) => setTimeout(r, 5));
    }
    return -1;
  },
  toggleFirstFocus: () => new Promise((resolve) => {
    const row = document.querySelector('[data-task-id] [data-testid="task-toggle"]');
    if (!row) return resolve(null);
    const attrOf = () => document.querySelector('[data-fd-stats]')?.getAttribute('data-fd-stats') || null;
    const before = attrOf();
    window.__FD_AGG_COUNT__ = 0;
    const t0 = performance.now();
    row.click();
    // 等待两帧：覆盖 React 提交 + 布局后的可观测更新时间
    requestAnimationFrame(() => requestAnimationFrame(() => {
      resolve({ before, after: attrOf(), delayMs: performance.now() - t0, aggCount: window.__FD_AGG_COUNT__ || 0 });
    }));
  }),
};
`;

const HOOKS = String.raw`
window.__BENCH_PUT__ = { start: 0, end: 0 };
(() => {
  const origPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args) {
    const res = origPut.apply(this, args);
    try {
      const tx = this.transaction;
      window.__BENCH_PUT__.start = performance.now();
      window.__BENCH_PUT__.end = 0;
      tx.addEventListener('complete', () => { window.__BENCH_PUT__.end = performance.now(); });
    } catch { /* ignore */ }
    return res;
  };
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
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: LIB });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: HOOKS });
    await navigate(`${BASE}/vite.svg`);
    await evaluate(LIB);

    const result = {
      meta: {
        phase: '4.2-r3r4',
        generatedAt: new Date().toISOString(),
        base: BASE,
        repeats: REPEATS,
        browserVersion: version.Browser,
        environment: await evaluate(`({ userAgent: navigator.userAgent, cores: navigator.hardwareConcurrency, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })`),
        method: {
          r3Module: '页面内动态 import 真实 selectors.ts，分别测量旧实现（todayStats+focusTasks+todayOpenTasks+last7DayCompletion）与新 dashboardAggregate，各 5 次取中位',
          r3App: '开发态埋点 __FD_AGG_MS__（聚合单次耗时）与 __FD_DASH_RENDERS__（Dashboard 渲染次数）；勾选后以 data-fd-stats 属性变化时刻为更新完成',
          r4: '输入事件派发后等待 __FD_LAST_FILTERED_LEN__ 等于期望值；防抖等待与计算时间分列（filterMs 为单次 filterTasks 耗时）',
          ime: '分别派发 compositionstart / input / compositionend 事件，统计组合期间与组合结束后的 filter 计数',
        },
      },
      r3: { module: {}, app: {} },
      r4: {},
    };

    for (const n of SIZES) {
      console.log(`\n[R3] ${n}`);
      const moduleRes = await evaluate(`window.__UI.r3(${n})`);
      result.r3.module[n] = {
        oldMedianMs: moduleRes.oldMedian,
        newMedianMs: moduleRes.newMedian,
        scansOld: moduleRes.scansOld,
        scansNew: moduleRes.scansNew,
        mismatches: moduleRes.mismatches,
        oldSamples: moduleRes.oldSamples,
        newSamples: moduleRes.newSamples,
      };
      console.log('  module 旧/新', moduleRes.oldMedian, '/', moduleRes.newMedian, 'mismatches', moduleRes.mismatches);

      // 应用级 Dashboard：首次计算 + 勾选更新
      const firstAgg = [];
      const firstAggCount = [];
      const toggleDelays = [];
      const toggleWrite = [];
      const toggleAggCounts = [];
      const toggleOk = [];
      for (let rep = 0; rep < REPEATS; rep++) {
        await navigate(`${BASE}/vite.svg`);
        await sleep(700);
        const seeded = await evaluate(`window.__SEED(${n})`);
        if (seeded !== n) throw new Error('seed failed ' + n);
        await navigate(`${BASE}/today`);
        await waitFor(`Boolean(document.querySelector('[data-fd-stats]'))`, 15000);
        await sleep(250);
        const info = await evaluate('window.__UI.dashInfo()');
        firstAgg.push(info.aggMs);
        firstAggCount.push(info.aggCount);
        // 勾选首条焦点任务，观察统计更新与持久化
        const toggle = await evaluate('window.__UI.toggleFirstFocus()');
        let okStats = false;
        if (toggle && toggle.before) {
          const obj = JSON.parse(toggle.before);
          const after = toggle.after ? JSON.parse(toggle.after) : null;
          okStats = Boolean(after && after.done === obj.done + 1 && after.open === Math.max(0, obj.open - 1));
          toggleAggCounts.push(toggle.aggCount);
        }
        const hook = await evaluate('window.__BENCH_PUT__');
        toggleDelays.push(toggle ? toggle.delayMs : null);
        toggleOk.push(okStats);
        toggleWrite.push(hook && hook.end > 0 ? hook.end - hook.start : null);
        await sleep(200);
      }
      result.r3.app[n] = {
        firstAggMs: stats(firstAgg),
        firstAggCount: firstAggCount,
        toggleStatsUpdateMs: stats(toggleDelays),
        toggleStatsCorrect: toggleOk.every(Boolean),
        toggleAggregateCounts: toggleAggCounts,
        toggleWriteMs: stats(toggleWrite),
      };
      console.log('  Dashboard 首次聚合', stats(firstAgg), '勾选→统计更新', stats(toggleDelays));
    }

    // R4 搜索场景（以 10k 为主，同时也测 1k/5k 的连续输入）
    const searchScenarios = {};
    for (const n of SIZES) {
      console.log(`\n[R4] ${n}`);
      await navigate(`${BASE}/vite.svg`);
      await sleep(700);
      await evaluate(`window.__SEED(${n})`);
      await navigate(`${BASE}/tasks`);
      await waitFor(`document.querySelectorAll('[data-task-id]').length > 0`, 15000);
      await sleep(500);

      const scenario = async (name, script) => {
        const r = await evaluate(`(async () => { window.__UI.resetCounters(); const total = window.__UI.total(); const res = await ${script}; const c = window.__UI.counters(); return { ...res, filterCount: c.filterCount, filterMs: c.filterMs, filteredLen: c.filteredLen, pageRenders: c.pageRenders, total }; })()`);
        searchScenarios[n] = { ...(searchScenarios[n] || {}), [name]: r };
        console.log(' ', name, JSON.stringify(r));
      };

      await scenario('type5', `(async () => {
        const sequence = ['周', '周报', '周报', '周报整', '周报'];
        let lastInputAt = performance.now();
        for (const value of sequence) {
          window.__UI.setInput(value);
          lastInputAt = performance.now();
          await new Promise((r) => setTimeout(r, 35));
        }
        const expected = window.__FD_STATE__.tasks.filter((t) => (t.title + ' ' + (t.notes || '')).toLowerCase().includes('周报')).length;
        const delay = await window.__UI.waitFilteredLen(expected, 5000, lastInputAt);
        return { events: sequence.length, expected, delay };
      })()`);

      await scenario('rapidTypeDelete', `(async () => {
        window.__UI.setInput('周');
        window.__UI.setInput('周报');
        window.__UI.setInput('');
        const t0 = performance.now();
        const delay = await window.__UI.waitFilteredLen(window.__UI.total(), 3000);
        return { delay, cleared: window.__UI.input().value === '' };
      })()`);

      await scenario('ime', `(async () => {
        window.__UI.composeStart();
        window.__UI.setInput('zhou');
        await new Promise((r) => setTimeout(r, 60));
        window.__UI.setInput('zhoub');
        await new Promise((r) => setTimeout(r, 60));
        const duringCompose = window.__UI.counters().filterCount;
        window.__UI.composeEnd('周报');
        const total = window.__UI.total();
        const expected = window.__FD_STATE__.tasks.filter((t) => (t.title + ' ' + (t.notes || '')).toLowerCase().includes('周报')).length;
        const delay = await window.__UI.waitFilteredLen(expected, 5000);
        return { duringCompose, expected, delay };
      })()`);

      {
        await navigate(`${BASE}/tasks`);
        await waitFor(`document.querySelectorAll('[data-task-id]').length > 0`, 15000);
        await sleep(300);
        await evaluate(`window.__UI.resetCounters()`);
        const keyInfo = await evaluate(`(() => {
          const el = document.querySelector('#task-search');
          el.focus();
          window.__FD_LAST_FILTERED_LEN__ = null;
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '周报');
          el.dispatchEvent(new Event('input', { bubbles: true }));
          const expected = window.__FD_STATE__.tasks.filter((t) => (t.title + ' ' + (t.notes || '')).toLowerCase().includes('周报')).length;
          return { expected, tLastInput: performance.now() };
        })()`);
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
        const enterDelay = await evaluate(`window.__UI.waitFilteredLen(${JSON.stringify(keyInfo.expected)}, 3000, ${JSON.stringify(keyInfo.tLastInput)})`);
        const enterCounters = await evaluate('window.__UI.counters()');
        const enterRes = { expected: keyInfo.expected, delay: enterDelay, filterCount: enterCounters.filterCount, filteredLen: enterCounters.filteredLen };
        searchScenarios[n] = { ...(searchScenarios[n] || {}), enter: enterRes };
        console.log('  enter', JSON.stringify(enterRes));
      }

      await scenario('clear', `(async () => {
        window.__UI.setInput('周报');
        await new Promise((r) => setTimeout(r, 220));
        const tClear = performance.now();
        window.__UI.setInput('');
        const delay = await window.__UI.waitFilteredLen(window.__UI.total(), 3000, tClear);
        return { delay, restored: window.__UI.counters().filteredLen === window.__UI.total() };
      })()`);
    }
    result.r4 = searchScenarios;

    fs.writeFileSync(path.join(OUT_DIR, 'perf-4.2-r3r4-dev.json'), JSON.stringify(result, null, 2), 'utf8');
    console.log('\n已写出 perf-4.2-r3r4-dev.json');
  } finally {
    try { cdp?.ws?.close(); } catch { /* ignore */ }
    try { child.kill(); } catch { /* ignore */ }
    await sleep(400);
    try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 }); } catch { /* ignore */ }
  }
}

main().catch((e) => { console.error('BENCH-R3R4 FAILED:', e); process.exit(1); });
