// Chunked PDF render: print the big HTML in page ranges with Edge (headless),
// then merge the chunks with pdf-lib and stamp a consistent footer (page N / total).
// Usage: node render_pdf_chunked.mjs <input.html> <output.pdf>
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import * as pdfLibNS from 'pdf-lib';
import * as fontkitNS from '@pdf-lib/fontkit';

const pdfLib = pdfLibNS.default && pdfLibNS.default.PDFDocument ? pdfLibNS.default : pdfLibNS;
const fontkit = fontkitNS.default || fontkitNS;
const { PDFDocument, rgb } = pdfLib;

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const [, , htmlArg, pdfArg] = process.argv;
if (!htmlArg || !pdfArg) {
  console.error('usage: node render_pdf_chunked.mjs <input.html> <output.pdf>');
  process.exit(2);
}
const htmlPath = path.resolve(htmlArg);
const pdfPath = path.resolve(pdfArg);
const buildDir = path.dirname(htmlPath);
const chunkDir = path.join(buildDir, 'chunks');
const profileDir = path.join(buildDir, 'edge-profile');
const statusFile = path.join(buildDir, 'render-status.txt');
const CHUNK = Number(process.env.CHUNK || 16);
const port = 9337;
const MAX_PAGES = 600;
const CJK_FONT = 'C:\\Windows\\Fonts\\simhei.ttf';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function status(msg) {
  const line = new Date().toISOString() + ' ' + msg;
  fs.appendFileSync(statusFile, line + '\n');
  console.log(line);
}

function launchEdge() {
  return spawn(
    EDGE,
    [
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
    ],
    { stdio: 'ignore', windowsHide: true }
  );
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
  once(method, timeoutMs = 60000) {
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

const countPages = (buf) => (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;

async function printChunks() {
  fs.rmSync(chunkDir, { recursive: true, force: true });
  fs.mkdirSync(chunkDir, { recursive: true });
  const edge = launchEdge();
  let cdp = null;
  const chunkFiles = [];
  try {
    const version = await waitForDevtools();
    status('devtools ready: ' + version.Browser);
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
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    const loaded = cdp.once('Page.loadEventFired').catch(() => null);
    await cdp.send('Page.navigate', { url: pathToFileURL(htmlPath).href });
    await loaded;
    await sleep(500);
    await cdp.send('Runtime.evaluate', {
      expression: 'document.fonts && document.fonts.ready ? document.fonts.ready.then(() => true) : true',
      awaitPromise: true,
      returnByValue: true,
    });
    await sleep(600);
    status('navigated, printing chunks of ' + CHUNK);

    let total = 0;
    for (let start = 1; start <= MAX_PAGES; start += CHUNK) {
      const end = start + CHUNK - 1;
      const r = await cdp.send('Page.printToPDF', {
        printBackground: true,
        displayHeaderFooter: false,
        paperWidth: 8.27, // A4 210mm
        paperHeight: 11.69, // A4 297mm
        marginTop: 20 / 25.4,
        marginBottom: 18 / 25.4,
        marginLeft: 16 / 25.4,
        marginRight: 16 / 25.4,
        preferCSSPageSize: false,
        scale: 1,
        pageRanges: `${start}-${end}`,
      });
      const buf = Buffer.from(r.data, 'base64');
      const pages = countPages(buf);
      if (!pages) {
        status(`range ${start}-${end}: 0 pages -> end of document`);
        break;
      }
      const file = path.join(chunkDir, `chunk-${String(chunkFiles.length + 1).padStart(2, '0')}.pdf`);
      fs.writeFileSync(file, buf);
      chunkFiles.push(file);
      total += pages;
      status(`chunk ${chunkFiles.length}: pages ${start}-${start + pages - 1} (${pages}p, ${buf.length}b), total=${total}`);
      if (pages < CHUNK) break;
      if (total >= 500) break;
    }
    status('all chunks done, total pages=' + total);
    await cdp.send('Browser.close').catch(() => {});
    await sleep(400);
  } finally {
    try { edge.kill(); } catch {}
  }
  return chunkFiles;
}

async function mergeAndStamp(chunkFiles) {
  status('merging ' + chunkFiles.length + ' chunks');
  const merged = await PDFDocument.create();
  merged.registerFontkit(fontkit);
  for (const file of chunkFiles) {
    const src = await PDFDocument.load(fs.readFileSync(file), { ignoreEncryption: true });
    const copied = await merged.copyPages(src, src.getPageIndices());
    for (const p of copied) merged.addPage(p);
  }
  const fontBytes = fs.readFileSync(CJK_FONT);
  const cnFont = await merged.embedFont(fontBytes, { subset: true });
  merged.setTitle('FlowDay 完整方案 v1.0');
  merged.setAuthor('FlowDay 方案团队');
  merged.setSubject('AI 个人效率管理产品：产品需求、设计、技术架构、开发计划与商业模式');
  merged.setCreator('FlowDay plan build pipeline');
  merged.setProducer('FlowDay plan build pipeline');

  const pages = merged.getPages();
  const total = pages.length;
  pages.forEach((page, i) => {
    if (i === 0) return;
    const { width } = page.getSize();
    const size = 8;
    const gray = rgb(0.42, 0.40, 0.37);
    page.drawLine({
      start: { x: 45, y: 32 },
      end: { x: width - 45, y: 32 },
      thickness: 0.4,
      color: rgb(0.886, 0.855, 0.8),
    });
    page.drawText('FlowDay 完整方案 v1.0', { x: 45, y: 21, size, font: cnFont, color: gray });
    const label = `第 ${i + 1} / ${total} 页`;
    const w = cnFont.widthOfTextAtSize(label, size);
    page.drawText(label, { x: width - 45 - w, y: 21, size, font: cnFont, color: gray });
  });
  status('footer stamped, pages=' + total);
  const bytes = await merged.save({ useObjectStreams: true });
  fs.writeFileSync(pdfPath, bytes);
  status('pdf written bytes=' + bytes.length + ' pages=' + total);
  return total;
}

(async () => {
  if (!fs.existsSync(htmlPath)) throw new Error('html not found: ' + htmlPath);
  fs.mkdirSync(buildDir, { recursive: true });
  fs.rmSync(statusFile, { force: true });
  status('start chunked render');
  const chunkFiles = await printChunks();
  if (!chunkFiles.length) throw new Error('no chunks produced');
  const total = await mergeAndStamp(chunkFiles);
  console.log('DONE pages=' + total + ' file=' + pdfPath);
})().catch((e) => {
  status('FAILED: ' + e.message);
  console.error('RENDER FAILED:', e.message);
  process.exit(1);
});
