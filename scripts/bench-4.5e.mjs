/**
 * Phase 4.5-E 真实性能基准（环境无关：prod 无 dev 桥，全部用 DOM + IndexedDB 观测）
 * dev : BASE=http://127.0.0.1:5173 node scripts/bench-4.5e.mjs
 * prod: npm run build && npm run preview -- --port 4173
 *       BASE=http://127.0.0.1:4173 OUT=docs/phase4.5/perf-4.5e-prod.json node scripts/bench-4.5e.mjs
 *
 * 指标定义（用户可见事件）：
 *  - loadMs        导航 → 应用可交互（[data-fd-main] 出现）
 *  - firstRenderMs 导航 → 任务行首次出现
 *  - searchMs      5 次连续输入 → “筛选出 N 条”达到期望值
 *  - priorityMs/dateMs  下拉变更 → 筛选结果达到期望值
 *  - toggleRenderMs 点击勾选 → 双 rAF（提交+绘制）
 *  - togglePersistMs 点击勾选 → IndexedDB meta.revision 前进（含 180ms 防抖）
 *  - dashReadyMs   导航 → Dashboard 完成环与统计文本出现
 *  - calendarReadyMs/weekSwitchMs  日历首屏与月→周切换
 *  - longTask / heapMB  期间的长任务与 JS 堆
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ROOT = process.cwd();
const BASE = process.env.BASE || 'http://127.0.0.1:5173';
const OUT = path.join(ROOT, process.env.OUT || 'docs/phase4.5/perf-4.5e-dev.json');
const PORT = Number(process.env.PORT || 9420);
const PROFILE = path.join(os.tmpdir(), 'flowday-bench-45e');
const SCALES = (process.env.SCALES || '1000,10000,25000,40000').split(',').map(Number);
const REPEATS = Number(process.env.REPEATS || 5);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(path.dirname(OUT), { recursive: true });
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
    this.ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
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

/** 与生成器一致的数据期望值（Node 侧计算，避免依赖 dev 全局） */
function expectedCounts(n) {
  const pad = (x) => String(x).padStart(2, '0');
  const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const today = new Date();
  let search = 0;
  let priority1 = 0;
  let todayCount = 0;
  for (let i = 0; i < n; i++) {
    const title = (i % 7 === 0 ? '周报整理 ' : '基准任务 ') + i;
    const notes = i % 3 === 0 ? '备注内容 ' + i : '';
    const q = '基准任务 1';
    if (title.toLowerCase().includes(q) || notes.toLowerCase().includes(q)) search += 1;
    if ((i % 3) + 1 === 1) priority1 += 1;
    const off = (i % 60) - 20;
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    d.setDate(d.getDate() + off);
    if (iso(d) === iso(today)) todayCount += 1;
  }
  return { search, priority1, todayCount };
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
    const now = new Date().toISOString();
    const tx = db.transaction(['app', 'meta'], 'readwrite');
    tx.objectStore('app').put({ schemaVersion: 2, updatedAt: now, revision: 1, writerId: 'bench', data: window.__GEN(n) }, 'state');
    tx.objectStore('meta').put({ revision: 1, updatedAt: now, writerId: 'bench' }, 'sync:v1');
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    const rec = await new Promise((resolve) => { const r = db.transaction('app', 'readonly').objectStore('app').get('state'); r.onsuccess = () => resolve(r.result); r.onerror = () => resolve(null); });
    db.close();
    if ((rec?.data?.tasks?.length ?? -1) === n) return n;
    await new Promise((r) => setTimeout(r, 300));
  }
  return -1;
};
window.__FD_LONG__ = [];
try {
  new PerformanceObserver((list) => { for (const e of list.getEntries()) window.__FD_LONG__.push({ d: e.duration }); }).observe({ type: 'longtask', buffered: true });
} catch (e) {}

window.__BENCH = {
  ready: () => Boolean(document.querySelector('[data-fd-main]')),
  rows: () => document.querySelectorAll('[data-task-id]').length,
  domNodes: () => document.querySelectorAll('*').length,
  revision: async () => {
    try {
      const db = await new Promise((res, rej) => { const r = indexedDB.open('flowday-db'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const meta = await new Promise((res) => { const q = db.transaction('meta', 'readonly').objectStore('meta').get('sync:v1'); q.onsuccess = () => res(q.result); q.onerror = () => res(null); });
      db.close();
      return meta ? meta.revision : null;
    } catch (e) { return null; }
  },
  resetLong: () => { window.__FD_LONG__ = []; },
  longTasks: () => window.__FD_LONG__.filter((e) => e.d >= 50),
  filteredCount: () => {
    const m = document.body.innerText.match(/筛选出\s*(\d+)\s*条/);
    return m ? Number(m[1]) : null;
  },
  waitFiltered: async (expected, timeoutMs) => {
    const t0 = performance.now();
    const deadline = t0 + (timeoutMs || 12000);
    while (performance.now() < deadline) {
      if (window.__BENCH.filteredCount() === expected) return performance.now() - t0;
      await new Promise((r) => setTimeout(r, 5));
    }
    return -1;
  },
  setInput: (value) => { const el = document.querySelector('#task-search'); if (!el) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); return true; },
  filterMeasure: async (kind, value, expected) => {
    const t0 = performance.now();
    const el = document.querySelector(kind === 'priority' ? '#filter-priority' : '#filter-date');
    if (!el) return -1;
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    while (performance.now() - t0 < 12000) {
      if (window.__BENCH.filteredCount() === expected) return performance.now() - t0;
      await new Promise((r) => setTimeout(r, 2));
    }
    return -1;
  },
  scrollRun: async (ms) => {
    const deltas = [];
    let last = performance.now();
    const t0 = last;
    return await new Promise((resolve) => {
      const step = (now) => {
        deltas.push(now - last);
        last = now;
        window.scrollBy(0, 240);
        if (now - t0 < ms) requestAnimationFrame(step);
        else resolve(deltas);
      };
      requestAnimationFrame(step);
    });
  },
  toggleMeasure: async () => {
    const btn = document.querySelector('[data-testid="task-toggle"]');
    if (!btn) return null;
    const rev0 = await window.__BENCH.revision();
    const t0 = performance.now();
    btn.click();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    const tRender = performance.now() - t0;
    let tPersist = -1;
    while (performance.now() - t0 < 8000) {
      const rev = await window.__BENCH.revision();
      if (typeof rev === 'number' && rev > rev0) { tPersist = performance.now() - t0; break; }
      await new Promise((r) => setTimeout(r, 20));
    }
    return { tRender, tPersist, rev0 };
  },
  editMeasure: async () => {
    const row = document.querySelector('[data-task-id]');
    if (!row) return null;
    const titleBtn = [...row.querySelectorAll('button')].find((b) => (b.textContent || '').trim().length > 2 && !b.hasAttribute('aria-label'));
    if (!titleBtn) return null;
    const t0 = performance.now();
    titleBtn.click();
    let open = -1;
    while (performance.now() - t0 < 4000) {
      if (document.querySelector('[data-fd-dialog]')) { await new Promise((r) => requestAnimationFrame(() => r())); open = performance.now() - t0; break; }
      await new Promise((r) => setTimeout(r, 5));
    }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    while (document.querySelector('[data-fd-dialog]') && performance.now() - t0 < 6000) await new Promise((r) => setTimeout(r, 10));
    return open;
  },
};
`;

async function main() {
  const child = spawn(EDGE, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--headless=new', '--disable-gpu', '--no-first-run', '--window-size=1280,900', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  const report = { generatedAt: new Date().toISOString(), base: BASE, env: BASE.includes(':4173') ? 'prod' : 'dev', viewport: '1280x900', repeats: REPEATS, scales: {}, notes: [] };
  try {
    for (let i = 0; i < 120; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
        if (r.ok) {
          report.browser = (await r.json()).Browser;
          break;
        }
      } catch {}
      await sleep(200);
    }
    const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter((t) => t.type === 'page')[0];
    const cdp = new CDP(page.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Performance.enable');
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: LIB });

    const ev = async (expr) => {
      const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (exceptionDetails) throw new Error('EVAL: ' + (exceptionDetails.exception?.description || exceptionDetails.text));
      return result.value;
    };
    const waitFor = async (expr, timeout = 15000) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        if (await ev(expr)) return true;
        await sleep(15);
      }
      return false;
    };
    const goto = async (route) => {
      const t0 = Date.now();
      await cdp.send('Page.navigate', { url: BASE + route });
      for (let i = 0; i < 600; i++) {
        const ok = await ev('Boolean(window.__BENCH && window.__BENCH.ready())').catch(() => false);
        if (ok) return Date.now() - t0;
        await sleep(10);
      }
      return -1;
    };
    const heapMB = async () => {
      const { metrics } = await cdp.send('Performance.getMetrics');
      const v = (metrics.find((x) => x.name === 'JSHeapUsedSize') || {}).value;
      return v ? +(v / 1048576).toFixed(2) : null;
    };
    const stats = (arr) => {
      const v = arr.filter((x) => typeof x === 'number' && Number.isFinite(x) && x >= 0).sort((a, b) => a - b);
      if (!v.length) return { median: null, min: null, max: null, repeats: arr };
      const mid = Math.floor(v.length / 2);
      return { median: +(v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2).toFixed(2), min: +v[0].toFixed(2), max: +v[v.length - 1].toFixed(2), repeats: arr.map((x) => (Number.isFinite(x) ? +x.toFixed(2) : x)) };
    };

    for (const n of SCALES) {
      const exp = expectedCounts(n);
      await cdp.send('Page.navigate', { url: BASE + '/bench-blank.html' });
      await sleep(400);
      const seeded = await ev(`window.__SEED(${n})`);
      if (seeded !== n) {
        report.notes.push('seed failed for ' + n);
        continue;
      }
      const repeats = n > 25000 ? 3 : REPEATS;
      const acc = { load: [], firstRender: [], dom: [], rows: [], scroll: [], toggleRender: [], togglePersist: [], edit: [], search: [], priority: [], date: [], dash: [], heap: [], longCount: [], longMs: [], calendar: [], weekSwitch: [] };

      for (let r = 0; r < repeats; r++) {
        console.log(`  [${n}] repeat ${r + 1}/${repeats} …`);
        const tLoad = await goto('/tasks');
        acc.load.push(tLoad);
        const t0 = Date.now();
        const okRows = await waitFor('window.__BENCH.rows() > 0', 30000);
        acc.firstRender.push(okRows ? Date.now() - t0 : -1);
        acc.dom.push(await ev('window.__BENCH.domNodes()'));
        acc.rows.push(await ev('window.__BENCH.rows()'));
        const deltas = await ev('window.__BENCH.scrollRun(2000)');
        const dropped = deltas.filter((d) => d > 33).length;
        acc.scroll.push({ frames: deltas.length, avgFrameMs: +(deltas.reduce((a, b) => a + b, 0) / Math.max(1, deltas.length)).toFixed(2), droppedPct: +((dropped / Math.max(1, deltas.length)) * 100).toFixed(1), maxFrameMs: +Math.max(...deltas).toFixed(1) });
        await ev('window.scrollTo(0, 0)');

        const tg = await ev('window.__BENCH.toggleMeasure()');
        if (tg) {
          acc.toggleRender.push(tg.tRender);
          acc.togglePersist.push(tg.tPersist);
        }
        const ed = await ev('window.__BENCH.editMeasure()');
        if (typeof ed === 'number') acc.edit.push(ed);

        await ev('window.__BENCH.resetLong()');
        for (const q of ['基', '基准', '基准任', '基准任务', '基准任务 1']) {
          await ev(`window.__BENCH.setInput(${JSON.stringify(q)})`);
          await sleep(60);
        }
        acc.search.push(await ev(`window.__BENCH.waitFiltered(${exp.search}, 15000)`));
        await ev('window.__BENCH.setInput("")');
        await sleep(400);

        acc.priority.push(await ev(`window.__BENCH.filterMeasure('priority', '1', ${exp.priority1})`));
        await ev(`(() => { const el = document.querySelector('#filter-priority'); if (el) { el.value = 'all'; el.dispatchEvent(new Event('change', { bubbles: true })); } return true; })()`);
        await sleep(350);

        acc.date.push(await ev(`window.__BENCH.filterMeasure('date', 'today', ${exp.todayCount})`));
        await ev(`(() => { const el = document.querySelector('#filter-date'); if (el) { el.value = 'all'; el.dispatchEvent(new Event('change', { bubbles: true })); } return true; })()`);
        await sleep(350);

        const longs = await ev('window.__BENCH.longTasks()');
        acc.longCount.push(longs.length);
        acc.longMs.push(longs.reduce((a, b) => a + b.d, 0));
        acc.heap.push(await heapMB());

        const tDash = await goto('/today');
        const dashOk = await waitFor(`Boolean(document.querySelector('svg[role="img"]')) && document.body.innerText.includes('今日完成')`, 20000);
        acc.dash.push(dashOk ? tDash : -1);

        if (r === 0) {
          acc.calendar.push(await goto('/calendar'));
          const t1 = Date.now();
          await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '周'); if (b) b.click(); return Boolean(b); })()`);
          const okWeek = await waitFor(`Boolean(document.querySelector('section.fd-scroll'))`, 10000);
          acc.weekSwitch.push(okWeek ? Date.now() - t1 : -1);
        }
      }
      report.scales[n] = {
        tasks: n,
        repeats,
        expected: exp,
        loadMs: stats(acc.load),
        firstRenderMs: stats(acc.firstRender),
        domNodes: stats(acc.dom),
        renderedRows: stats(acc.rows),
        scroll: acc.scroll,
        toggleRenderMs: stats(acc.toggleRender),
        togglePersistMs: stats(acc.togglePersist),
        editOpenMs: stats(acc.edit),
        searchMs: stats(acc.search),
        priorityFilterMs: stats(acc.priority),
        dateFilterMs: stats(acc.date),
        dashReadyMs: stats(acc.dash),
        heapMB: stats(acc.heap),
        longTaskCount: stats(acc.longCount),
        longTaskMs: stats(acc.longMs),
        calendarReadyMs: stats(acc.calendar),
        weekSwitchMs: stats(acc.weekSwitch),
      };
      const s = report.scales[n];
      console.log(`scale ${n}: load=${s.loadMs.median} rows=${s.renderedRows.median} dom=${s.domNodes.median} search=${s.searchMs.median} prio=${s.priorityFilterMs.median} toggleR=${s.toggleRenderMs.median} toggleP=${s.togglePersistMs.median} dash=${s.dashReadyMs.median} heap=${s.heapMB.median}MB long=${s.longTaskCount.median}`);
    }
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8');
    console.log('WROTE ' + OUT);
  } finally {
    try { child.kill(); } catch {}
    await sleep(600);
    try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
  }
}

main().catch((e) => {
  console.error('BENCH FAILED', e);
  process.exit(1);
});
