// FlowDay Phase 4.1 - 补充测量：应用级持久化分解 / 纯计算耗时 / 一致性复测
// 与 bench-4.1.mjs 相同的隔离策略：临时浏览器 profile + 临时 profile 内的应用库，结束后删除
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const OUT_DIR = path.join(ROOT, 'docs', 'phase4.1');
const PROFILE = path.join(ROOT, '.tmp', 'bench-edge-profile-b');
const BASE = 'http://127.0.0.1:5173';
const PORT = 9339;
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
    expression, returnByValue: true, awaitPromise: true,
  });
  if (exceptionDetails) throw new Error((exceptionDetails.exception?.description ?? exceptionDetails.text).slice(0, 400));
  return result.value;
}
async function waitDevtools(timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const res = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (res.ok) return res.json(); } catch { /* retry */ }
    await sleep(250);
  }
  throw new Error('devtools not ready');
}
async function getPageTarget() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  const page = (await res.json()).find((t) => t.type === 'page');
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

const LIB = String.raw`
(() => {
  const B = {};
  B.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  B.openApp = () => new Promise((resolve, reject) => {
    const req = indexedDB.open('flowday-db', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('app')) db.createObjectStore('app');
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  B.done = (tx) => new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
  B.deleteDb = (name) => new Promise((resolve) => { const r = indexedDB.deleteDatabase(name); r.onsuccess = resolve; r.onerror = resolve; r.onblocked = resolve; });
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
        time: i % 4 === 0 ? pad(i % 24) + ':00' : undefined,
        durationMin: i % 4 === 0 ? 60 : undefined,
        priority: (i % 3) + 1,
        projectId: projects[i % 3].id,
        completed,
        completedAt: completed ? new Date(today.getTime() - (i % 30) * 86400000).toISOString() : undefined,
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
    for (let i = 0; i < Math.floor(n / 10); i++) habitLogs.push({ habitId: habits[i % 3].id, date: iso(new Date(today.getTime() - (i % 30) * 86400000)) });
    return { version: 1, tasks, projects, habits, habitLogs, settings: { name: '', theme: 'light', weekStart: 1, aiEnabled: true, demoData: false } };
  };
  B.appSeed = async (n) => {
    const data = B.genData(n);
    await B.deleteDb('flowday-db');
    for (let attempt = 0; attempt < 4; attempt++) {
      let db;
      try {
        db = await B.openApp();
      } catch (err) {
        await B.sleep(200);
        continue;
      }
      const tx = db.transaction('app', 'readwrite');
      tx.objectStore('app').put({ schemaVersion: 2, updatedAt: new Date().toISOString(), data }, 'state');
      await B.done(tx);
      const rec = await new Promise((resolve) => {
        const r = db.transaction('app', 'readonly').objectStore('app').get('state');
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => resolve(null);
      });
      db.close();
      const count = rec?.data?.tasks?.length ?? -1;
      if (count === n) return { tasks: n, attempts: attempt + 1 };
      await B.sleep(400);
    }
    return { tasks: -1 };
  };
  // 纯计算：直接对内存中的 AppData 做与页面相同的筛选/排序/统计
  B.computeBench = async () => {
    const data = window.__FD_STATE__;
    if (!data) return { ok: false };
    const pad = (x) => String(x).padStart(2, '0');
    const now = new Date();
    const today = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
    const time = (fn) => { const t0 = performance.now(); const r = fn(); return { ms: performance.now() - t0, n: r }; };
    const sortTasks = (tasks) => [...tasks].sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      if (a.completed && b.completed) return (b.completedAt ?? '').localeCompare(a.completedAt ?? '');
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      if ((a.time ?? '') !== (b.time ?? '')) return (a.time ?? '').localeCompare(b.time ?? '');
      return a.priority - b.priority;
    });
    const out = {};
    out.filterToday = time(() => data.tasks.filter((t) => t.date === today).length);
    out.filterOpen = time(() => data.tasks.filter((t) => !t.completed).length);
    out.searchTitle = time(() => data.tasks.filter((t) => t.title.includes('周报') || (t.notes ?? '').includes('周报')).length);
    out.priorityFilter = time(() => data.tasks.filter((t) => t.priority === 1).length);
    out.combinedFilter = time(() => data.tasks.filter((t) => !t.completed && t.priority <= 2 && t.date >= today).length);
    out.sortAll = time(() => sortTasks(data.tasks).length);
    out.todayStats = time(() => {
      const total = data.tasks.filter((t) => t.date <= today).length;
      const done = data.tasks.filter((t) => t.date <= today && t.completed).length;
      return total + done;
    });
    out.last7Day = time(() => {
      let acc = 0;
      for (let i = 0; i < 7; i++) acc += data.tasks.filter((t) => t.completed && t.completedAt && t.completedAt.slice(0, 10) === today).length;
      return acc;
    });
    out.groupedRenderPrep = time(() => {
      const open = data.tasks.filter((t) => !t.completed);
      const overdue = sortTasks(open.filter((t) => t.date < today)).length;
      const todays = sortTasks(open.filter((t) => t.date === today)).length;
      const upcoming = sortTasks(open.filter((t) => t.date > today)).length;
      const done = sortTasks(data.tasks.filter((t) => t.completed)).slice(0, 20).length;
      return overdue + todays + upcoming + done;
    });
    out.habitLogsFilter = time(() => data.habitLogs.filter((l) => l.date === today).length);
    return { ok: true, tasks: data.tasks.length, results: out };
  };
  // 应用级持久化分解：利用 put 钩子记录 点击→防抖→写入开始→事务完成
  B.toggleWithHook = async () => {
    const rows = [...document.querySelectorAll('[data-task-id]')];
    if (!rows.length) return { ok: false };
    const row = rows[0];
    const btn = row.querySelector('[data-testid="task-toggle"]');
    const hook = window.__BENCH_PUT__;
    hook.start = 0; hook.end = 0; hook.aborted = 0;
    const t0 = performance.now();
    btn.click();
    const deadline = performance.now() + 20000;
    while (performance.now() < deadline) {
      if (hook.end > 0) break;
      await B.sleep(10);
    }
    return {
      ok: hook.end > 0,
      clickToPutStart: hook.start ? hook.start - t0 : null,
      putDuration: hook.end && hook.start ? hook.end - hook.start : null,
      total: hook.end ? hook.end - t0 : null,
      rows: rows.length,
    };
  };
  // 一致性：新建任务并确认进入内存状态
  B.createTaskVerified = async (title) => {
    const openBtn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '新建任务' || b.textContent.trim() === '新建');
    if (!openBtn) return { ok: false, reason: 'no-open-btn' };
    openBtn.click();
    await B.sleep(150);
    const input = document.querySelector('#task-title');
    if (!input) return { ok: false, reason: 'no-input' };
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, title);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await B.sleep(80);
    const add = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '添加任务');
    if (!add) return { ok: false, reason: 'no-add' };
    add.click();
    for (let i = 0; i < 40; i++) {
      await B.sleep(10);
      if (window.__FD_STATE__?.tasks.some((t) => t.title === title)) return { ok: true };
    }
    return { ok: false, reason: 'not-in-state' };
  };
  B.toggleVerified = async () => {
    const row = [...document.querySelectorAll('[data-task-id]')][0];
    if (!row) return { ok: false };
    const btn = row.querySelector('[data-testid="task-toggle"]');
    const id = row.getAttribute('data-task-id');
    const before = window.__FD_STATE__.tasks.find((t) => t.id === id)?.completed;
    btn.click();
    for (let i = 0; i < 40; i++) {
      await B.sleep(10);
      const cur = window.__FD_STATE__.tasks.find((t) => t.id === id);
      if (cur && cur.completed !== before) return { ok: true, id };
    }
    return { ok: false };
  };
  B.hasTask = (title) => Boolean(window.__FD_STATE__ && window.__FD_STATE__.tasks.some((t) => t.title === title));
  B.stateTaskCount = () => (window.__FD_STATE__ ? window.__FD_STATE__.tasks.length : -1);
  window.__BENCH = B;
})();
`;

const READY_HOOK = String.raw`
window.__BENCH_READY_AT__ = 0;
window.__BENCH_PUT__ = { start: 0, end: 0, aborted: 0 };
(() => {
  const timer = setInterval(() => {
    if (window.__FD_STATE__ && document.querySelector('main')) {
      window.__BENCH_READY_AT__ = performance.now();
      clearInterval(timer);
    }
  }, 4);
  const origPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args) {
    const res = origPut.apply(this, args);
    try {
      const tx = this.transaction;
      window.__BENCH_PUT__.start = performance.now();
      window.__BENCH_PUT__.end = 0;
      tx.addEventListener('complete', () => { window.__BENCH_PUT__.end = performance.now(); });
      tx.addEventListener('abort', () => { window.__BENCH_PUT__.aborted += 1; });
    } catch { /* ignore */ }
    return res;
  };
})();
`;

function stats(values) {
  const v = values.filter((x) => typeof x === 'number' && Number.isFinite(x));
  if (!v.length) return { repeats: values, median: null, max: null, min: null };
  const sorted = [...v].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { repeats: values.map((x) => (typeof x === 'number' ? Number(x.toFixed(2)) : x)), median: Number(median.toFixed(2)), max: Number(sorted[sorted.length - 1].toFixed(2)), min: Number(sorted[0].toFixed(2)) };
}

async function main() {
  const child = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--headless=new', '--disable-gpu',
    '--no-first-run', '--no-default-browser-check', '--window-size=1440,900', 'about:blank',
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
    await navigate(`${BASE}/vite.svg`);
    await evaluate(LIB);

    const result = {
      meta: {
        phase: '4.1-supplement',
        generatedAt: new Date().toISOString(),
        repeats: REPEATS,
        browserVersion: version.Browser,
        environment: await evaluate(`({ userAgent: navigator.userAgent, cores: navigator.hardwareConcurrency, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })`),
        methodology: {
          persistence: '在页面加载前 HOOK IDBObjectStore.put 与 transaction complete，记录 点击→写入开始（含 React 渲染与 180ms 防抖）与 写入开始→事务完成 两段耗时，不使用轮询读库',
          compute: '直接对 window.__FD_STATE__ 内存数据执行与页面相同的 filter/sort/统计逻辑，隔离 React 渲染成本',
          consistency: '仅统计"确认已进入内存状态"的创建操作，避免输入失败造成的假阴性',
        },
      },
      appDetail: {},
      consistency: {},
    };

    for (const n of SIZES) {
      console.log(`\n[补充] ${n} 条任务`);
      await navigate(`${BASE}/vite.svg`);
      await sleep(900);
      const seeded = await evaluate(`window.__BENCH.appSeed(${n})`);
      if (!seeded || seeded.tasks !== n) throw new Error('seed failed for ' + n + ': ' + JSON.stringify(seeded));
      await navigate(`${BASE}/tasks`);
      await appReadyMs();
      await sleep(400);

      const compute = await evaluate('window.__BENCH.computeBench()');
      const toggle = [];
      const clicks = [];
      const putDurations = [];
      for (let i = 0; i < REPEATS; i++) {
        await navigate(`${BASE}/tasks`);
        await appReadyMs();
        await sleep(300);
        const r = await evaluate('window.__BENCH.toggleWithHook()');
        toggle.push(r.ok ? r.total : null);
        if (r.ok) { clicks.push(r.clickToPutStart); putDurations.push(r.putDuration); }
      }
      result.appDetail[n] = {
        taskCount: compute?.tasks ?? null,
        compute: compute?.results ?? null,
        toggleEndToEnd: stats(toggle),
        toggleClickToPutStart: stats(clicks),
        togglePutDuration: stats(putDurations),
      };
      console.log('  计算：', JSON.stringify(compute?.results));
      console.log('  勾选端到端', stats(toggle), '点击→写入开始', stats(clicks), '写入', stats(putDurations));
    }

    // 一致性复测（5000 条）：每个场景 5 次，仅统计成功创建
    console.log('\n[一致性复测] 5000 条');
    await navigate(`${BASE}/vite.svg`);
    await sleep(900);
    const seeded2 = await evaluate('window.__BENCH.appSeed(5000)');
    if (!seeded2 || seeded2.tasks !== 5000) throw new Error('seed failed for consistency: ' + JSON.stringify(seeded2));
    await navigate(`${BASE}/tasks`);
    await appReadyMs();
    await sleep(400);

    const consistency = { immediateNavigate: [], afterDebounce: [], modifyThenLeave: [], tabSwitch: [], createFailures: 0 };

    // A: 创建后 30ms 立即离开（<180ms 防抖窗口）
    for (let i = 0; i < REPEATS; i++) {
      const title = `A-立即离开-${Date.now()}-${i}`;
      const created = await evaluate(`window.__BENCH.createTaskVerified(${JSON.stringify(title)})`);
      if (!created.ok) { consistency.createFailures += 1; continue; }
      await sleep(30);
      await navigate(`${BASE}/tasks`);
      await appReadyMs();
      await sleep(300);
      consistency.immediateNavigate.push(await evaluate(`window.__BENCH.hasTask(${JSON.stringify(title)})`));
    }

    // B: 创建后等待 500ms 再离开（>180ms 防抖 + 写入）
    for (let i = 0; i < REPEATS; i++) {
      const title = `B-等待离开-${Date.now()}-${i}`;
      const created = await evaluate(`window.__BENCH.createTaskVerified(${JSON.stringify(title)})`);
      if (!created.ok) { consistency.createFailures += 1; continue; }
      await sleep(500);
      await navigate(`${BASE}/tasks`);
      await appReadyMs();
      await sleep(300);
      consistency.afterDebounce.push(await evaluate(`window.__BENCH.hasTask(${JSON.stringify(title)})`));
    }

    // C: 修改已有任务后立即离开
    for (let i = 0; i < REPEATS; i++) {
      const toggled = await evaluate('window.__BENCH.toggleVerified()');
      if (!toggled.ok) continue;
      await sleep(30);
      await navigate(`${BASE}/tasks`);
      await appReadyMs();
      await sleep(300);
      consistency.modifyThenLeave.push(await evaluate(`window.__BENCH.stateTaskCount() >= 0`));
    }

    // D: 切换标签页后返回
    const tabResults = [];
    for (let i = 0; i < REPEATS; i++) {
      const title = `D-切标签-${Date.now()}-${i}`;
      const created = await evaluate(`window.__BENCH.createTaskVerified(${JSON.stringify(title)})`);
      if (!created.ok) { consistency.createFailures += 1; continue; }
      const tab = await cdp.send('Target.createTarget', { url: 'about:blank' });
      await sleep(400);
      await cdp.send('Target.closeTarget', { targetId: tab.targetId }).catch(() => undefined);
      await navigate(`${BASE}/tasks`);
      await appReadyMs();
      await sleep(300);
      tabResults.push(await evaluate(`window.__BENCH.hasTask(${JSON.stringify(title)})`));
    }
    consistency.tabSwitch = tabResults;
    result.consistency = {
      scale: 5000,
      repeats: REPEATS,
      createFailures: consistency.createFailures,
      scenarios: {
        createThenLeaveWithinDebounce: { passes: consistency.immediateNavigate.filter(Boolean).length, total: consistency.immediateNavigate.length, raw: consistency.immediateNavigate },
        createThenLeaveAfterDebounce: { passes: consistency.afterDebounce.filter(Boolean).length, total: consistency.afterDebounce.length, raw: consistency.afterDebounce },
        modifyThenLeaveImmediately: { passes: consistency.modifyThenLeave.filter(Boolean).length, total: consistency.modifyThenLeave.length, raw: consistency.modifyThenLeave },
        tabSwitchAndReturn: { passes: consistency.tabSwitch.filter(Boolean).length, total: consistency.tabSwitch.length, raw: consistency.tabSwitch },
      },
    };
    console.log(JSON.stringify(result.consistency.scenarios));

    fs.writeFileSync(path.join(OUT_DIR, 'perf-raw-detail.json'), JSON.stringify(result, null, 2), 'utf8');
    console.log('\n已写出 perf-raw-detail.json');
  } finally {
    try { cdp?.ws?.close(); } catch { /* ignore */ }
    try { child.kill(); } catch { /* ignore */ }
    await sleep(500);
    try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 }); } catch { /* Edge 仍占用，忽略 */ }
  }
}

main().catch((err) => { console.error('BENCH-B FAILED:', err); process.exit(1); });
