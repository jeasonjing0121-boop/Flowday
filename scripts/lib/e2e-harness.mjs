// FlowDay Phase 5.0-a：E2E 共享工具（Edge headless + 原生 CDP，无第三方依赖）
// 既有 4 套 E2E 保持不变；本文件只服务 Phase 5.0-a 新增的专项套件。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
export const DEFAULT_BASE = process.env.BASE || 'http://127.0.0.1:5173';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const wait = sleep;

export function startBrowser({ port = 9500, profileTag = 'fd-e2e-5a' } = {}) {
  const profile = path.join(os.tmpdir(), `${profileTag}-${port}-${Date.now()}`);
  const proc = spawn(
    EDGE,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-features=Translate,MediaRouter',
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${port}`,
      'about:blank',
    ],
    { stdio: 'ignore', windowsHide: true }
  );
  return { proc, port, profile };
}

export async function stopBrowser(browser) {
  try {
    browser.proc.kill();
  } catch {
    /* ignore */
  }
  await sleep(300);
}

async function httpJson(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

export async function waitForBrowser(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return await httpJson(`http://127.0.0.1:${port}/json/version`);
    } catch {
      await sleep(200);
    }
  }
  throw new Error('Edge DevTools 未就绪');
}

export class CDP {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
        return;
      }
      const arr = this.listeners.get(msg.method) || [];
      for (const fn of arr) fn(msg.params);
    });
  }

  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error('CDP ws error')), { once: true });
    });
    const cdp = new CDP(ws);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    return cdp;
  }

  send(method, params = {}) {
    const id = ++this.seq;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 20000);
    });
  }

  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }

  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails) {
      throw new Error(`evaluate 失败: ${res.exceptionDetails.text} ${res.exceptionDetails.exception?.description ?? ''}`);
    }
    return res.result?.value;
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}

/** 打开一个新标签页并连接 CDP。 */
export async function openTab(port, url) {
  const target = await httpJson(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  const cdp = await CDP.connect(target.webSocketDebuggerUrl);
  return { cdp, target };
}

export async function navigate(cdp, url, { waitMs = 400 } = {}) {
  await cdp.send('Page.navigate', { url });
  await sleep(waitMs);
  await waitFor(cdp, 'document.readyState === "complete"', 15000);
}

/** 轮询表达式直到为真；返回最后一次结果。 */
export async function waitFor(cdp, expression, timeoutMs = 8000, label = '') {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await cdp.evaluate(expression);
      if (last) return last;
    } catch {
      /* 页面切换期间 evaluate 可能失败，继续轮询 */
    }
    await sleep(120);
  }
  throw new Error(`等待超时${label ? `：${label}` : ''}（${expression}）`);
}

/** 将指定 AppData 直接写入 IndexedDB 并同步 revision，然后刷新页面（确定性测试用）。 */
export async function seedAppState(cdp, data, revision = 1) {
  const payload = JSON.stringify(data);
  const ok = await cdp.evaluate(`(async () => {
    const data = ${payload};
    const rev = ${revision};
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('flowday-db', 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('app')) d.createObjectStore('app');
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['app', 'meta'], 'readwrite');
      tx.objectStore('app').put({ schemaVersion: 2, updatedAt: new Date().toISOString(), revision: rev, writerId: 'e2e-seed', data }, 'state');
      tx.objectStore('meta').put({ revision: rev, updatedAt: new Date().toISOString(), writerId: 'e2e-seed' }, 'sync:v1');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    localStorage.clear();
    return true;
  })()`);
  if (!ok) throw new Error('seedAppState 失败');
}

/** 读取当前持久化记录（用于断言「未被写入/覆盖」）。 */
export async function readStoredState(cdp) {
  return cdp.evaluate(`(async () => {
    const db = await new Promise((resolve) => {
      const req = indexedDB.open('flowday-db', 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
    if (!db) return null;
    const record = await new Promise((resolve) => {
      const tx = db.transaction('app', 'readonly');
      const r = tx.objectStore('app').get('state');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(null);
    });
    db.close();
    return record || null;
  })()`);
}

/** 截图（证据留存到 .tmp，不污染工作区）。 */
export async function screenshot(cdp, outDir, name) {
  const res = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(res.data, 'base64'));
  return file;
}

export function setViewport(cdp, width, height, mobile = false) {
  return cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile,
  });
}

/** 极简断言运行器：输出 ✓/✗、失败详情，并返回退出码。 */
export function makeRunner(title) {
  const results = [];
  let failed = 0;
  console.log(`\n=== ${title} ===`);
  return {
    check(name, condition, detail = '') {
      const pass = Boolean(condition);
      if (!pass) failed += 1;
      results.push({ name, pass, detail });
      console.log(`  ${pass ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
      return pass;
    },
    eq(name, actual, expected) {
      const pass = JSON.stringify(actual) === JSON.stringify(expected);
      if (!pass) failed += 1;
      results.push({ name, pass, detail: pass ? '' : `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}` });
      console.log(`  ${pass ? '✓' : '✗'} ${name}${pass ? '' : `（期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}）`}`);
      return pass;
    },
    get failed() {
      return failed;
    },
    summary(extra = {}) {
      console.log(`\n结果：${results.filter((r) => r.pass).length} 通过 / ${failed} 失败（共 ${results.length} 项）`);
      return { title, passed: results.filter((r) => r.pass).length, failed, total: results.length, results, ...extra };
    },
    writeReport(reportDir, extra = {}) {
      const report = this.summary(extra);
      fs.mkdirSync(reportDir, { recursive: true });
      const file = path.join(reportDir, `${title.replace(/[^\w\u4e00-\u9fa5-]+/g, '_')}.json`);
      fs.writeFileSync(file, JSON.stringify({ generatedAt: new Date().toISOString(), ...report }, null, 2));
      console.log('报告：', file);
      return report;
    },
  };
}

/** 断言页面中不存在指定选择器（用于安全断言）。 */
export async function exists(cdp, selector) {
  return cdp.evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
}

export async function textOf(cdp, selector) {
  return cdp.evaluate(`(document.querySelector(${JSON.stringify(selector)})||{}).textContent || ''`);
}

export async function click(cdp, selector) {
  const ok = await cdp.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.click();
    return true;
  })()`);
  if (!ok) throw new Error(`找不到可点击元素：${selector}`);
  await sleep(120);
}

export async function setInput(cdp, selector, value) {
  const ok = await cdp.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  if (!ok) throw new Error(`找不到输入框：${selector}`);
  await sleep(80);
}
