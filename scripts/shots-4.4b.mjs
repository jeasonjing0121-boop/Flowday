// 4.4-B 截图：导入预览弹窗（桌面 / 移动 / 校验失败 / 冲突）
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const SHOT_DIR = path.join(ROOT, 'docs', 'phase4.4', 'screenshots');
const FILES_DIR = path.join(ROOT, '.tmp', 'e2e-backup-files');
const PROFILE = path.join(os.tmpdir(), 'flowday-backup-shots');
const BASE = process.env.BASE || 'http://127.0.0.1:5173';
const PORT = 9385;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(SHOT_DIR, { recursive: true });

class CDP {
  constructor(ws) { this.ws = new WebSocket(ws); this.seq = 0; this.pending = new Map(); }
  async open() { await new Promise((res, rej) => { this.ws.addEventListener('open', res, { once: true }); this.ws.addEventListener('error', () => rej(new Error('ws')), { once: true }); }); this.ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } }); }
  send(method, params = {}) { const id = ++this.seq; return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params })); }); }
}
const ev = async (cdp, e) => { const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text); return result.value; };
async function go(cdp, route) {
  await cdp.send('Page.navigate', { url: BASE + route });
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await ev(cdp, 'Boolean(window.__FD_STORAGE__ && window.__FD_STORAGE__.ready)').catch(() => false)) return;
    await sleep(60);
  }
  throw new Error('not ready');
}
async function pickFile(cdp, filePath) {
  const { root } = await cdp.send('DOM.getDocument');
  const inputs = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: 'input[type=file]' });
  await cdp.send('DOM.setFileInputFiles', { files: [filePath], nodeId: inputs.nodeIds[0] });
}
async function shot(cdp, name) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SHOT_DIR, name), Buffer.from(data, 'base64'));
  console.log('shot', name);
}

const GEN = String.raw`
window.__SEED = async (n) => {
  await new Promise((resolve) => { const r = indexedDB.deleteDatabase('flowday-db'); r.onsuccess = resolve; r.onerror = resolve; r.onblocked = resolve; });
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open('flowday-db', 1);
    req.onupgradeneeded = () => { const d = req.result; if (!d.objectStoreNames.contains('app')) d.createObjectStore('app'); if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta'); };
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
  const pad = (x) => String(x).padStart(2, '0');
  const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const today = new Date();
  const tasks = [];
  for (let i = 0; i < n; i++) tasks.push({ id: 'bt_' + i, title: '基准任务 ' + i, date: iso(today), priority: (i % 3) + 1, completed: false, createdAt: new Date().toISOString(), source: 'manual' });
  const data = { version: 1, tasks, projects: [], habits: [], habitLogs: [], settings: { name: '', theme: 'light', weekStart: 1, aiEnabled: true, demoData: false } };
  const tx = db.transaction(['app', 'meta'], 'readwrite');
  tx.objectStore('app').put({ schemaVersion: 2, updatedAt: new Date().toISOString(), revision: 1, writerId: 'seed', data }, 'state');
  tx.objectStore('meta').put({ revision: 1, updatedAt: new Date().toISOString(), writerId: 'seed' }, 'sync:v1');
  await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
  db.close();
  return n;
};
window.__GHOST = async (marker) => {
  const s = await import('/src/lib/storage/index.ts');
  const info = await s.readSyncInfo();
  const data = JSON.parse(JSON.stringify(window.__FD_STATE__));
  data.tasks.unshift({ id: 'g_' + Date.now(), title: marker, date: new Date().toISOString().slice(0, 10), priority: 2, completed: false, createdAt: new Date().toISOString(), source: 'manual' });
  return s.saveAppData(data, { baseRevision: info.revision, writerId: 'ghost' });
};
`;

function makeFile(name, data, tamper) {
  const dataJson = JSON.stringify(data);
  const checksum = crypto.createHash('sha256').update(Buffer.from(dataJson, 'utf8')).digest('hex');
  const envelope = { app: 'FlowDay', formatVersion: 1, schemaVersion: 2, exportedAt: '2026-11-14T08:00:00.000Z', counts: { tasks: data.tasks.length, projects: 0, habits: 0, habitLogs: 0 }, checksum: { alg: 'sha-256', value: tamper ? '0'.repeat(64) : checksum } };
  const p = path.join(FILES_DIR, name);
  fs.mkdirSync(FILES_DIR, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(envelope).slice(0, -1) + ',"data":' + dataJson + '}', 'utf8');
  return p;
}

async function main() {
  const child = spawn(EDGE, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--headless=new', '--disable-gpu', '--no-first-run', '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
  try {
    for (let i = 0; i < 100; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) break; } catch {} await sleep(200); }
    const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter((t) => t.type === 'page')[0];
    const cdp = new CDP(page.webSocketDebuggerUrl); await cdp.open();
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: GEN });
    await cdp.send('Page.navigate', { url: BASE + '/vite.svg' });
    await sleep(600);
    await ev(cdp, 'window.__SEED(40)');

    const data = {
      version: 1,
      tasks: [
        { id: 'p1', title: '预览示例任务一', date: '2026-11-14', priority: 1, completed: false, createdAt: '2026-11-14T01:00:00.000Z', source: 'manual' },
        { id: 'p1', title: '重复 ID 任务（将被去重）', date: '2026-11-14', priority: 2, completed: false, createdAt: '2026-11-14T01:00:00.000Z', source: 'manual' },
        { id: 'p2', title: '非法时间任务', date: '2026-11-14', time: '99:99', priority: 9, completed: false, createdAt: '2026-11-14T01:00:00.000Z', source: 'manual' },
      ],
      projects: [], habits: [], habitLogs: [],
      settings: { name: '', theme: 'light', weekStart: 1, aiEnabled: true, demoData: false },
    };
    const good = makeFile('shot-good.json', data, false);
    const bad = makeFile('shot-bad.json', data, true);

    await go(cdp, '/settings');
    await pickFile(cdp, good);
    await sleep(900);
    await shot(cdp, 'import-preview-desktop.png');
    await ev(cdp, `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '取消' && x.closest('[data-fd-import-preview]')); if (b) b.click(); return true; })()`);
    await sleep(300);

    // 深色模式预览（通过设置页真实切换主题）
    await ev(cdp, `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '深色'); if (b) b.click(); return true; })()`);
    await sleep(500);
    await pickFile(cdp, good);
    await sleep(900);
    await shot(cdp, 'import-preview-dark.png');
    await ev(cdp, `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '取消' && x.closest('[data-fd-import-preview]')); if (b) b.click(); return true; })()`);
    await sleep(300);
    await ev(cdp, `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '浅色'); if (b) b.click(); return true; })()`);
    await sleep(400);

    await pickFile(cdp, bad);
    await sleep(900);
    await shot(cdp, 'import-preview-error.png');
    await ev(cdp, `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '取消' && x.closest('[data-fd-import-preview]')); if (b) b.click(); return true; })()`);
    await sleep(300);

    await pickFile(cdp, good);
    await sleep(700);
    await ev(cdp, `window.__GHOST('截图并发写入')`);
    await sleep(1400);
    await shot(cdp, 'import-preview-conflict.png');
    await ev(cdp, `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '取消' && x.closest('[data-fd-import-preview]')); if (b) b.click(); return true; })()`);
    await sleep(300);

    // 持久化状态 + 上次导出提醒（先真实触发一次导出以记录时间）
    await ev(cdp, `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('导出 JSON 备份')); if (b) b.click(); return true; })()`);
    await sleep(1200);
    await go(cdp, '/settings');
    await sleep(600);
    await ev(cdp, `(() => { const el = document.querySelector('[data-fd-persist-state]'); if (el) el.scrollIntoView({ block: 'center' }); return true; })()`);
    await sleep(400);
    await shot(cdp, 'settings-persist-export.png');
  } finally {
    try { child.kill(); } catch {}
    await sleep(600);
    for (let i = 0; i < 8; i++) { try { fs.rmSync(PROFILE, { recursive: true, force: true }); break; } catch { await sleep(300); } }
  }
}
main().catch((e) => { console.error('SHOTS FAILED', e); process.exit(1); });
