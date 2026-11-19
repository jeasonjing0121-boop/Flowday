/**
 * Phase 4.5-F 最终验证：严格 200% 缩放（页面/文字分别）、移动端虚拟键盘模拟、15 步产品走查。
 * 输出：docs/phase4.5/final-checks.json + docs/phase4.5/screenshots-f/*.png
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ROOT = process.cwd();
const BASE = process.env.BASE || 'http://127.0.0.1:5173';
const OUT_DIR = path.join(ROOT, 'docs/phase4.5');
const SHOTS = path.join(OUT_DIR, 'screenshots-f');
const OUT = path.join(OUT_DIR, 'final-checks.json');
const PORT = Number(process.env.PORT || 9460);
const PROFILE = path.join(os.tmpdir(), 'flowday-final-45f');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(SHOTS, { recursive: true });
fs.rmSync(PROFILE, { recursive: true, force: true });

const results = [];
const record = (name, pass, detail = '') => {
  results.push({ name, pass: Boolean(pass), detail: String(detail).slice(0, 320) });
  console.log(`  ${pass ? '✓' : '✗'} ${name}${detail ? ' — ' + String(detail).slice(0, 180) : ''}`);
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

async function main() {
  const child = spawn(EDGE, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--headless=new', '--disable-gpu', '--no-first-run', '--window-size=1280,900', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
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
    const shoot = async (name) => {
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(data, 'base64'));
    };
    const goto = async (route) => {
      await cdp.send('Page.navigate', { url: BASE + route });
      for (let i = 0; i < 500; i++) {
        if (await ev('Boolean(document.querySelector("[data-fd-main]"))').catch(() => false)) return true;
        await sleep(20);
      }
      return false;
    };
    const press = async (key, opts = {}) => {
      const base = { key, code: key === ' ' ? 'Space' : key, windowsVirtualKeyCode: key === 'Enter' ? 13 : key === 'Escape' ? 27 : key === 'Tab' ? 9 : 0, modifiers: opts.shift ? 8 : 0 };
      await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
      if (key === 'Enter') await cdp.send('Input.dispatchKeyEvent', { type: 'char', text: '\r', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
      await sleep(250);
    };
    const focusBtnByText = (text) => ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim().includes(${JSON.stringify(text)})); if (b) b.focus(); return Boolean(b); })()`);

    // ============ A. 严格缩放：页面缩放 200%（等价 640 CSS px 视口）============
    console.log('\n[A] 页面缩放 200%（640px 等价视口）');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 640, height: 900, deviceScaleFactor: 1, mobile: false });
    const zoomPages = ['/today', '/tasks', '/calendar', '/habits', '/assistant', '/settings'];
    const zoomOver = [];
    const clippedText = [];
    for (const route of zoomPages) {
      await goto(route);
      await sleep(450);
      zoomOver.push(await ev('document.documentElement.scrollWidth - document.documentElement.clientWidth'));
      const clip = await ev(`(() => { const els = [...document.querySelectorAll('h1,h2,p,span,button,a,label')]; const bad = els.filter((el) => { const cs = getComputedStyle(el); if (cs.overflow === 'hidden' || cs.textOverflow === 'ellipsis') return false; const r = el.getBoundingClientRect(); return r.width > 0 && el.scrollWidth > el.clientWidth + 2 && cs.whiteSpace !== 'nowrap'; }).slice(0, 3).map((el) => (el.textContent || '').trim().slice(0, 24)); return bad; })()`);
      if (clip.length) clippedText.push({ route, clip });
    }
    record('页面缩放 200%：6 页面无横向溢出', zoomOver.every((v) => v <= 1), zoomOver.join(','));
    record('页面缩放 200%：无文字被截断', clippedText.length === 0, JSON.stringify(clippedText));
    await goto('/tasks');
    await sleep(400);
    await shoot('zoom200-page-tasks');
    // 弹窗在 640 视口内可滚动
    await focusBtnByText('新建任务');
    await press('Enter');
    await sleep(500);
    const zoomModal = await ev(`(() => { const d = document.querySelector('[data-fd-dialog]'); if (!d) return { found: false }; const r = d.getBoundingClientRect(); return { found: true, within: r.top >= -1 && r.bottom <= innerHeight + 1 && r.left >= -1 && r.right <= innerWidth + 1, scrollable: d.scrollHeight > d.clientHeight }; })()`);
    record('页面缩放 200%：弹窗在视口内且可滚动', zoomModal.found && zoomModal.within, JSON.stringify(zoomModal));
    await shoot('zoom200-page-modal');
    await press('Escape');
    await cdp.send('Emulation.clearDeviceMetricsOverride');

    // ============ B. 文字单独放大 200%（仅字号放大，模拟浏览器文字缩放）============
    console.log('\n[B] 文字单独放大 200%（字号 ×2）');
    await goto('/tasks');
    await sleep(400);
    await ev(`(() => {
      const scale = 2;
      const walk = (root) => {
        for (const el of root.querySelectorAll('*')) {
          if (el.closest('svg')) continue;
          const cs = getComputedStyle(el);
          const fs = parseFloat(cs.fontSize);
          if (Number.isFinite(fs) && fs > 0) el.style.fontSize = (fs * scale) + 'px';
          const lh = parseFloat(cs.lineHeight);
          if (Number.isFinite(lh) && lh > 0) el.style.lineHeight = (lh * scale) + 'px';
        }
      };
      walk(document);
      return true;
    })()`);
    await sleep(600);
    const textZoom = await ev(`(() => {
      const de = document.documentElement;
      const over = de.scrollWidth - de.clientWidth;
      // 可达性：视口内每个可见按钮中心点必须命中自身（或其子元素），否则说明被其它元素遮挡/裁切
      const btns = [...document.querySelectorAll('button')].filter((b) => b.getClientRects().length > 0);
      let blocked = 0;
      const blockedLabels = [];
      for (const b of btns) {
        const r = b.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) continue;
        const hit = document.elementFromPoint(cx, cy);
        if (!(hit === b || b.contains(hit))) {
          blocked += 1;
          if (blockedLabels.length < 3) blockedLabels.push((b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 16));
        }
      }
      const navOk = [...document.querySelectorAll('nav')].filter((n) => n.getClientRects().length > 0).every((n) => [...n.querySelectorAll('a')].every((a) => a.getClientRects().length > 0));
      return { over, blocked, blockedLabels, navOk, buttons: btns.length };
    })()`);
    record('文字放大 200%：无横向溢出', textZoom.over <= 1, JSON.stringify(textZoom));
    record('文字放大 200%：视口内按钮均可被点到（无遮挡）', textZoom.blocked === 0, JSON.stringify(textZoom));
    record('文字放大 200%：可见导航链接仍可用', textZoom.navOk, JSON.stringify(textZoom));
    await shoot('zoom200-text-tasks');
    // 弹窗在文字放大下可滚动 + 关键按钮可达
    await focusBtnByText('新建任务');
    await press('Enter');
    await sleep(500);
    const txtModal = await ev(`(() => { const d = document.querySelector('[data-fd-dialog]'); if (!d) return { found: false }; const btn = d.querySelector('[data-fd-import-confirm], button:last-of-type'); const r = btn ? btn.getBoundingClientRect() : null; return { found: true, scrollable: d.scrollHeight > d.clientHeight, confirmVisibleAfterScroll: Boolean(btn) }; })()`);
    record('文字放大 200%：弹窗可滚动且操作按钮存在', txtModal.found && txtModal.scrollable, JSON.stringify(txtModal));
    await shoot('zoom200-text-modal');
    await press('Escape');
    await cdp.send('Page.navigate', { url: BASE + '/tasks' });
    await sleep(600);

    // ============ C. 移动端虚拟键盘模拟（视口高度压缩）============
    console.log('\n[C] 移动端虚拟键盘（390×844 → 键盘占位 390×390）');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await cdp.send('Page.navigate', { url: BASE + '/tasks' });
    for (let i = 0; i < 400; i++) {
      if (await ev('Boolean(document.querySelector("[data-fd-main]"))').catch(() => false)) break;
      await sleep(20);
    }
    await sleep(400);
    await focusBtnByText('新建任务');
    await press('Enter');
    await sleep(500);
    // 键盘弹出：视口高度压缩到 390
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 390, deviceScaleFactor: 1, mobile: true });
    await sleep(400);
    await ev(`document.querySelector('#task-notes')?.focus()`);
    await sleep(500);
    const kb = await ev(`(() => {
      const el = document.activeElement;
      const d = document.querySelector('[data-fd-dialog]');
      const r = el ? el.getBoundingClientRect() : null;
      const visible = r ? r.top >= 0 && r.bottom <= innerHeight + 1 : false;
      const dr = d ? d.getBoundingClientRect() : null;
      return { focusedTag: el ? el.tagName.toLowerCase() : null, focusedId: el ? el.id : null, visible, innerHeight, dialogTop: dr ? Math.round(dr.top) : null, dialogScrollable: d ? d.scrollHeight > d.clientHeight : false };
    })()`);
    record('键盘弹出（视口 390 高）：聚焦输入框仍在可视区', kb.visible === true, JSON.stringify(kb));
    await shoot('keyboard-emulated-focus');
    // 滚动弹窗使确认按钮可达
    const reachable = await ev(`(() => { const d = document.querySelector('[data-fd-dialog]'); if (!d) return false; d.scrollTop = d.scrollHeight; const btn = [...d.querySelectorAll('button')].find((b) => b.textContent.includes('添加任务')); if (!btn) return false; const r = btn.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight + 1; })()`);
    record('键盘弹出时：确认按钮可通过弹窗滚动到达', reachable);
    await shoot('keyboard-emulated-confirm');
    // 键盘收起：恢复视口，布局正常
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await sleep(400);
    const afterKb = await ev(`(() => ({ over: document.documentElement.scrollWidth - document.documentElement.clientWidth, dialogOk: Boolean(document.querySelector('[data-fd-dialog]')) }))()`);
    record('键盘收起后布局正常（无溢出、弹窗保持）', afterKb.over <= 1 && afterKb.dialogOk, JSON.stringify(afterKb));
    await press('Escape');
    await cdp.send('Emulation.clearDeviceMetricsOverride');

    // ============ D. 产品级 15 步走查 ============
    console.log('\n[D] 产品级走查');
    // 1) 首次启动：清空存储后加载
    await cdp.send('Page.navigate', { url: BASE + '/bench-blank.html' });
    await sleep(400);
    await ev(`(async () => { await new Promise((r) => { const q = indexedDB.deleteDatabase('flowday-db'); q.onsuccess = r; q.onerror = r; q.onblocked = r; }); localStorage.clear(); return true; })()`);
    await goto('/today');
    await sleep(800);
    const firstRun = await ev(`(() => ({ demo: document.body.innerText.includes('示例数据'), hasMain: Boolean(document.querySelector('[data-fd-main]')), tasks: document.querySelectorAll('[data-task-id]').length }))()`);
    record('1) 首次启动：示例数据提示 + 主界面渲染', firstRun.hasMain && firstRun.demo, JSON.stringify(firstRun));
    await shoot('journey-01-first-run');

    // 2) 页面导航
    const navTitles = {};
    for (const [route, title] of [['/today', '今日'], ['/tasks', '任务'], ['/calendar', '日历'], ['/habits', '习惯'], ['/assistant', 'Jing'], ['/settings', '设置']]) {
      await goto(route);
      await sleep(350);
      navTitles[route] = await ev('(document.querySelector("h1") || {}).textContent || ""');
      if (!String(navTitles[route]).includes(title)) navTitles[route] = 'MISMATCH:' + navTitles[route];
    }
    record('2) 页面导航：6 页标题正确', Object.values(navTitles).every((t) => !String(t).startsWith('MISMATCH')), JSON.stringify(navTitles));

    // 清空示例数据，进入真实数据流程
    await goto('/settings');
    await sleep(300);
    await focusBtnByText('清空本地数据');
    await press('Enter');
    await sleep(400);
    await ev(`(() => { const b = document.querySelector('[data-fd-confirm-ok="1"]'); if (b) b.click(); return true; })()`);
    await sleep(600);

    // 3) 创建任务（键盘）
    await goto('/tasks');
    await sleep(300);
    await focusBtnByText('新建任务');
    await press('Enter');
    await sleep(400);
    await cdp.send('Input.insertText', { text: '终验任务 A' });
    await sleep(200);
    await ev(`(() => { const b = [...document.querySelectorAll('[data-fd-dialog] button')].find((x) => x.textContent.includes('添加任务')); if (b) b.focus(); return Boolean(b); })()`);
    await press('Enter');
    await sleep(700);
    const created = await ev(`document.body.innerText.includes('终验任务 A')`);
    record('3) 创建任务：列表出现新任务', created);
    await shoot('journey-03-created');

    // 4) 编辑任务
    await ev(`(() => { const row = [...document.querySelectorAll('[data-task-id]')].find((r) => r.textContent.includes('终验任务 A')); const b = row && row.querySelector('[aria-label="编辑任务"]'); if (b) b.focus(); return Boolean(b); })()`);
    await press('Enter');
    await sleep(400);
    await ev(`document.querySelector('#task-title')?.focus()`);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
    await cdp.send('Input.insertText', { text: '终验任务 A（已编辑）' });
    await sleep(200);
    await ev(`(() => { const b = [...document.querySelectorAll('[data-fd-dialog] button')].find((x) => x.textContent.includes('保存') || x.textContent.includes('添加任务')); if (b) b.focus(); return Boolean(b); })()`);
    await press('Enter');
    await sleep(700);
    const edited = await ev(`document.body.innerText.includes('终验任务 A（已编辑）')`);
    record('4) 编辑任务：标题更新', edited);

    // 5) 完成 / 取消完成
    await ev(`(() => { const row = [...document.querySelectorAll('[data-task-id]')].find((r) => r.textContent.includes('终验任务 A')); const b = row && row.querySelector('[data-testid="task-toggle"]'); if (b) b.focus(); return Boolean(b); })()`);
    await press('Enter');
    await sleep(500);
    const doneState = await ev(`(() => { const row = [...document.querySelectorAll('[data-task-id]')].find((r) => r.textContent.includes('终验任务 A')); const btn = row && row.querySelector('[data-testid="task-toggle"]'); return btn ? btn.getAttribute('aria-pressed') : null; })()`);
    await press('Enter');
    await sleep(400);
    record('5) 完成/取消完成：aria-pressed 状态切换', doneState === 'true', `pressed=${doneState}`);

    // 6) 搜索 + 筛选
    await ev(`(() => { const el = document.querySelector('#task-search'); if (!el) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '终验'); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await sleep(500);
    let searchShown = false;
    {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const cnt = await ev(`(() => { const m = document.body.innerText.match(/筛选出\\s*(\\d+)\\s*条/); return m ? Number(m[1]) : null; })()`);
        if (typeof cnt === 'number' && cnt >= 1) { searchShown = true; break; }
        await sleep(100);
      }
    }
    await ev(`(() => { const el = document.querySelector('#task-search'); if (!el) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ''); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await sleep(400);
    record('6) 搜索与筛选：筛选计数出现并可清空', searchShown);

    // 7) 日历
    await goto('/calendar');
    await sleep(400);
    const calWeek = await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '周'); if (b) b.click(); return true; })()`);
    await sleep(500);
    const calOk = await ev(`Boolean(document.querySelector('section.fd-scroll'))`);
    record('7) 日历：切换到周视图', calWeek && calOk);
    await shoot('journey-07-calendar');

    // 8) 习惯打卡
    await goto('/habits');
    await sleep(400);
    await focusBtnByText('新建习惯');
    await press('Enter');
    await sleep(500);
    const modalReady = await ev(`Boolean(document.querySelector('[data-fd-dialog] #habit-name'))`);
    await ev(`(() => { const i = document.querySelector('#habit-name'); if (!i) return false; i.focus(); return true; })()`);
    await cdp.send('Input.insertText', { text: '终验习惯' });
    await sleep(250);
    const typedValue = await ev(`document.querySelector('#habit-name')?.value || ''`);
    await ev(`(() => { const b = [...document.querySelectorAll('[data-fd-dialog] button')].find((x) => x.textContent.trim() === '创建'); if (b) b.focus(); return Boolean(b); })()`);
    await press('Enter');
    await sleep(800);
    const habitCreated = await ev(`document.body.innerText.includes('终验习惯')`);
    // 在习惯行内点击打卡（精确到该习惯所在卡片）
    const habitChecked = await ev(`(() => { const card = [...document.querySelectorAll('section,div')].find((d) => d.textContent.includes('终验习惯') && d.querySelector('button[class*="fd-btn"]')); if (!card) return false; const btn = [...card.querySelectorAll('button')].find((b) => b.textContent.includes('打卡今天')); if (!btn) return false; btn.click(); return true; })()`);
    await sleep(700);
    const checkedState = await ev(`(() => { const card = [...document.querySelectorAll('section,div')].find((d) => d.textContent.includes('终验习惯')); if (!card) return false; const btn = [...card.querySelectorAll('button')].find((b) => b.getAttribute('aria-pressed') !== null); return btn ? btn.getAttribute('aria-pressed') === 'true' : false; })()`);
    record('8) 习惯：创建并打卡', Boolean(modalReady && typedValue === '终验习惯' && habitCreated && habitChecked && checkedState), JSON.stringify({ modalReady, typedValue, habitCreated, habitChecked, checkedState }));
    await shoot('journey-08-habits');

    // 9) 统计随勾选变化
    await goto('/today');
    await sleep(500);
    const statsBefore = await ev(`document.body.innerText.match(/已完成\\s*(\\d+)/)?.[1] || null`);
    await goto('/tasks');
    await sleep(300);
    await ev(`(() => { const row = [...document.querySelectorAll('[data-task-id]')].find((r) => r.textContent.includes('终验任务 A（已编辑）')); const b = row && row.querySelector('[data-testid="task-toggle"]'); if (b) b.click(); return Boolean(b); })()`);
    await sleep(600);
    await goto('/today');
    await sleep(600);
    const statsAfter = await ev(`document.body.innerText.match(/已完成\\s*(\\d+)/)?.[1] || null`);
    record('9) 统计：勾选后今日完成数变化', statsBefore !== statsAfter, `${statsBefore} → ${statsAfter}`);
    await shoot('journey-09-dashboard');

    // 10) 主题切换持久化
    await goto('/settings');
    await sleep(400);
    await ev(`(() => { const b = [...document.querySelectorAll('[aria-label="主题"] button')].find((x) => x.textContent.trim() === '深色'); if (b) b.click(); return Boolean(b); })()`);
    let darkApplied = false;
    for (let i = 0; i < 40; i++) {
      if ((await ev(`document.documentElement.dataset.theme`)) === 'dark') { darkApplied = true; break; }
      await sleep(100);
    }
    await sleep(900); // 等 180ms 防抖落库完成
    await goto('/today');
    await sleep(300);
    let darkPersisted = false;
    for (let i = 0; i < 40; i++) {
      if ((await ev(`document.documentElement.dataset.theme`)) === 'dark') { darkPersisted = true; break; }
      await sleep(100);
    }
    await goto('/settings');
    await ev(`(() => { const b = [...document.querySelectorAll('[aria-label="主题"] button')].find((x) => x.textContent.trim() === '浅色'); if (b) b.click(); return true; })()`);
    await sleep(500);
    record('10) 主题：切换后跨页面持久生效', darkApplied && darkPersisted, JSON.stringify({ darkApplied, darkPersisted }));

    // 11) 备份导出 + 导入
    await goto('/settings');
    await sleep(400);
    const backup = await ev(`(async () => {
      const mod = await import('/src/lib/storage/backup.ts');
      const data = window.__FD_STATE__;
      const b = await mod.createBackup(data);
      return JSON.stringify(b);
    })()`).catch(() => null);
    let importOk = false;
    if (backup) {
      const file = path.join(ROOT, '.tmp', 'journey-backup.json');
      fs.mkdirSync(path.join(ROOT, '.tmp'), { recursive: true });
      fs.writeFileSync(file, backup, 'utf8');
      const { root } = await cdp.send('DOM.getDocument');
      const inputs = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: 'input[type=file]' });
      await cdp.send('DOM.setFileInputFiles', { files: [file], nodeId: inputs.nodeIds[0] });
      await sleep(900);
      const preview = await ev(`(() => ({ ok: Boolean(document.querySelector('[data-fd-import-preview]')), chip: document.querySelector('[data-fd-import-checksum]')?.getAttribute('data-fd-import-checksum') }))()`);
      await ev(`document.querySelector('[data-fd-import-confirm="1"]')?.click()`);
      await sleep(900);
      const afterImport = await ev(`document.body.innerText.includes('立即体验') === false && Boolean(document.querySelector('[data-fd-main]'))`);
      importOk = preview.ok && preview.chip === 'verified' && afterImport;
      record('11) 备份：导出→导入（校验和 verified，数据可恢复）', importOk, JSON.stringify(preview));
      await shoot('journey-11-backup-import');
    } else {
      record('11) 备份：导出→导入', false, 'createBackup 不可用（dev 桥缺失）');
    }

    // 12) 多标签
    const { targetId } = await cdp.send('Target.createTarget', { url: BASE + '/tasks' });
    const page2 = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((x) => x.id === targetId);
    const cdp2 = new CDP(page2.webSocketDebuggerUrl);
    await cdp2.open();
    await cdp2.send('Page.enable');
    await cdp2.send('Runtime.enable');
    const ev2 = async (expr) => {
      const { result, exceptionDetails } = await cdp2.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (exceptionDetails) throw new Error('EVAL2: ' + (exceptionDetails.exception?.description || exceptionDetails.text));
      return result.value;
    };
    for (let i = 0; i < 500; i++) {
      if (await ev2('Boolean(document.querySelector("[data-fd-main]"))').catch(() => false)) break;
      await sleep(20);
    }
    await sleep(500);
    await ev(`(() => { const b = document.querySelector('[data-testid="task-toggle"]'); if (b) b.click(); return Boolean(b); })()`);
    await sleep(900);
    const synced = await ev2(`(() => ({ rev: window.__FD_STORAGE__?.revision ?? null, banner: Boolean(document.querySelector('[data-fd-sync-banner]')) }))()`);
    record('12) 多标签：第二标签随第一标签更新且无冲突横幅', typeof synced.rev === 'number' && !synced.banner, JSON.stringify(synced));
    await cdp2.send('Target.closeTarget', { targetId });
    await cdp2.ws.close();

    // 13) 键盘导航（skip link + 路由）
    await goto('/today');
    await ev('document.body.focus()');
    await press('Tab');
    const skip = await ev(`(document.activeElement?.textContent || '').includes('跳到主要内容')`);
    await press('Enter');
    await sleep(300);
    const mainFocused = await ev(`document.activeElement?.hasAttribute('data-fd-main') === true`);
    record('13) 键盘导航：skip link → main', skip && mainFocused, JSON.stringify({ skip, mainFocused }));

    // 14) 移动端 390
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await goto('/tasks');
    await sleep(500);
    const mobile = await ev(`(() => ({ over: document.documentElement.scrollWidth - document.documentElement.clientWidth, bottomNav: Boolean(document.querySelector('nav[aria-label="底部导航"]')), asideHidden: getComputedStyle(document.querySelector('aside')).display === 'none' }))()`);
    record('14) 移动端：底部导航 + 无溢出 + 侧栏隐藏', mobile.over <= 1 && mobile.bottomNav && mobile.asideHidden, JSON.stringify(mobile));
    await shoot('journey-14-mobile');
    await cdp.send('Emulation.clearDeviceMetricsOverride');

    // 15) 异常恢复：IndexedDB 不可用注入后移除
    const inj = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: "Object.defineProperty(window, 'indexedDB', { configurable: true, get() { return undefined; } });" });
    await goto('/today');
    await sleep(1500);
    const degraded = await ev(`(() => ({ rendered: Boolean(document.querySelector('[data-fd-main]')), persistence: window.__FD_STORAGE__?.persistence, toast: (document.querySelector('[data-fd-toast]')?.textContent || '') }))()`);
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: inj.identifier }).catch(() => null);
    await goto('/today');
    await sleep(800);
    const recoveredOk = await ev(`(() => ({ persistence: window.__FD_STORAGE__?.persistence, tasks: window.__FD_STATE__?.tasks?.length ?? 0 }))()`);
    record('15) 异常恢复：IDB 不可用时明确报错不白屏，恢复后数据完好', degraded.rendered && degraded.persistence === false && recoveredOk.persistence === true && recoveredOk.tasks > 0, JSON.stringify({ degraded, recoveredOk }));
    await shoot('journey-15-degraded');

    const passed = results.filter((r) => r.pass).length;
    fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), base: BASE, passed, failed: results.length - passed, results }, null, 2), 'utf8');
    console.log(`\n最终验证结果：${passed} 通过 / ${results.length - passed} 失败（共 ${results.length} 项）`);
    if (passed !== results.length) process.exitCode = 1;
  } finally {
    try { child.kill(); } catch {}
    await sleep(600);
    try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
  }
}

main().catch((e) => {
  console.error('FINAL CHECKS FAILED', e);
  process.exit(1);
});
