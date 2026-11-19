/**
 * 4.5-E 模块级测量（对应 4.2 的 dashboardAggregate 6.1ms 口径）
 * dev 服务器允许动态 import TS 模块：import('/src/lib/selectors.ts')
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ROOT = process.cwd();
const BASE = process.env.BASE || 'http://127.0.0.1:5173';
const OUT = path.join(ROOT, process.env.OUT || 'docs/phase4.5/perf-4.5e-module.json');
const PORT = Number(process.env.PORT || 9430);
const PROFILE = path.join(os.tmpdir(), 'flowday-mod-45e');
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

const GEN_SRC = String.raw`(n) => {
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
    tasks.push({ id: 'bt_' + i, title: (i % 7 === 0 ? '周报整理 ' : '基准任务 ') + i, notes: i % 3 === 0 ? '备注内容 ' + i : undefined, date: iso(d), time: i % 4 === 0 ? pad(i % 24) + ':00' : undefined, durationMin: i % 4 === 0 ? 60 : undefined, priority: (i % 3) + 1, projectId: projects[i % 3].id, completed, completedAt: completed ? new Date(today.getTime() - (i % 30) * 86400000).toISOString() : undefined, createdAt: new Date(today.getTime() - i * 60000).toISOString(), source: i % 9 === 0 ? 'ai' : 'manual' });
  }
  return { version: 1, tasks, projects, habits: [{ id: 'bh_1', name: '早起', emoji: '🌱', weeklyTarget: 7, createdAt: new Date().toISOString(), archived: false }], habitLogs: [{ habitId: 'bh_1', date: iso(today) }], settings: { name: '', theme: 'light', weekStart: 1, aiEnabled: true, demoData: false } };
}`;

async function main() {
  const child = spawn(EDGE, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--headless=new', '--disable-gpu', '--no-first-run', '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
  const report = { generatedAt: new Date().toISOString(), base: BASE, repeats: 5, scales: {} };
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
    await cdp.send('Page.navigate', { url: BASE + '/today' });
    for (let i = 0; i < 300; i++) {
      const { result } = await cdp.send('Runtime.evaluate', { expression: 'Boolean(window.__FD_STORAGE__)', returnByValue: true });
      if (result.value) break;
      await sleep(20);
    }
    const ev = async (expr) => {
      const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (exceptionDetails) throw new Error('EVAL: ' + (exceptionDetails.exception?.description || exceptionDetails.text));
      return result.value;
    };
    const stats = (arr) => {
      const v = [...arr].sort((a, b) => a - b);
      const mid = Math.floor(v.length / 2);
      return { median: +(v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2).toFixed(2), min: +v[0].toFixed(2), max: +v[v.length - 1].toFixed(2), repeats: arr.map((x) => +x.toFixed(2)) };
    };
    for (let round = 0; round < 3; round++) {
      await cdp.send('Page.navigate', { url: BASE + '/today' });
      for (let i = 0; i < 300; i++) {
        const { result } = await cdp.send('Runtime.evaluate', { expression: 'Boolean(window.__FD_STORAGE__)', returnByValue: true });
        if (result.value) break;
        await sleep(20);
      }
      report['round' + (round + 1)] = {};
      for (const n of [1000, 10000, 25000, 40000]) {
      const expr =
        '(async () => {\n' +
        "  const mod = await import('/src/lib/selectors.ts');\n" +
        '  const gen = ' + GEN_SRC + ';\n' +
        '  const data = gen(' + n + ');\n' +
        '  const _d = new Date(); const _today = _d.getFullYear() + "-" + String(_d.getMonth() + 1).padStart(2, "0") + "-" + String(_d.getDate()).padStart(2, "0");\n' +
        '  const agg = [];\n' +
        '  for (let i = 0; i < 3; i++) mod.dashboardAggregate(data, _today);\n' +
        '  for (let i = 0; i < 15; i++) {\n' +
        '    const t0 = performance.now();\n' +
        '    const _d = new Date(); const _today = _d.getFullYear() + "-" + String(_d.getMonth() + 1).padStart(2, "0") + "-" + String(_d.getDate()).padStart(2, "0");\n' +
        '    mod.dashboardAggregate(data, _today);\n' +
        '    agg.push(performance.now() - t0);\n' +
        '  }\n' +
        '  return { keys: Object.keys(mod), ms: agg };\n' +
        '})()';
      const res = await ev(expr);
      const ms = (res.ms || []).filter((x) => typeof x === 'number');
      report['round' + (round + 1)][n] = ms.length ? stats(ms) : { error: 'no timing' };
      console.log('round' + (round + 1) + ' module@' + n + ': median=' + (report['round' + (round + 1)][n].median ?? 'ERR') + 'ms');
      }
    }
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8');
    console.log('WROTE ' + OUT);
  } finally {
    try { child.kill(); } catch {}
    await sleep(500);
    try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
  }
}

main().catch((e) => {
  console.error('MODULE PROBE FAILED', e);
  process.exit(1);
});
