// FlowDay Phase 4.2 - R1/R2 性能验收基准（与 Phase 4.1 相同环境/数据构造/计时口径）
// 用法：
//   node scripts/bench-4.2.mjs                      # 开发服务器（5173），含 React 渲染计数
//   BASE=http://127.0.0.1:4173 MODE=prod node ...   # 生产构建（preview）
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const OUT_DIR = path.join(ROOT, 'docs', 'phase4.2');
const BASE = process.env.BASE || 'http://127.0.0.1:5173';
const MODE = process.env.MODE || 'dev';
const TAG = process.env.TAG || MODE;
const PORT = Number(process.env.CDP_PORT || 9342);
const PROFILE = path.join(ROOT, '.tmp', `bench-4.2-profile-${TAG}`);
const REPEATS = 5;
const SIZES = [1000, 5000, 10000];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

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
async function waitFirstList(timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const v = await evaluate('({ first: window.__BENCH_FIRST_ROW_AT__ || 0, stable: window.__BENCH_LIST_STABLE_AT__ || 0 })');
    if (v.first && v.stable) return v;
    await sleep(10);
  }
  return { first: -1, stable: -1 };
}

function stats(values) {
  const v = values.filter((x) => typeof x === 'number' && Number.isFinite(x));
  if (!v.length) return { repeats: values, median: null, max: null, min: null };
  const sorted = [...v].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { repeats: values.map((x) => (Number.isFinite(x) ? Number(x.toFixed(2)) : x)), median: Number(median.toFixed(2)), max: Number(sorted[sorted.length - 1].toFixed(2)), min: Number(sorted[0].toFixed(2)) };
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
window.__UI = {
  settle: async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  },
  search: async (q) => {
    const input = document.querySelector('#task-search');
    if (!input) return { ok: false };
    const t0 = performance.now();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, q);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await window.__UI.settle();
    return { ok: true, ms: performance.now() - t0, rows: document.querySelectorAll('[data-task-id]').length };
  },
  select: async (selector, value) => {
    const el = document.querySelector(selector);
    if (!el) return { ok: false };
    const t0 = performance.now();
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
    await window.__UI.settle();
    return { ok: true, ms: performance.now() - t0, rows: document.querySelectorAll('[data-task-id]').length };
  },
  segmented: async (label) => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
    if (!btn) return { ok: false };
    const t0 = performance.now();
    btn.click();
    await window.__UI.settle();
    return { ok: true, ms: performance.now() - t0, rows: document.querySelectorAll('[data-task-id]').length };
  },
  dom: () => ({
    totalNodes: document.getElementsByTagName('*').length,
    rowNodes: document.querySelectorAll('[data-task-id]').length,
    virtualContainers: document.querySelectorAll('[data-fd-virtual]').length,
    virtualRows: document.querySelectorAll('[data-fd-virtual-row]').length,
  }),
  resetCounters: () => { window.__FD_ROW_RENDERS__ = 0; window.__FD_PAGE_RENDERS__ = 0; },
  counters: () => ({ rowRenders: window.__FD_ROW_RENDERS__ || 0, pageRenders: window.__FD_PAGE_RENDERS__ || 0 }),
  toggleWithHook: async () => {
    const rows = [...document.querySelectorAll('[data-task-id]')];
    if (!rows.length) return { ok: false };
    const btn = rows[0].querySelector('[data-testid="task-toggle"]');
    const hook = window.__BENCH_PUT__;
    if (!hook || !btn) return { ok: false };
    hook.start = 0; hook.end = 0;
    const t0 = performance.now();
    btn.click();
    const deadline = performance.now() + 15000;
    while (performance.now() < deadline) {
      if (hook.end > 0) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    return { ok: hook.end > 0, clickToPutStart: hook.start ? hook.start - t0 : null, putDuration: hook.end && hook.start ? hook.end - hook.start : null, total: hook.end ? hook.end - t0 : null };
  },
  idleCadence: async (durationMs) => {
    const frames = [];
    let last = performance.now();
    const start = last;
    return new Promise((resolve) => {
      const loop = (now) => {
        frames.push(now - last);
        last = now;
        if (now - start < durationMs) requestAnimationFrame(loop);
        else resolve(frames);
      };
      requestAnimationFrame(loop);
    });
  },
  scrollBench: async (durationMs, stepPx) => {
    window.scrollTo(0, 0);
    await new Promise((r) => requestAnimationFrame(r));
    const frames = [];
    let last = performance.now();
    const start = last;
    return new Promise((resolve) => {
      const loop = (now) => {
        frames.push(now - last);
        last = now;
        window.scrollBy(0, stepPx);
        const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
        if (now - start < durationMs && window.scrollY < maxScroll - 2) requestAnimationFrame(loop);
        else resolve({ frames, scrolled: window.scrollY, maxScroll, rows: document.querySelectorAll('[data-task-id]').length });
      };
      requestAnimationFrame(loop);
    });
  },
};
`;

const HOOKS = String.raw`
window.__BENCH_FIRST_ROW_AT__ = 0;
window.__BENCH_LIST_STABLE_AT__ = 0;
window.__BENCH_PUT__ = { start: 0, end: 0 };
(() => {
  let lastCount = -1;
  let lastChange = performance.now();
  const tick = () => {
    const rows = document.querySelectorAll('[data-task-id]');
    if (!window.__BENCH_FIRST_ROW_AT__ && rows.length) window.__BENCH_FIRST_ROW_AT__ = performance.now();
    if (rows.length !== lastCount) { lastCount = rows.length; lastChange = performance.now(); }
    else if (!window.__BENCH_LIST_STABLE_AT__ && rows.length && performance.now() - lastChange > 120) {
      window.__BENCH_LIST_STABLE_AT__ = performance.now();
    }
    if (!window.__BENCH_LIST_STABLE_AT__) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
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
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: GEN });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: HOOKS });
    await navigate(`${BASE}/vite.svg`);
    await evaluate(GEN);

    const idleFrames = await evaluate('window.__UI.idleCadence(800)');
    const idleSorted = idleFrames.filter((x) => x > 0 && x < 2000).sort((a, b) => a - b);
    const idleMedian = idleSorted.length ? idleSorted[Math.floor(idleSorted.length / 2)] : null;
    const jankThreshold = Math.max(50, (idleMedian || 16.7) * 2);

    const result = {
      meta: {
        idleCadenceMedian: idleMedian === null ? null : Number(idleMedian.toFixed(1)),
        jankThresholdMs: Number(jankThreshold.toFixed(1)),
        phase: '4.2-r1r2',
        tag: TAG,
        mode: MODE,
        base: BASE,
        generatedAt: new Date().toISOString(),
        repeats: REPEATS,
        browserVersion: version.Browser,
        environment: await evaluate(`({ userAgent: navigator.userAgent, cores: navigator.hardwareConcurrency, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, dpr: devicePixelRatio })`),
        method: {
          firstListRender: '导航到 /tasks 起，页面内 rAF 轮询检测首行出现（__BENCH_FIRST_ROW_AT__）与列表稳定（行数 120ms 无变化，__BENCH_LIST_STABLE_AT__）',
          searchFilter: '输入/选择事件派发 → 2 次 rAF + 一次宏任务后测量（与 Phase 4.1 相同口径）',
          toggle: '页面加载前 HOOK IDBObjectStore.put 与 transaction complete；点击首行复选框 → 事务完成',
          scroll: '从顶部按 80px/帧滚动 2 秒，收集帧间隔，统计中位/p95/掉帧（>50ms）',
          dom: '加载完成后统计 document 元素总数、[data-task-id] 行数、虚拟容器/虚拟行数',
          renderCounts: '开发态计数器 __FD_ROW_RENDERS__ / __FD_PAGE_RENDERS__（生产构建被移除）',
        },
      },
      bySize: {},
    };

    for (const n of SIZES) {
      console.log(`\n[${TAG}] ${n} 条任务`);
      const firstList = [];
      const stableList = [];
      const search = [];
      const priority = [];
      const status = [];
      const toggle = [];
      const clickToPut = [];
      const putDur = [];
      const scrollFrames = [];
      const doms = [];
      let counters = null;

      for (let rep = 0; rep < REPEATS; rep++) {
        await navigate(`${BASE}/vite.svg`);
        await sleep(MODE === 'prod' ? 500 : 700);
        const seeded = await evaluate(`window.__SEED(${n})`);
        if (seeded !== n) throw new Error('seed failed ' + n + ': ' + seeded);
        await navigate(`${BASE}/tasks`);
        const t = await waitFirstList();
        firstList.push(t.first);
        stableList.push(t.stable);
        await sleep(300);

        await evaluate(`window.__UI.resetCounters()`);
        // 搜索 / 筛选
        const s1 = await evaluate(`window.__UI.search('周报')`);
        search.push(s1.ms);
        await evaluate(`window.__UI.search('')`);
        const s2 = await evaluate(`window.__UI.select('#filter-priority', '1')`);
        priority.push(s2.ms);
        await evaluate(`window.__UI.select('#filter-priority', 'all')`);
        const s3 = await evaluate(`window.__UI.segmented('已完成')`);
        status.push(s3.ms);
        await evaluate(`window.__UI.segmented('全部')`);
        await sleep(200);

        // DOM 节点数
        doms.push(await evaluate('window.__UI.dom()'));

        // 勾选端到端（同时测量一次更新中的组件渲染次数）
        await evaluate('window.__UI.resetCounters()');
        const tg = await evaluate('window.__UI.toggleWithHook()');
        if (tg.ok) {
          toggle.push(tg.total);
          clickToPut.push(tg.clickToPutStart);
          putDur.push(tg.putDuration);
        }
        await sleep(250);
        if (MODE === 'dev') counters = await evaluate('window.__UI.counters()');

        // 滚动流畅度
        const sc = await evaluate(`window.__UI.scrollBench(2000, 80)`);
        scrollFrames.push(sc.frames);
      }

      const allFrames = scrollFrames.flat().filter((x) => typeof x === 'number' && x > 0 && x < 5000);
      allFrames.sort((a, b) => a - b);
      const frameStats = {
        frameCount: allFrames.length,
        median: allFrames.length ? Number(allFrames[Math.floor(allFrames.length / 2)].toFixed(1)) : null,
        p95: allFrames.length ? Number(allFrames[Math.floor(allFrames.length * 0.95)].toFixed(1)) : null,
        max: allFrames.length ? Number(allFrames[allFrames.length - 1].toFixed(1)) : null,
        jankFrames: allFrames.filter((x) => x > jankThreshold).length,
        jankRatio: allFrames.length ? Number(((allFrames.filter((x) => x > jankThreshold).length / allFrames.length) * 100).toFixed(1)) : null,
      };

      result.bySize[n] = {
        firstListRender: stats(firstList),
        listStable: stats(stableList),
        search: stats(search),
        priorityFilter: stats(priority),
        statusFilter: stats(status),
        toggleEndToEnd: stats(toggle),
        toggleClickToPutStart: stats(clickToPut),
        togglePutDuration: stats(putDur),
        dom: doms[0] || null,
        domNodeCounts: stats(doms.map((d) => d.totalNodes)),
        reactRenderCounts: counters,
        scroll: frameStats,
      };
      console.log('  首次列表渲染', stats(firstList), '稳定', stats(stableList));
      console.log('  搜索', stats(search), '优先级', stats(priority), '状态', stats(status));
      console.log('  勾选端到端', stats(toggle), '写库', stats(putDur));
      console.log('  DOM', JSON.stringify(doms[0]), '渲染计数', JSON.stringify(counters));
      console.log('  滚动帧', JSON.stringify(frameStats));
    }

    fs.writeFileSync(path.join(OUT_DIR, `perf-4.2-${TAG}.json`), JSON.stringify(result, null, 2), 'utf8');
    console.log('\n已写出', path.join(OUT_DIR, `perf-4.2-${TAG}.json`));
  } finally {
    try { cdp?.ws?.close(); } catch { /* ignore */ }
    try { child.kill(); } catch { /* ignore */ }
    await sleep(400);
    try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 }); } catch { /* ignore */ }
  }
}

main().catch((e) => { console.error('BENCH-4.2 FAILED:', e); process.exit(1); });
