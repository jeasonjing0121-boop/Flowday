/**
 * Phase 4.5-E 存储压力与异常注入（隔离 profile；不改产品代码）
 * 用法：BASE=http://127.0.0.1:5173 node scripts/stress-4.5e-storage.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ROOT = process.cwd();
const BASE = process.env.BASE || 'http://127.0.0.1:5173';
const OUT = path.join(ROOT, process.env.OUT || 'docs/phase4.5/stress-4.5e-storage.json');
const PORT = Number(process.env.PORT || 9423);
const PROFILE = path.join(os.tmpdir(), 'flowday-stor-45e');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.rmSync(PROFILE, { recursive: true, force: true });

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass: Boolean(pass), detail: String(detail).slice(0, 300) });
  console.log(`  ${pass ? '✓' : '✗'} ${name}${detail ? ' — ' + String(detail).slice(0, 160) : ''}`);
};

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

const SEED_FN = `(async (n) => {
  await new Promise((resolve) => { const r = indexedDB.deleteDatabase('flowday-db'); r.onsuccess = resolve; r.onerror = resolve; r.onblocked = resolve; });
  const db = await new Promise((resolve, reject) => { const req = indexedDB.open('flowday-db', 1); req.onupgradeneeded = () => { const d = req.result; if (!d.objectStoreNames.contains('app')) d.createObjectStore('app'); if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta'); }; req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
  const pad = (x) => String(x).padStart(2, '0');
  const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const now = new Date().toISOString();
  const today = new Date();
  const tasks = [];
  for (let i = 0; i < n; i++) tasks.push({ id: 'st_' + i, title: '存储任务 ' + i, date: iso(today), priority: (i % 3) + 1, completed: false, createdAt: now, source: 'manual' });
  const data = { version: 1, tasks, projects: [], habits: [], habitLogs: [], settings: { name: '存储', theme: 'light', weekStart: 1, aiEnabled: true, demoData: false } };
  const tx = db.transaction(['app', 'meta'], 'readwrite');
  tx.objectStore('app').put({ schemaVersion: 2, updatedAt: now, revision: 1, writerId: 'stress', data }, 'state');
  tx.objectStore('meta').put({ revision: 1, updatedAt: now, writerId: 'stress' }, 'sync:v1');
  await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  db.close();
  return n;
})`;

async function main() {
  const child = spawn(EDGE, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--headless=new', '--disable-gpu', '--no-first-run', '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
  const report = { generatedAt: new Date().toISOString(), base: BASE, results };
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

    const ev = async (expr) => {
      const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (exceptionDetails) throw new Error('EVAL: ' + (exceptionDetails.exception?.description || exceptionDetails.text));
      return result.value;
    };
    const goto = async (route) => {
      await cdp.send('Page.navigate', { url: BASE + route });
      for (let i = 0; i < 500; i++) {
        const ok = await ev('Boolean(window.__FD_STORAGE__ && window.__FD_STORAGE__.ready)').catch(() => false);
        if (ok) return true;
        await sleep(15);
      }
      return false;
    };
    const blank = async () => {
      await cdp.send('Page.navigate', { url: BASE + '/bench-blank.html' });
      await sleep(300);
    };
    const seed = async (n) => {
      await blank();
      return ev(`(${SEED_FN})(${n})`);
    };
    const dbState = `(async () => {
      const db = await new Promise((res, rej) => { const r = indexedDB.open('flowday-db'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const rec = await new Promise((res) => { const q = db.transaction('app','readonly').objectStore('app').get('state'); q.onsuccess = () => res(q.result); });
      const meta = await new Promise((res) => { const q = db.transaction('meta','readonly').objectStore('meta').get('sync:v1'); q.onsuccess = () => res(q.result); });
      db.close();
      const ids = rec?.data?.tasks?.map((t) => t.id) ?? [];
      return { revision: rec?.revision ?? null, metaRevision: meta?.revision ?? null, tasks: ids.length, uniqueIds: new Set(ids).size, completed: rec?.data?.tasks?.filter((t) => t.completed).length ?? null };
    })()`;

    // A) 高频保存（10k 数据，40 次快速操作）
    await seed(10000);
    await goto('/tasks');
    await sleep(400);
    const before = await ev(dbState);
    const rapid = await ev(`(async () => {
      const clicks = [];
      for (let i = 0; i < 40; i++) {
        const b = document.querySelector('[data-testid="task-toggle"]');
        if (!b) return { clicked: clicks.length, err: 'no toggle' };
        b.click();
        clicks.push(i);
        await new Promise((r) => setTimeout(r, 30));
      }
      return { clicked: clicks.length };
    })()`);
    await sleep(2500);
    const after = await ev(dbState);
    check('高频保存（40 次快速勾选）无丢失且 revision 单调', rapid.clicked === 40 && after.revision > before.revision && after.tasks === before.tasks && after.uniqueIds === before.tasks, JSON.stringify({ rapid, before: before.revision, after: after.revision }));
    check('revision 与 meta 一致（CAS 单事务）', after.revision === after.metaRevision, JSON.stringify({ rev: after.revision, meta: after.metaRevision }));

    // B) 事务 abort 注入（一次）：先等启动回声 skipNext 消耗完（>400ms），否则首次变更会被回声吸收而不会触发保存
    await cdp.send('Page.navigate', { url: BASE + '/tasks' });
    await sleep(600);
    await ev(`(() => { const orig = IDBObjectStore.prototype.put; let once = true; IDBObjectStore.prototype.put = function (...args) { if (once) { once = false; throw new DOMException('injected abort', 'AbortError'); } return orig.apply(this, args); }; return true; })()`);
    await ev(`(() => { const b = document.querySelector('[data-testid="task-toggle"]'); if (b) b.click(); return Boolean(b); })()`);
    await sleep(1500);
    const abortState = await ev(`(() => ({ persistence: window.__FD_STORAGE__?.persistence, toast: document.querySelector('[data-fd-toast][data-fd-toast="error"]')?.textContent || '' }))()`);
    check('写入异常（abort 注入）被捕获：持久化关闭 + 错误提示', abortState.persistence === false && abortState.toast.length > 0, JSON.stringify(abortState));

    // C) quota 注入（新页面，同样等 echo-skip 结束）
    await cdp.send('Page.navigate', { url: BASE + '/tasks' });
    await sleep(600);
    await ev(`(() => { const orig = IDBObjectStore.prototype.put; let once = true; IDBObjectStore.prototype.put = function (...args) { if (once) { once = false; throw new DOMException('quota exceeded', 'QuotaExceededError'); } return orig.apply(this, args); }; return true; })()`);
    await ev(`(() => { const b = document.querySelector('[data-testid="task-toggle"]'); if (b) b.click(); return Boolean(b); })()`);
    await sleep(1500);
    const quotaState = await ev(`(() => ({ persistence: window.__FD_STORAGE__?.persistence, toast: document.querySelector('[data-fd-toast][data-fd-toast="error"]')?.textContent || '' }))()`);
    check('配额异常被捕获：持久化关闭 + 错误提示', quotaState.persistence === false && quotaState.toast.length > 0, JSON.stringify(quotaState));

    // D) IndexedDB 不可用：必须在文档创建前注入（导航会重建 window，页面内改写无效）
    const dbDownScript = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: "Object.defineProperty(window, 'indexedDB', { configurable: true, get() { return undefined; } });",
    });
    await cdp.send('Page.navigate', { url: BASE + '/today' });
    await sleep(2000);
    const dbDown = await ev(`(() => ({ ready: window.__FD_STORAGE__?.ready, persistence: window.__FD_STORAGE__?.persistence, toast: document.querySelector('[data-fd-toast]')?.textContent || '', rendered: Boolean(document.querySelector('main')) }))()`).catch((e) => ({ error: e.message }));
    check('IndexedDB 不可用：应用仍可渲染并明确报错（不白屏）', Boolean(dbDown.rendered) && dbDown.persistence === false, JSON.stringify(dbDown));
    // 移除注入，恢复正常加载
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: dbDownScript.identifier }).catch(() => null);
    await goto('/today');
    const recovered = await ev(dbState);
    check('IndexedDB 恢复后数据完好（异常未破坏已有数据）', recovered.tasks === 10000 && recovered.uniqueIds === 10000, JSON.stringify(recovered));

    // E) 写入期间关闭页面（导航离开，触发 pagehide 补写）
    await goto('/tasks');
    await sleep(300);
    const revBefore = (await ev(dbState)).revision;
    const toggleInfo = await ev(`(() => { const b = document.querySelector('[data-testid="task-toggle"]'); if (!b) return null; const id = b.closest('[data-task-id]')?.getAttribute('data-task-id'); b.click(); return { id }; })()`);
    await cdp.send('Page.navigate', { url: BASE + '/calendar' });
    await sleep(1200);
    const afterClose = await ev(dbState);
    const consistent = afterClose.taskCountOk !== false;
    check('页面关闭期间写入：重载后数据一致（无半写，revision 单调）', afterClose.revision >= revBefore && afterClose.uniqueIds === afterClose.tasks, JSON.stringify({ revBefore, rev: afterClose.revision, unique: afterClose.uniqueIds, tasks: afterClose.tasks }));

    // F) 持续写入下的读取一致性（读取 30 次 revision/data）
    await goto('/tasks');
    await sleep(300);
    const consistency = await ev(`(async () => {
      const reads = [];
      for (let i = 0; i < 30; i++) {
        const b = document.querySelector('[data-testid="task-toggle"]');
        if (b) b.click();
        await new Promise((r) => setTimeout(r, 120));
        reads.push({ r: window.__FD_STORAGE__.revision, n: window.__FD_STATE__.tasks.length });
      }
      const monotonic = reads.every((x, i) => i === 0 || x.r >= reads[i - 1].r);
      const ids = window.__FD_STATE__.tasks.map((t) => t.id);
      return { monotonic, unique: new Set(ids).size === ids.length, count: ids.length, lastRev: reads[reads.length - 1].r };
    })()`);
    check('持续写入下读取一致：revision 单调且任务 id 唯一', consistency.monotonic && consistency.unique, JSON.stringify(consistency));

    // G) 导入失败不破坏数据（构造非法备份，走真实导入流程）
    await goto('/settings');
    await sleep(400);
    const bad = path.join(ROOT, '.tmp', 'stress-bad.json');
    fs.mkdirSync(path.join(ROOT, '.tmp'), { recursive: true });
    fs.writeFileSync(bad, JSON.stringify({ app: 'FlowDay', formatVersion: 1, schemaVersion: 2, checksum: { alg: 'sha-256', value: '0'.repeat(64) }, counts: { tasks: 1, projects: 0, habits: 0, habitLogs: 0 }, data: { version: 1, tasks: [{ id: 'x', title: 'x', date: '2026-01-01', priority: 1, completed: false, createdAt: new Date().toISOString(), source: 'manual' }], projects: [], habits: [], habitLogs: [], settings: { name: '', theme: 'light', weekStart: 1, aiEnabled: true, demoData: false } } }), 'utf8');
    const { root } = await cdp.send('DOM.getDocument');
    const inputs = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: 'input[type=file]' });
    await cdp.send('DOM.setFileInputFiles', { files: [bad], nodeId: inputs.nodeIds[0] });
    await sleep(900);
    const previewBlocked = await ev(`(() => ({ confirmDisabled: document.querySelector('[data-fd-import-confirm="1"]')?.disabled, error: Boolean(document.querySelector('[data-fd-import-error]')) }))()`);
    await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '取消' && x.closest('[data-fd-import-preview]')); if (b) b.click(); return true; })()`);
    const afterImportFail = await ev(dbState);
    check('导入失败被拒绝且不破坏已有数据', previewBlocked.confirmDisabled === true && afterImportFail.tasks === 10000, JSON.stringify({ previewBlocked, tasks: afterImportFail.tasks }));

    const passed = results.filter((r) => r.pass).length;
    fs.writeFileSync(OUT, JSON.stringify({ ...report, passed, failed: results.length - passed }, null, 2), 'utf8');
    console.log(`\n存储压力结果：${passed} 通过 / ${results.length - passed} 失败（共 ${results.length} 项）`);
    console.log('WROTE ' + OUT);
    if (passed !== results.length) process.exitCode = 1;
  } finally {
    try { child.kill(); } catch {}
    await sleep(600);
    try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
  }
}

main().catch((e) => {
  console.error('STORAGE STRESS FAILED', e);
  process.exit(1);
});
