/**
 * 4.5-C 补充核验：项目标签/分类选择器的深色截图（无独立项目页，记录实际结构）。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT = path.join(process.cwd(), 'docs/phase4.5/screenshots-c/responsive');
const PROFILE = path.join(os.tmpdir(), 'flowday-shots-proj-dark');
const PORT = 9400;
const BASE = process.env.BASE || 'http://127.0.0.1:5173';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });
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
      this.ws.addEventListener('error', () => rej(new Error('ws')), { once: true });
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
const ev = async (cdp, expression) => {
  const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (exceptionDetails) throw new Error('EVAL: ' + (exceptionDetails.exception?.description || exceptionDetails.text));
  return result.value;
};
async function go(cdp, route) {
  await cdp.send('Page.navigate', { url: BASE + route });
  for (let i = 0; i < 100; i++) {
    if ((await ev(cdp, 'location.pathname').catch(() => '')) === route) break;
    await sleep(50);
  }
  for (let i = 0; i < 100; i++) {
    if (await ev(cdp, 'Boolean(window.__FD_STORAGE__ && window.__FD_STORAGE__.ready)')) return;
    await sleep(60);
  }
  throw new Error('not ready ' + route);
}
async function shot(cdp, name) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(data, 'base64'));
  console.log('shot ' + name);
}
async function main() {
  const child = spawn(EDGE, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--headless=new', '--disable-gpu', '--no-first-run', '--window-size=1280,900', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  try {
    for (let i = 0; i < 100; i++) {
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
    await go(cdp, '/settings');
    await ev(cdp, `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '深色'); if (b) b.click(); return true; })()`);
    for (let i = 0; i < 50; i++) {
      if (await ev(cdp, `document.documentElement.dataset.theme === 'dark'`)) break;
      await sleep(60);
    }
    await sleep(400);
    await go(cdp, '/tasks');
    await sleep(500);
    await shot(cdp, '1280-dark-tasks-project-chips');
    await ev(cdp, `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('新建任务')); if (b) b.click(); return true; })()`);
    await sleep(700);
    await shot(cdp, '1280-dark-modal-project-select');
    console.log('DONE');
  } finally {
    try { child.kill(); } catch {}
    await sleep(500);
    try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
  }
}
main().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
