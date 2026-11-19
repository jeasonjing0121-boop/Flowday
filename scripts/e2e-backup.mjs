// FlowDay Phase 4.4-B — 备份交互/导入保护/持久化状态 专项 E2E（真实浏览器）
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const OUT_DIR = path.join(ROOT, 'docs', 'phase4.4');
const DOWNLOAD_DIR = path.join(ROOT, '.tmp', 'e2e-backup-download');
const FILES_DIR = path.join(ROOT, '.tmp', 'e2e-backup-files');
const BASE = process.env.BASE || 'http://127.0.0.1:5173';
const PORT = 9380;
const PORT_P = 9381;
const PORT_U = 9382;
const PROFILE = path.join(os.tmpdir(), 'flowday-backup-profile');
const PROFILE_P = path.join(os.tmpdir(), 'flowday-backup-profile-persist');
const PROFILE_U = path.join(os.tmpdir(), 'flowday-backup-profile-unsup');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const d of [PROFILE, PROFILE_P, PROFILE_U, DOWNLOAD_DIR, FILES_DIR]) fs.rmSync(d, { recursive: true, force: true });
fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
fs.mkdirSync(FILES_DIR, { recursive: true });

const results = [];
function record(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`${pass ? '  ✓' : '  ✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

class CDP {
  constructor(ws) { this.ws = new WebSocket(ws); this.seq = 0; this.pending = new Map(); }
  async open() {
    await new Promise((res, rej) => { this.ws.addEventListener('open', res, { once: true }); this.ws.addEventListener('error', () => rej(new Error('ws')), { once: true }); });
    this.ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
    });
  }
  send(method, params = {}) { const id = ++this.seq; return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params })); }); }
}
async function evaluate(cdp, expr) {
  const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (exceptionDetails) throw new Error((exceptionDetails.exception?.description ?? exceptionDetails.text).slice(0, 400));
  return result.value;
}
async function waitPort(port, timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) return r.json(); } catch { /* retry */ }
    await sleep(200);
  }
  throw new Error('devtools not ready ' + port);
}
async function launch(port, profile, initScripts = []) {
  const child = spawn(EDGE, [
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--headless=new', '--disable-gpu',
    '--no-first-run', '--no-default-browser-check', '--window-size=1280,900', 'about:blank',
  ], { stdio: 'ignore' });
  await waitPort(port);
  const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).filter((t) => t.type === 'page')[0];
  const cdp = new CDP(page.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: GEN });
  for (const source of initScripts) await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source });
  return { child, cdp };
}
async function go(cdp, route) {
  await cdp.send('Page.navigate', { url: BASE + route });
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const ready = await evaluate(cdp, 'Boolean(window.__FD_STORAGE__ && window.__FD_STORAGE__.ready)').catch(() => false);
    if (ready) return;
    await sleep(60);
  }
  throw new Error('app not ready ' + route);
}
async function waitUntil(fn, timeoutMs = 5000, interval = 60) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if (await fn()) return true; } catch { /* page busy */ }
    await sleep(interval);
  }
  return false;
}
async function pickFile(cdp, filePath) {
  const { root } = await cdp.send('DOM.getDocument');
  const inputs = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: 'input[type=file]' });
  const nodeId = inputs.nodeIds[0];
  if (!nodeId) return false;
  await cdp.send('DOM.setFileInputFiles', { files: [filePath], nodeId });
  return true;
}
async function closePreview(cdp) {
  await evaluate(cdp, `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '取消' && x.closest('[data-fd-import-preview]')); if (b) b.click(); return true; })()`);
  await sleep(250);
}
const hasTitle = (cdp, title) => evaluate(cdp, `window.__FD_STATE__.tasks.some((t) => t.title === ${JSON.stringify(title)})`);
const dbHasTitle = (cdp, title) =>
  evaluate(cdp, `(async () => { const s = await import('/src/lib/storage/index.ts'); const snap = await s.loadSnapshot(); return snap ? snap.data.tasks.some((t) => t.title === ${JSON.stringify(title)}) : null; })()`);

const GEN = String.raw`
window.__GEN = (n) => {
  const pad = (x) => String(x).padStart(2, '0');
  const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const today = new Date();
  const tasks = [];
  for (let i = 0; i < n; i++) {
    tasks.push({ id: 'bt_' + i, title: '基准任务 ' + i, date: iso(today), priority: (i % 3) + 1, completed: false, createdAt: new Date().toISOString(), source: 'manual' });
  }
  return { version: 1, tasks, projects: [], habits: [], habitLogs: [], settings: { name: '', theme: 'light', weekStart: 1, aiEnabled: true, demoData: false } };
};
window.__SEED = async (n) => {
  await new Promise((resolve) => { const r = indexedDB.deleteDatabase('flowday-db'); r.onsuccess = resolve; r.onerror = resolve; r.onblocked = resolve; });
  localStorage.removeItem('flowday.lastExportAt.v1');
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open('flowday-db', 1);
    req.onupgradeneeded = () => { const d = req.result; if (!d.objectStoreNames.contains('app')) d.createObjectStore('app'); if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta'); };
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
  const tx = db.transaction(['app', 'meta'], 'readwrite');
  tx.objectStore('app').put({ schemaVersion: 2, updatedAt: new Date().toISOString(), revision: 1, writerId: 'seed', data: window.__GEN(n) }, 'state');
  tx.objectStore('meta').put({ revision: 1, updatedAt: new Date().toISOString(), writerId: 'seed' }, 'sync:v1');
  await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
  db.close();
  return n;
};
window.__GHOST = async (marker) => {
  const s = await import('/src/lib/storage/index.ts');
  const info = await s.readSyncInfo();
  const data = JSON.parse(JSON.stringify(window.__FD_STATE__));
  data.tasks.unshift({ id: 'ghost_' + Date.now(), title: marker, date: new Date().toISOString().slice(0, 10), priority: 2, completed: false, createdAt: new Date().toISOString(), source: 'manual' });
  return s.saveAppData(data, { baseRevision: info.revision, writerId: 'ghost-44b' });
};
window.__SETFILE = (text, name) => {
  const input = document.querySelector('input[type=file]');
  if (!input) return false;
  const file = new File([text], name || 'backup.json', { type: 'application/json' });
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
};
`;

const SETTINGS = { name: '', theme: 'light', weekStart: 1, aiEnabled: true, demoData: false };
function mkData(id, title) {
  return {
    version: 1,
    tasks: [{ id, title, date: '2026-11-14', priority: 2, completed: false, createdAt: '2026-11-14T01:00:00.000Z', source: 'manual' }],
    projects: [],
    habits: [],
    habitLogs: [],
    settings: SETTINGS,
  };
}
function makeBackupFile(name, data, opts = {}) {
  const dataJson = JSON.stringify(data);
  const checksum = crypto.createHash('sha256').update(Buffer.from(dataJson, 'utf8')).digest('hex');
  const counts = { tasks: data.tasks.length, projects: data.projects.length, habits: data.habits.length, habitLogs: data.habitLogs.length };
  const envelope = {
    app: 'FlowDay',
    schemaVersion: 2,
    exportedAt: opts.exportedAt ?? '2026-11-14T08:00:00.000Z',
    counts,
  };
  if (opts.formatVersion !== undefined) envelope.formatVersion = opts.formatVersion;
  else envelope.formatVersion = 1;
  if (!opts.noChecksum) envelope.checksum = { alg: 'sha-256', value: opts.tamperChecksum ?? checksum };
  const file = JSON.stringify(envelope).slice(0, -1) + ',"data":' + dataJson + '}';
  const p = path.join(FILES_DIR, name);
  fs.writeFileSync(p, file, 'utf8');
  return p;
}

async function main() {
  const browser = await launch(PORT, PROFILE);
  const cdp = browser.cdp;
  await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOAD_DIR }).catch(() => undefined);
  try {
    await cdp.send('Page.navigate', { url: BASE + '/vite.svg' });
    await sleep(600);
    await evaluate(cdp, 'window.__SEED(60)');
    await go(cdp, '/settings');

    const f1 = makeBackupFile('s1.json', mkData('bm1', 'bm-s1'));
    const f2raw = makeBackupFile('s2.json', mkData('bm2', 'bm-s2-legacy'), { noChecksum: true });
    fs.writeFileSync(f2raw, fs.readFileSync(f2raw, 'utf8').replace('"formatVersion":1,', ''), 'utf8');
    const f3 = makeBackupFile('s3.json', mkData('bm3', 'bm-s3'), { tamperChecksum: '0'.repeat(64) });
    const f4 = makeBackupFile('s4.json', mkData('bm4', 'bm-s4'), { formatVersion: 2 });
    const noisy = mkData('bm5', 'bm-s5');
    noisy.tasks.push({ ...noisy.tasks[0] });
    noisy.tasks.push({ id: 'bm5bad', title: '非法字段任务', date: '2026-11-14', time: '99:99', priority: 9, notes: 'x'.repeat(6000), completed: false, createdAt: '2026-11-14T01:00:00.000Z', source: 'manual' });
    const f5 = makeBackupFile('s5.json', noisy);
    const f6 = makeBackupFile('s6.json', mkData('bm6', 'bm-s6'));
    const f7 = makeBackupFile('s7.json', mkData('bm7', 'bm-s7'));
    const f8 = makeBackupFile('s8.json', mkData('bm8', 'bm-s8'));

    // S1 正常新格式导入
    await pickFile(cdp, f1);
    await waitUntil(() => evaluate(cdp, `Boolean(document.querySelector('[data-fd-import-preview]'))`));
    const checksumChip = await evaluate(cdp, `document.querySelector('[data-fd-import-checksum]')?.getAttribute('data-fd-import-checksum') || null`);
    const exportedAtShown = await evaluate(cdp, `(() => { const el = document.querySelector('[data-fd-import-exportedat]'); const txt = el ? el.textContent : ''; return { attr: el ? el.getAttribute('data-fd-import-exportedat') : null, txt, hasUnknown: txt.includes('未知') || txt.includes('Invalid') || txt.includes('NaN') }; })()`);
    const confirmEnabled = await evaluate(cdp, `(() => { const b = document.querySelector('[data-fd-import-confirm="1"]'); return Boolean(b) && !b.disabled; })()`);
    await evaluate(cdp, `document.querySelector('[data-fd-import-confirm="1"]').click()`);
    await sleep(900);
    record(
      'S1 正常备份导入（校验和 verified + 确认后写入 + 备份时间真实展示）',
      checksumChip === 'verified' && confirmEnabled && (await hasTitle(cdp, 'bm-s1')) && Boolean(exportedAtShown.attr) && !exportedAtShown.hasUnknown && /2026/.test(exportedAtShown.txt),
      `chip=${checksumChip} exportedAt=${exportedAtShown.attr} txt=${exportedAtShown.txt}`
    );

    // S2 旧格式（无 formatVersion/checksum）
    await go(cdp, '/settings');
    await pickFile(cdp, f2raw);
    await waitUntil(() => evaluate(cdp, `Boolean(document.querySelector('[data-fd-import-preview]'))`));
    const legacyChip = await evaluate(cdp, `document.querySelector('[data-fd-import-checksum]')?.getAttribute('data-fd-import-checksum') || null`);
    await evaluate(cdp, `document.querySelector('[data-fd-import-confirm="1"]').click()`);
    await sleep(900);
    record('S2 旧格式备份导入（标记未校验）', legacyChip === 'unverified-legacy' && (await hasTitle(cdp, 'bm-s2-legacy')), `chip=${legacyChip}`);

    // S3 校验和错误
    await go(cdp, '/settings');
    await pickFile(cdp, f3);
    await waitUntil(() => evaluate(cdp, `Boolean(document.querySelector('[data-fd-import-error]'))`));
    const tamperErr = await evaluate(cdp, `document.querySelector('[data-fd-import-error]')?.textContent || ''`);
    const tamperDisabled = await evaluate(cdp, `(() => { const b = document.querySelector('[data-fd-import-confirm="1"]'); return Boolean(b) && b.disabled; })()`);
    record('S3 校验和错误拒绝导入（禁止继续）', tamperErr.includes('校验和') && tamperDisabled && !(await hasTitle(cdp, 'bm-s3')), tamperErr.slice(0, 50));
    await closePreview(cdp);

    // S4 未知格式版本
    await go(cdp, '/settings');
    await pickFile(cdp, f4);
    await waitUntil(() => evaluate(cdp, `Boolean(document.querySelector('[data-fd-import-error]'))`));
    const futureErr = await evaluate(cdp, `document.querySelector('[data-fd-import-error]')?.textContent || ''`);
    const futureDisabled = await evaluate(cdp, `(() => { const b = document.querySelector('[data-fd-import-confirm="1"]'); return Boolean(b) && b.disabled; })()`);
    record('S4 未知格式版本拒绝导入', futureErr.includes('格式版本') && futureDisabled && !(await hasTitle(cdp, 'bm-s4')), futureErr.slice(0, 50));
    await closePreview(cdp);

    // S5 重复 ID / 非法字段修正提示
    await go(cdp, '/settings');
    await pickFile(cdp, f5);
    await waitUntil(() => evaluate(cdp, `Boolean(document.querySelector('[data-fd-import-preview]'))`));
    const previewText = await evaluate(cdp, `document.querySelector('[data-fd-import-preview]').textContent`);
    await evaluate(cdp, `document.querySelector('[data-fd-import-confirm="1"]').click()`);
    await sleep(900);
    const noisyState = await evaluate(cdp, `(() => { const t = window.__FD_STATE__.tasks; const bad = t.find((x) => x.id === 'bm5bad'); return { dup: t.filter((x) => x.id === 'bm5').length, time: bad ? bad.time : 'missing', priority: bad ? bad.priority : -1, notes: bad && bad.notes ? bad.notes.length : 0 }; })()`);
    record(
      'S5 重复 ID 与非法字段修正提示',
      previewText.includes('去重') && previewText.includes('字段修正') && noisyState.dup === 1 && noisyState.time === undefined && noisyState.priority === 3 && noisyState.notes === 5000,
      JSON.stringify(noisyState)
    );

    // S6 预览期间数据变化 → 禁用确认 + 无部分写入
    await go(cdp, '/settings');
    await pickFile(cdp, f6);
    await waitUntil(() => evaluate(cdp, `Boolean(document.querySelector('[data-fd-import-preview]'))`));
    const ghostOutcome = await evaluate(cdp, `window.__GHOST('S6 并发写入')`);
    const conflictShown = await waitUntil(() => evaluate(cdp, `Boolean(document.querySelector('[data-fd-import-conflict]'))`), 4000);
    const staleDisabled = await evaluate(cdp, `(() => { const b = document.querySelector('[data-fd-import-confirm="1"]'); return Boolean(b) && b.disabled; })()`);
    await evaluate(cdp, `(() => { const b = document.querySelector('[data-fd-import-confirm="1"]'); if (b && !b.disabled) b.click(); return true; })()`);
    await sleep(700);
    const revAfter = await evaluate(cdp, `(async () => (await import('/src/lib/storage/index.ts').then((s) => s.readSyncInfo())).revision)()`);
    record(
      'S6 预览期间数据变化 → 冲突提示 + 禁用确认 + 无部分写入',
      conflictShown && staleDisabled && !(await dbHasTitle(cdp, 'bm-s6')) && revAfter === ghostOutcome.revision,
      JSON.stringify({ conflictShown, staleDisabled, ghostRev: ghostOutcome.revision, revAfter })
    );
    await closePreview(cdp);

    // S7/S8 未保存修改：取消 / 继续
    for (const [tag, file, marker, cancelSecond] of [['S7', f7, 'bm-s7', true], ['S8', f8, 'bm-s8', false]]) {
      await go(cdp, '/settings');
      await sleep(300);
      const fileText = fs.readFileSync(file, 'utf8');
      await evaluate(cdp, `(() => {
        const input = document.querySelector('#settings-name');
        if (!input) return false;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'dirty-' + Date.now());
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return window.__SETFILE(${JSON.stringify(fileText)});
      })()`);
      const dirtyShown = await waitUntil(() => evaluate(cdp, `Boolean(document.querySelector('[data-fd-import-dirty]'))`), 2500);
      if (!dirtyShown) {
        record(`${tag} 未保存修改警告`, false, 'dirty banner not shown');
        await closePreview(cdp);
        continue;
      }
      await evaluate(cdp, `document.querySelector('[data-fd-import-confirm="1"]').click()`);
      const secondShown = await waitUntil(() => evaluate(cdp, `Boolean(document.querySelector('[data-fd-confirm]'))`), 2000);
      if (cancelSecond) {
        await evaluate(cdp, `(() => { const b = [...document.querySelectorAll('[data-fd-confirm] button')].find((x) => x.textContent.trim() === '取消'); if (b) b.click(); return true; })()`);
        await sleep(400);
        const previewStill = await evaluate(cdp, `Boolean(document.querySelector('[data-fd-import-preview]'))`);
        record(`${tag} 未保存修改时取消导入（数据不变）`, secondShown && previewStill && !(await dbHasTitle(cdp, marker)), `second=${secondShown}`);
        await closePreview(cdp);
      } else {
        await evaluate(cdp, `(() => { const b = document.querySelector('[data-fd-confirm-ok="1"]'); if (b) b.click(); return true; })()`);
        await sleep(900);
        record(`${tag} 未保存修改时确认继续导入`, secondShown && (await hasTitle(cdp, marker)), `second=${secondShown}`);
      }
      await sleep(400);
    }

    // S12 persist 真实状态
    await go(cdp, '/settings');
    const realPersisted = await evaluate(cdp, `(async () => (navigator.storage && navigator.storage.persisted) ? navigator.storage.persisted() : 'unsupported')()`);
    const chipState = await evaluate(cdp, `document.querySelector('[data-fd-persist-state]')?.getAttribute('data-fd-persist-state') || null`);
    const expectedChip = realPersisted === 'unsupported' ? 'unsupported' : realPersisted ? 'granted' : 'not-granted';
    record('S12 persist 真实状态展示与 API 一致', chipState === expectedChip, `api=${String(realPersisted)} chip=${chipState}`);

    // S14 上次导出时间
    await evaluate(cdp, `localStorage.removeItem('flowday.lastExportAt.v1')`);
    await go(cdp, '/settings');
    const emptyText = await evaluate(cdp, `document.querySelector('[data-fd-last-export]')?.textContent || ''`);
    await evaluate(cdp, `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('导出 JSON 备份')); if (b) b.click(); return true; })()`);
    await sleep(1500);
    const exportKey = await evaluate(cdp, `localStorage.getItem('flowday.lastExportAt.v1')`);
    const exportText = await evaluate(cdp, `document.querySelector('[data-fd-last-export]')?.textContent || ''`);
    const files = fs.readdirSync(DOWNLOAD_DIR).filter((f) => f.endsWith('.json'));
    record('S14 成功导出后记录并展示上次导出时间', emptyText.includes('尚无导出记录') && Boolean(exportKey) && exportText.includes('上次成功导出') && files.length > 0, `files=${files.length}`);

    // S15 导出失败不更新时间
    await evaluate(cdp, `localStorage.removeItem('flowday.lastExportAt.v1')`);
    await go(cdp, '/settings');
    await evaluate(cdp, `(() => { window.__ORIG_COO__ = URL.createObjectURL; URL.createObjectURL = () => { throw new Error('boom'); }; return true; })()`);
    await evaluate(cdp, `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('导出 JSON 备份')); if (b) b.click(); return true; })()`);
    await sleep(700);
    const failKey = await evaluate(cdp, `localStorage.getItem('flowday.lastExportAt.v1')`);
    const failToast = await evaluate(cdp, `(() => [...document.querySelectorAll('[data-fd-toast]')].map((x) => x.textContent).join(' '))()`);
    await evaluate(cdp, `(() => { URL.createObjectURL = window.__ORIG_COO__; return true; })()`);
    record('S15 导出失败不更新导出时间', failKey === null && failToast.includes('导出失败'), `key=${failKey}`);

    // S16 移动端预览弹窗适配
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await go(cdp, '/settings');
    await pickFile(cdp, f1);
    await waitUntil(() => evaluate(cdp, `Boolean(document.querySelector('[data-fd-import-preview]'))`));
    const mobileOverflow = await evaluate(cdp, `document.documentElement.scrollWidth > window.innerWidth + 1`);
    record('S16 移动端预览弹窗无横向溢出', !mobileOverflow, `overflow=${mobileOverflow}`);
    await closePreview(cdp);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  } finally {
    try { browser.child.kill(); } catch { /* ignore */ }
  }

  // S11 persist granted（模拟授权环境）
  const browserP = await launch(PORT_P, PROFILE_P, [
    `Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(true), persist: () => Promise.resolve(true), estimate: () => Promise.resolve({ usage: 0, quota: 0 }) } });`,
  ]);
  try {
    await go(browserP.cdp, '/settings');
    await sleep(400);
    const grantedChip = await evaluate(browserP.cdp, `document.querySelector('[data-fd-persist-state]')?.getAttribute('data-fd-persist-state') || null`);
    const grantedText = await evaluate(browserP.cdp, `document.querySelector('[data-fd-persist-state]')?.textContent || ''`);
    record('S11 persist 已授权状态展示', grantedChip === 'granted' && grantedText.includes('已授权'), grantedChip || '');
  } finally {
    try { browserP.child.kill(); } catch { /* ignore */ }
  }

  // S13 persist unsupported
  const browserU = await launch(PORT_U, PROFILE_U, [
    `Object.defineProperty(navigator, 'storage', { configurable: true, value: undefined });`,
  ]);
  try {
    await go(browserU.cdp, '/settings');
    await sleep(400);
    const unsupChip = await evaluate(browserU.cdp, `document.querySelector('[data-fd-persist-state]')?.getAttribute('data-fd-persist-state') || null`);
    const unsupBtn = await evaluate(browserU.cdp, `Boolean(document.querySelector('[data-fd-persist-request]'))`);
    record('S13 persist 不支持状态展示（无申请按钮）', unsupChip === 'unsupported' && !unsupBtn, unsupChip || '');
  } finally {
    try { browserU.child.kill(); } catch { /* ignore */ }
  }

  for (const d of [PROFILE, PROFILE_P, PROFILE_U]) {
    for (let i = 0; i < 8; i++) {
      try { fs.rmSync(d, { recursive: true, force: true }); break; } catch { await sleep(400); }
    }
  }
  fs.writeFileSync(path.join(OUT_DIR, 'backup-e2e-report.json'), JSON.stringify({ generatedAt: new Date().toISOString(), base: BASE, results }, null, 2), 'utf8');
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n备份专项 E2E 结果：${passed} 通过 / ${results.length - passed} 失败（共 ${results.length} 项）`);
  if (passed !== results.length) process.exitCode = 1;
}

main().catch((e) => { console.error('BACKUP E2E FAILED:', e); process.exitCode = 1; });
