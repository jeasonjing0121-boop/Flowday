/**
 * Phase 4.5-E 内存与生命周期长跑（500 次操作；采堆/DOM/监听器；GC 前后对比）
 * 用法：BASE=http://127.0.0.1:5173 node scripts/stress-4.5e-memory.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ROOT = process.cwd();
const BASE = process.env.BASE || 'http://127.0.0.1:5173';
const OUT = path.join(ROOT, process.env.OUT || 'docs/phase4.5/stress-4.5e-memory.json');
const PORT = Number(process.env.PORT || 9422);
const PROFILE = path.join(os.tmpdir(), 'flowday-mem-45e');
const OPS_TARGET = Number(process.env.OPS || 500);
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

async function main() {
  const child = spawn(EDGE, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--headless=new', '--disable-gpu', '--no-first-run', '--window-size=1280,900', '--hide-scrollbars', '--js-flags=--expose-gc', 'about:blank'], { stdio: 'ignore' });
  const report = { generatedAt: new Date().toISOString(), base: BASE, opsTarget: OPS_TARGET, samples: [], heapStartMB: null, heapEndMB: null, gcStartMB: null, gcEndMB: null, domStart: null, domEnd: null, listeners: {}, notes: [] };
  try {
    for (let i = 0; i < 120; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
        if (r.ok) break;
      } catch {}
      await sleep(200);
    }
    const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter((t) => t.type === 'page')[0];
    const cdp = new CDP(page.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Performance.enable');
    await cdp.send('HeapProfiler.enable');

    const ev = async (expr) => {
      const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (exceptionDetails) throw new Error('EVAL: ' + (exceptionDetails.exception?.description || exceptionDetails.text));
      return result.value;
    };
    const heapMB = async () => {
      const { metrics } = await cdp.send('Performance.getMetrics');
      const g = (n) => (metrics.find((x) => x.name === n) || {}).value ?? 0;
      return { heapMB: +(g('JSHeapUsedSize') / 1048576).toFixed(2), nodes: g('Nodes'), docs: g('Documents'), listeners: g('JSEventListeners') };
    };
    const gc = async () => {
      try {
        await cdp.send('HeapProfiler.collectGarbage');
      } catch {
        await ev('window.gc && window.gc()').catch(() => null);
      }
      await sleep(120);
    };
    const goto = async (route) => {
      await cdp.send('Page.navigate', { url: BASE + route });
      for (let i = 0; i < 400; i++) {
        const ok = await ev('Boolean(window.__FD_STORAGE__ && window.__FD_STORAGE__.ready)').catch(() => false);
        if (ok) return true;
        await sleep(15);
      }
      return false;
    };
    const seed = async (n) => {
      await goto('/bench-blank.html');
      await sleep(300);
      await ev(`(async () => {
        await new Promise((resolve) => { const r = indexedDB.deleteDatabase('flowday-db'); r.onsuccess = resolve; r.onerror = resolve; r.onblocked = resolve; });
        const db = await new Promise((resolve, reject) => { const req = indexedDB.open('flowday-db', 1); req.onupgradeneeded = () => { const d = req.result; if (!d.objectStoreNames.contains('app')) d.createObjectStore('app'); if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta'); }; req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
        const pad = (x) => String(x).padStart(2, '0');
        const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
        const today = new Date();
        const now = new Date().toISOString();
        const tasks = [];
        for (let i = 0; i < ${n}; i++) { const d = new Date(today.getTime() + ((i % 40) - 10) * 86400000); tasks.push({ id: 'mt_' + i, title: '内存任务 ' + i, notes: i % 4 === 0 ? '备注 ' + i : undefined, date: iso(d), priority: (i % 3) + 1, completed: i % 6 === 0, completedAt: i % 6 === 0 ? now : undefined, createdAt: now, source: 'manual' }); }
        const habits = [{ id: 'mh_1', name: '早起', emoji: '🌱', weeklyTarget: 7, createdAt: now, archived: false }];
        const data = { version: 1, tasks, projects: [{ id: 'mp_1', name: '项目', color: '#5B5CBF' }], habits, habitLogs: [], settings: { name: '压力', theme: 'light', weekStart: 1, aiEnabled: true, demoData: false } };
        const tx = db.transaction(['app', 'meta'], 'readwrite');
        tx.objectStore('app').put({ schemaVersion: 2, updatedAt: now, revision: 1, writerId: 'stress', data }, 'state');
        tx.objectStore('meta').put({ revision: 1, updatedAt: now, writerId: 'stress' }, 'sync:v1');
        await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
        db.close();
        return true;
      })()`);
    };

    await seed(2000);
    await goto('/today');
    await sleep(600);
    await gc();
    const start = await heapMB();
    report.heapStartMB = start.heapMB;
    report.domStart = start.nodes;

    const pages = ['/today', '/tasks', '/calendar', '/habits', '/assistant', '/settings'];
    let op = 0;
    const t0 = Date.now();
    let sample = 0;
    while (op < OPS_TARGET) {
      // 1) 页面切换
      await goto(pages[op % pages.length]);
      await sleep(120);
      op += 1;
      // 2) 弹窗开关（任务编辑器 / 设置导出菜单）
      await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('新建任务')); if (b) b.click(); return Boolean(b); })()`).catch(() => null);
      await sleep(120);
      await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`).catch(() => null);
      await sleep(80);
      op += 1;
      // 3) 任务操作：勾选 + 删除（在任务页/今日页时）
      await goto('/tasks');
      await sleep(150);
      await ev(`(() => { const b = document.querySelector('[data-testid="task-toggle"]'); if (b) b.click(); return Boolean(b); })()`).catch(() => null);
      await sleep(120);
      op += 1;
      // 4) 搜索与筛选
      await ev(`(() => { const el = document.querySelector('#task-search'); if (!el) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '内存任务 1'); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`).catch(() => null);
      await sleep(160);
      await ev(`(() => { const el = document.querySelector('#filter-priority'); if (!el) return false; el.value = '2'; el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`).catch(() => null);
      await sleep(120);
      await ev(`(() => { const el = document.querySelector('#task-search'); if (!el) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ''); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`).catch(() => null);
      await sleep(120);
      op += 1;
      // 5) 主题切换（每 10 轮）
      if (op % 40 === 0) {
        await ev(`(() => { const b = [...document.querySelectorAll('[aria-label="主题"] button')].find((x) => x.textContent.trim() === '深色'); if (b) b.click(); return Boolean(b); })()`).catch(() => null);
        await sleep(200);
        await ev(`(() => { const b = [...document.querySelectorAll('[aria-label="主题"] button')].find((x) => x.textContent.trim() === '浅色'); if (b) b.click(); return Boolean(b); })()`).catch(() => null);
        await sleep(200);
        op += 1;
      }
      if (op % 40 < 4) {
        // 固定在同一页面采样（GC 后），避免页面差异污染趋势
        await goto('/today');
        await sleep(250);
        await gc();
        const h = await heapMB();
        report.samples.push({ op, heapMB: h.heapMB, nodes: h.nodes, listeners: h.listeners, docs: h.docs, elapsedSec: Math.round((Date.now() - t0) / 1000) });
        sample += 1;
      }
    }
    // 结束时强制 GC 采尾值 + 监听器统计
    await gc();
    const end = await heapMB();
    report.heapEndMB = end.heapMB;
    report.domEnd = end.nodes;
    report.listeners = { window: null, document: null };
    try {
      const { result } = await cdp.send('Runtime.evaluate', { expression: 'document', objectGroup: 'l' });
      const docListeners = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
      report.listeners.document = docListeners.listeners.length;
    } catch (e) {
      report.notes.push('document listener count unavailable: ' + e.message);
    }
    report.samples.push({ op, heapMB: end.heapMB, nodes: end.nodes, listeners: end.listeners, docs: end.docs, elapsedSec: Math.round((Date.now() - t0) / 1000), final: true });
    report.elapsedSec = Math.round((Date.now() - t0) / 1000);
    report.opsDone = op;
    const gcSamples = report.samples.map((s) => s.heapMB);
    report.heapGrowthMB = +(gcSamples[gcSamples.length - 1] - gcSamples[0]).toFixed(2);
    report.heapGrowthPct = gcSamples[0] ? +(((gcSamples[gcSamples.length - 1] - gcSamples[0]) / gcSamples[0]) * 100).toFixed(1) : null;
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8');
    console.log(`ops=${op} elapsed=${report.elapsedSec}s heap ${report.heapStartMB} → ${report.heapEndMB} MB (${report.heapGrowthPct}%), nodes ${report.domStart} → ${report.domEnd}, doc listeners ${report.listeners.document}`);
    console.log('WROTE ' + OUT);
  } finally {
    try { child.kill(); } catch {}
    await sleep(600);
    try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
  }
}

main().catch((e) => {
  console.error('MEMORY STRESS FAILED', e);
  process.exit(1);
});
