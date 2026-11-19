// Render the print HTML to PDF with Microsoft Edge (headless) via CDP.
// Usage: node render_pdf.mjs <input.html> <output.pdf> [screenshot-dir]
// Requires: Windows + Edge installed. Uses Chromium DevTools Protocol over WebSocket.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const [, , htmlArg, pdfArg, shotsArg] = process.argv;
if (!htmlArg || !pdfArg) {
  console.error('usage: node render_pdf.mjs <input.html> <output.pdf> [screenshot-dir]');
  process.exit(2);
}
const htmlPath = path.resolve(htmlArg);
const pdfPath = path.resolve(pdfArg);
const shotDir = shotsArg ? path.resolve(shotsArg) : null;
const buildDir = path.dirname(htmlPath);
const profileDir = path.join(buildDir, 'edge-profile');
const port = 9337;
const RANGES = process.env.RANGES || '';
const NO_BG = process.env.NOBG === '1';
const NO_FOOTER = process.env.NOFOOTER === '1';
const PRINT_TIMEOUT_MS = Number(process.env.PRINT_TIMEOUT_MS || 480000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function launchEdge() {
  const args = [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--disable-default-apps',
    '--mute-audio',
    '--user-data-dir=' + profileDir,
    '--remote-debugging-port=' + port,
    'about:blank',
  ];
  return spawn(EDGE, args, { stdio: 'ignore', windowsHide: true });
}

async function waitForDevtools(timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return await res.json();
      lastErr = new Error('status ' + res.status);
    } catch (e) {
      lastErr = e;
    }
    await sleep(300);
  }
  throw new Error('devtools endpoint not ready: ' + (lastErr && lastErr.message));
}

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
    this.ws.addEventListener('close', () => {
      for (const [, p] of this.pending) p.reject(new Error('ws closed (browser crashed)'));
      this.pending.clear();
    });
    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || 'cdp error'));
        else resolve(msg.result);
      } else if (msg.method) {
        const arr = this.listeners.get(msg.method) || [];
        for (const fn of arr) fn(msg.params);
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
  once(method, timeoutMs = 45000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout waiting ' + method)), timeoutMs);
      const fn = (params) => {
        clearTimeout(timer);
        const arr = this.listeners.get(method) || [];
        this.listeners.set(method, arr.filter((x) => x !== fn));
        resolve(params);
      };
      const arr = this.listeners.get(method) || [];
      arr.push(fn);
      this.listeners.set(method, arr);
    });
  }
}

const FOOTER = `<table style="width:100%;border:0;font-family:'Microsoft YaHei',sans-serif;font-size:9px;color:#8D887F;"><tr>
<td style="text-align:left;padding-left:16mm;">FlowDay 完整方案 v1.0</td>
<td style="text-align:right;padding-right:16mm;">第 <span class="pageNumber"></span> / <span class="totalPages"></span> 页</td>
</tr></table>`;

(async () => {
  if (!fs.existsSync(htmlPath)) throw new Error('html not found: ' + htmlPath);
  fs.mkdirSync(path.dirname(pdfPath), { recursive: true });
  if (shotDir) fs.mkdirSync(shotDir, { recursive: true });
  const statusFile = path.join(buildDir, 'render-status.txt');
  const status = (s) => {
    const line = new Date().toISOString() + ' ' + s;
    fs.writeFileSync(statusFile, line + '\n', { flag: 'a' });
    console.log(line);
  };
  status('start');

  const edge = launchEdge();
  let cdp = null;
  try {
    const version = await waitForDevtools();
    status('devtools ready: ' + version.Browser);

    // find/create a page target
    let targets = [];
    for (let i = 0; i < 20; i++) {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      targets = await res.json();
      if (targets.some((t) => t.type === 'page' && t.webSocketDebuggerUrl)) break;
      await sleep(300);
    }
    const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (!page) throw new Error('no page target');

    cdp = new CDP(page.webSocketDebuggerUrl);
    await cdp.open();
    status('cdp connected');
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    const url = pathToFileURL(htmlPath).href;
    const loaded = cdp.once('Page.loadEventFired').catch(() => null);
    await cdp.send('Page.navigate', { url });
    await loaded;
    await sleep(500);
    status('navigated');
    await cdp.send('Runtime.evaluate', {
      expression: 'document.fonts && document.fonts.ready ? document.fonts.ready.then(() => true) : true',
      awaitPromise: true,
      returnByValue: true,
    });
    await sleep(700);
    status('fonts ready');

    if (shotDir) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 794,
        height: 1123,
        deviceScaleFactor: 1.4,
        mobile: false,
      });
      const shots = [
        ['01-cover', 'top'],
        ['02-toc', 'toc'],
        ['03-prd', 'doc-1'],
        ['04-architecture', 'doc-3'],
      ];
      for (const [name, anchor] of shots) {
        await cdp.send('Runtime.evaluate', {
          expression: `(function(){var el=document.getElementById('${anchor}'); if(el){el.scrollIntoView();} else {window.scrollTo(0,0);} return true;})()`,
          returnByValue: true,
        });
        await sleep(400);
        const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(shotDir, name + '.png'), Buffer.from(shot.data, 'base64'));
        console.log('shot:', name + '.png');
      }
      await cdp.send('Emulation.clearDeviceMetricsOverride');
    }

    status('printing...');
    const printPromise = cdp.send('Page.printToPDF', {
      printBackground: !NO_BG,
      displayHeaderFooter: !NO_FOOTER,
      headerTemplate: '<div style="font-size:0"></div>',
      footerTemplate: FOOTER,
      margin: { top: '20mm', bottom: '18mm', left: '16mm', right: '16mm' },
      preferCSSPageSize: false,
      format: 'A4',
      scale: 1,
      ...(RANGES ? { pageRanges: RANGES } : {}),
    });
    const result = await Promise.race([
      printPromise,
      sleep(PRINT_TIMEOUT_MS).then(() => {
        throw new Error('printToPDF timeout (15min)');
      }),
    ]);
    status('printToPDF returned');
    const buf = Buffer.from(result.data, 'base64');
    fs.writeFileSync(pdfPath, buf);
    const pages = (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
    status('pdf written bytes=' + buf.length + ' pages~' + pages);
    await cdp.send('Browser.close').catch(() => {});
    await sleep(400);
  } finally {
    try { edge.kill(); } catch {}
  }
})().catch((e) => {
  console.error('RENDER FAILED:', e.message);
  process.exit(1);
});
