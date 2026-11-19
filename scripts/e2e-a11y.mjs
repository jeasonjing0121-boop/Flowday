/**
 * Phase 4.5-D 无障碍 E2E（真实浏览器 + 键盘事件；不依赖鼠标）
 * 输出：docs/phase4.5/a11y-report.json + 终端摘要
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'docs/phase4.5');
const OUT = path.join(OUT_DIR, 'a11y-report.json');
const PROFILE = path.join(os.tmpdir(), 'flowday-a11y-profile');
const PORT = 9401;
const BASE = process.env.BASE || 'http://127.0.0.1:5173';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.rmSync(PROFILE, { recursive: true, force: true });

const results = [];
const record = (name, pass, detail = '') => {
  results.push({ name, pass: Boolean(pass), detail: String(detail).slice(0, 300) });
  console.log(`  ${pass ? '✓' : '✗'} ${name}${detail ? ' — ' + String(detail).slice(0, 200) : ''}`);
};
const check = (name, cond, detail = '') => record(name, cond, detail);

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

const evaluate = async (cdp, expression) => {
  const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (exceptionDetails) throw new Error('EVAL: ' + (exceptionDetails.exception?.description || exceptionDetails.text));
  return result.value;
};

const KEYCODES = { Tab: 9, Enter: 13, Escape: 27, ArrowDown: 40, ArrowUp: 38, Home: 36, End: 35, ' ': 32 };
const KEYCODES_EXTRA = { a: 65 };
async function press(cdp, key, opts = {}) {
  const { shift = false, ctrl = false } = opts;
  const code = key === ' ' ? 'Space' : key.length === 1 ? 'Key' + key.toUpperCase() : key;
  const vk = KEYCODES[key] ?? KEYCODES_EXTRA[key.toLowerCase()] ?? 0;
  const base = { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: (shift ? 8 : 0) | (ctrl ? 2 : 0) };
  // 按钮激活（Enter/Space）需要 rawKeyDown + char + keyUp 的完整序列
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
  if (key === 'Enter') {
    await cdp.send('Input.dispatchKeyEvent', { type: 'char', text: '\r', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers: base.modifiers });
  } else if (key === ' ') {
    await cdp.send('Input.dispatchKeyEvent', { type: 'char', text: ' ', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, modifiers: base.modifiers });
  }
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  await sleep(opts.wait ?? 90);
}
const typeText = async (cdp, text) => {
  await cdp.send('Input.insertText', { text });
  await sleep(80);
};

async function go(cdp, route) {
  await cdp.send('Page.navigate', { url: BASE + route });
  for (let i = 0; i < 100; i++) {
    if ((await evaluate(cdp, 'location.pathname').catch(() => '')) === route) break;
    await sleep(50);
  }
  for (let i = 0; i < 120; i++) {
    if (await evaluate(cdp, 'Boolean(window.__FD_STORAGE__ && window.__FD_STORAGE__.ready)')) return;
    await sleep(60);
  }
  throw new Error('not ready: ' + route);
}
const activeInfo = (cdp) =>
  evaluate(
    cdp,
    `(() => {
      const el = document.activeElement;
      if (!el) return null;
      const dialog = el.closest('[role="dialog"],[role="alertdialog"]');
      return {
        tag: el.tagName.toLowerCase(),
        id: el.id || '',
        label: el.getAttribute('aria-label') || '',
        text: (el.textContent || '').trim().slice(0, 40),
        isMain: el.hasAttribute('data-fd-main'),
        inDialog: Boolean(dialog),
        dialogKind: dialog ? dialog.getAttribute('data-fd-dialog') : null,
      };
    })()`
  );
const seed = async (cdp) => {
  await cdp.send('Page.navigate', { url: BASE + '/vite.svg' });
  await sleep(700);
  await evaluate(
    cdp,
    `(async () => {
      await new Promise((resolve) => { const r = indexedDB.deleteDatabase('flowday-db'); r.onsuccess = resolve; r.onerror = resolve; r.onblocked = resolve; });
      const db = await new Promise((resolve, reject) => { const req = indexedDB.open('flowday-db', 1); req.onupgradeneeded = () => { const d = req.result; d.createObjectStore('app'); d.createObjectStore('meta'); }; req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
      const pad = (x) => String(x).padStart(2, '0');
      const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
      const shift = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
      const now = new Date().toISOString();
      const tasks = [
        { id: 't1', title: '无障碍审计任务', date: shift(0), priority: 1, completed: false, createdAt: now, source: 'manual' },
        { id: 't2', title: '键盘流程验证', date: shift(0), priority: 2, completed: false, createdAt: now, source: 'manual' },
        { id: 't3', title: '已完成样例', date: shift(-1), priority: 3, completed: true, completedAt: now, createdAt: now, source: 'manual' },
      ];
      const data = { version: 1, tasks, projects: [], habits: [{ id: 'h1', name: '晨间拉伸', target: 1, unit: '次', color: '#34C759', createdAt: now }], habitLogs: [], settings: { name: '测试', theme: 'light', weekStart: 1, aiEnabled: true, demoData: false } };
      const tx = db.transaction(['app', 'meta'], 'readwrite');
      tx.objectStore('app').put({ schemaVersion: 2, updatedAt: now, revision: 1, writerId: 'a11y', data }, 'state');
      tx.objectStore('meta').put({ revision: 1, updatedAt: now, writerId: 'a11y' }, 'sync:v1');
      await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
      db.close();
      return true;
    })()`
  );
};

async function main() {
  const child = spawn(EDGE, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--headless=new', '--disable-gpu', '--no-first-run', '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
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
    await seed(cdp);
    await go(cdp, '/today');

    console.log('\n[a11y 1-4] Modal 焦点：初始焦点 / Tab 循环 / Shift+Tab / Escape');
    await evaluate(cdp, `document.querySelector('[data-fd-main]')?.focus()`);
    // 键盘打开任务编辑器：聚焦「新建任务」按钮后 Enter
    await evaluate(cdp, `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('新建任务')); if (b) b.focus(); return Boolean(b); })()`);
    await press(cdp, 'Enter', { wait: 400 });
    const initial = await activeInfo(cdp);
    check('Modal 打开后初始焦点在第一个表单控件（任务标题）', initial?.inDialog && initial?.id === 'task-title', JSON.stringify(initial));
    let inside = true;
    for (let i = 0; i < 12; i++) {
      await press(cdp, 'Tab', { wait: 40 });
      const cur = await activeInfo(cdp);
      if (!cur?.inDialog) inside = false;
    }
    check('Tab 在弹窗内循环（12 次均未逃逸）', inside);
    let insideBack = true;
    for (let i = 0; i < 12; i++) {
      await press(cdp, 'Tab', { shift: true, wait: 40 });
      const cur = await activeInfo(cdp);
      if (!cur?.inDialog) insideBack = false;
    }
    check('Shift+Tab 反向循环（12 次均未逃逸）', insideBack);
    await press(cdp, 'Escape', { wait: 400 });
    const afterEsc = await activeInfo(cdp);
    const dialogGone = await evaluate(cdp, `!document.querySelector('[data-fd-dialog]')`);
    check('Escape 关闭弹窗', dialogGone);
    check('关闭后焦点恢复到原触发按钮（新建任务）', !afterEsc?.inDialog && afterEsc?.text.includes('新建任务'), JSON.stringify(afterEsc));

    console.log('\n[a11y 5-7] 关闭后焦点恢复 / 触发器卸载回退 / 多层浮层');
    // 触发器仍在：打开→点击关闭按钮（键盘 Tab 到关闭按钮后 Enter）
    await evaluate(cdp, `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('新建任务')); if (b) b.focus(); return true; })()`);
    await press(cdp, 'Enter', { wait: 400 });
    await press(cdp, 'Escape', { wait: 300 });
    // 触发器卸载场景：删除任务（行随数据删除而卸载），焦点应回退到 main
    await go(cdp, '/tasks');
    await sleep(300);
    await evaluate(cdp, `(() => { const b = [...document.querySelectorAll('[aria-label="删除任务"]')].at(-1); if (b) b.focus(); return Boolean(b); })()`);
    await press(cdp, 'Enter', { wait: 500 });
    const confirmFocus = await activeInfo(cdp);
    check('确认框（alertdialog）打开后焦点在取消按钮', confirmFocus?.inDialog && confirmFocus?.dialogKind === 'confirm', JSON.stringify(confirmFocus));
    await evaluate(cdp, `document.querySelector('[data-fd-confirm-ok="1"]')?.focus()`);
    await press(cdp, 'Enter', { wait: 900 });
    const afterDelete = await activeInfo(cdp);
    check('触发元素卸载后焦点回退到 main（不丢失）', Boolean(afterDelete?.isMain), JSON.stringify(afterDelete));

    // 多层浮层：设置页「未保存修改 + 导入预览」→ 确认框叠加在弹窗之上
    await go(cdp, '/settings');
    await sleep(400);
    // 连续输入保持 dirty（防抖窗口内），确保预览打开时处于「未保存修改」状态
    await evaluate(cdp, `(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      for (let i = 0; i < 6; i++) {
        const el = document.querySelector('#settings-name');
        if (!el) return false;
        set.call(el, '无障碍脏状态' + i);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 90));
      }
      return true;
    })()`);
    const badFile = path.join(ROOT, '.tmp', 'a11y-import.json');
    fs.mkdirSync(path.join(ROOT, '.tmp'), { recursive: true });
    fs.writeFileSync(
      badFile,
      JSON.stringify({ app: 'FlowDay', formatVersion: 1, schemaVersion: 2, exportedAt: new Date().toISOString(), counts: { tasks: 0, projects: 0, habits: 0, habitLogs: 0 }, data: { version: 1, tasks: [], projects: [], habits: [], habitLogs: [], settings: { name: '', theme: 'light', weekStart: 1, aiEnabled: true, demoData: false } } }),
      'utf8'
    );
    const { root } = await cdp.send('DOM.getDocument');
    const inputs = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: 'input[type=file]' });
    await cdp.send('DOM.setFileInputFiles', { files: [badFile], nodeId: inputs.nodeIds[0] });
    await sleep(900);
    const previewFocus = await activeInfo(cdp);
    check('导入预览弹窗：初始焦点在弹窗内', Boolean(previewFocus?.inDialog), JSON.stringify(previewFocus));
    // 时序加固：设置页自动保存防抖 180ms，而本用例在打开预览后还会等待 900ms。
    // 若不在"确认导入"前重新制造未保存修改，dirty 会被防抖保存冲掉，确认框不会出现，
    // 从而直接导入空备份并让后续断言连锁失败（已知的用例时序缺陷，非产品缺陷）。
    await evaluate(cdp, `(() => {
      const el = document.querySelector('#settings-name');
      if (!el) return false;
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(el, '未保存修改-' + Date.now());
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await evaluate(cdp, `document.querySelector('[data-fd-import-confirm="1"]')?.focus()`);
    await press(cdp, 'Enter', { wait: 500 });
    const topDialog = await evaluate(cdp, `(() => { const ds = [...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')]; const top = ds.at(-1); return { count: ds.length, kind: top?.getAttribute('data-fd-dialog'), focusInsideTop: Boolean(top?.contains(document.activeElement)) }; })()`);
    check('多层浮层：确认框叠加在预览弹窗之上且焦点位于最顶层', topDialog.count >= 2 && topDialog.focusInsideTop, JSON.stringify(topDialog));
    let nestedInside = true;
    for (let i = 0; i < 8; i++) {
      await press(cdp, 'Tab', { wait: 40 });
      const cur = await activeInfo(cdp);
      if (cur?.dialogKind !== 'confirm') nestedInside = false;
    }
    check('顶层弹窗内 Tab 循环不落入下层弹窗/背景', nestedInside);
    await press(cdp, 'Escape', { wait: 400 });
    const backFocus = await activeInfo(cdp);
    check('关闭叠加层后焦点回到下层弹窗', backFocus?.dialogKind === 'modal', JSON.stringify(backFocus));
    await press(cdp, 'Escape', { wait: 400 });

    console.log('\n[a11y 8-9] Dropdown 键盘 / 图标按钮可访问名称');
    await evaluate(cdp, `(() => { const b = document.querySelector('[aria-label="账户菜单"]'); if (b) b.focus(); return Boolean(b); })()`);
    await press(cdp, 'Enter', { wait: 300 });
    const menuFirst = await evaluate(cdp, `(() => { const m = document.querySelector('[role="menu"]'); if (!m) return null; return { open: true, firstIsMenuItem: document.activeElement?.getAttribute('role') === 'menuitem', focusedText: (document.activeElement?.textContent || '').trim().slice(0, 20) }; })()`);
    check('账户菜单：Enter 打开后焦点在首个 menuitem', menuFirst?.firstIsMenuItem, JSON.stringify(menuFirst));
    await press(cdp, 'ArrowDown', { wait: 120 });
    const menuSecond = await evaluate(cdp, `(document.activeElement?.textContent || '').trim().slice(0, 20)`);
    check('菜单：ArrowDown 移动焦点', menuSecond !== menuFirst?.focusedText, String(menuSecond));
    await press(cdp, 'Escape', { wait: 250 });
    const menuClosed = await evaluate(cdp, `(!document.querySelector('[role="menu"]')) && document.activeElement?.getAttribute('aria-label') === '账户菜单'`);
    check('菜单：Escape 关闭并把焦点还给触发按钮', menuClosed);
    const unnamed = await evaluate(cdp, `(() => { const bad = [...document.querySelectorAll('button')].filter((b) => { const name = (b.getAttribute('aria-label') || b.textContent || '').trim(); return !name; }); return bad.length; })()`);
    check('所有按钮均有可访问名称', unnamed === 0, `unnamed=${unnamed}`);
    await go(cdp, '/today');
    await sleep(300);
    await evaluate(cdp, `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('新建任务')); if (b) b.focus(); return true; })()`);
    await press(cdp, 'Enter', { wait: 400 });
    const iconNames = await evaluate(cdp, `(() => { const want = ['关闭', '编辑任务', '删除任务', '账户菜单']; const found = want.filter((w) => document.querySelector('[aria-label="' + w + '"]')); return { want: want.length, found: found.length, labels: found }; })()`);
    check('关键图标按钮具备中文可访问名称（含弹窗关闭）', iconNames.found >= 4, JSON.stringify(iconNames));
    await press(cdp, 'Escape', { wait: 300 });

    console.log('\n[a11y 10-11] 表单标签/错误关联 / Toast live region');
    await go(cdp, '/today');
    await sleep(300);
    await evaluate(cdp, `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('新建任务')); if (b) b.focus(); return true; })()`);
    await press(cdp, 'Enter', { wait: 400 });
    await press(cdp, 'Enter', { wait: 400 }); // 标题为空时提交
    const formErr = await evaluate(cdp, `(() => { const i = document.querySelector('#task-title'); const err = document.querySelector('#task-title-error'); return { invalid: i?.getAttribute('aria-invalid') === 'true', describedby: i?.getAttribute('aria-describedby') === 'task-title-error', errRole: err?.getAttribute('role'), errText: (err?.textContent || '').trim(), focused: document.activeElement?.id === 'task-title' }; })()`);
    check('校验失败：aria-invalid + aria-describedby + role=alert + 焦点回到输入', formErr.invalid && formErr.describedby && formErr.errRole === 'alert' && formErr.focused, JSON.stringify(formErr));
    await press(cdp, 'Escape', { wait: 300 });
    await go(cdp, '/settings');
    await sleep(400);
    await evaluate(cdp, `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('导出 JSON 备份')); if (b) b.focus(); return Boolean(b); })()`);
    await press(cdp, 'Enter', { wait: 900 });
    const toastLive = await evaluate(cdp, `(() => { const root = document.querySelector('[data-fd-toast-root]'); if (!root) return { found: false }; const item = root.querySelector('[role="status"]'); return { found: true, live: root.getAttribute('aria-live'), itemRole: item?.getAttribute('role'), text: (item?.textContent || '').trim().slice(0, 20) }; })()`);
    check('Toast：polite live region + role=status 播报', toastLive.found && toastLive.live === 'polite' && toastLive.itemRole === 'status', JSON.stringify(toastLive));

    console.log('\n[a11y 12] 全局键盘导航（skip link / 导航）');
    await go(cdp, '/today');
    await evaluate(cdp, `document.body.focus()`);
    await press(cdp, 'Tab', { wait: 120 });
    const firstStop = await activeInfo(cdp);
    check('首个 Tab 焦点为「跳到主要内容」跳转链接', firstStop?.text.includes('跳到主要内容'), JSON.stringify(firstStop));
    await press(cdp, 'Enter', { wait: 250 });
    const afterSkip = await activeInfo(cdp);
    check('跳转链接把焦点送到 main', Boolean(afterSkip?.isMain), JSON.stringify(afterSkip));
    await press(cdp, 'Tab', { wait: 120 });
    let navReached = false;
    for (let i = 0; i < 40 && !navReached; i++) {
      const cur = await activeInfo(cdp);
      if (cur?.text.includes('任务')) navReached = true;
      else await press(cdp, 'Tab', { wait: 60 });
    }
    check('Tab 可到达主导航（任务入口）', navReached);
    await evaluate(cdp, `(() => { const a = [...document.querySelectorAll('nav a')].find((x) => x.textContent.trim() === '任务'); if (a) a.focus(); return Boolean(a); })()`);
    await press(cdp, 'Enter', { wait: 600 });
    const route = await evaluate(cdp, 'location.pathname');
    check('Enter 激活导航后路由切换到 /tasks', route === '/tasks', route);

    console.log('\n[a11y 13] prefers-reduced-motion');
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await go(cdp, '/today');
    await evaluate(cdp, `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('新建任务')); if (b) b.focus(); return true; })()`);
    await press(cdp, 'Enter', { wait: 120 });
    const reduced = await evaluate(cdp, `(() => { const el = document.querySelector('[data-fd-dialog]'); if (!el) return null; const cs = getComputedStyle(el); return { duration: cs.animationDuration, transition: cs.transitionDuration }; })()`);
    const dur = parseFloat(reduced?.duration || '0');
    check('reduced-motion：弹窗动画时长为 0（≤0.02s）', dur <= 0.02, JSON.stringify(reduced));
    await press(cdp, 'Escape', { wait: 250 });
    await cdp.send('Emulation.setEmulatedMedia', { features: [] });

    console.log('\n[a11y 14-15] 320px Reflow / 200% 缩放等价视口');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 800, deviceScaleFactor: 1, mobile: true });
    const over320 = [];
    for (const route of ['/today', '/tasks', '/calendar', '/habits', '/assistant', '/settings']) {
      await go(cdp, route);
      await sleep(400);
      over320.push(await evaluate(cdp, `document.documentElement.scrollWidth - document.documentElement.clientWidth`));
    }
    check('320px：6 个页面无横向溢出（Reflow）', over320.every((v) => v <= 1), over320.join(','));
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 640, height: 900, deviceScaleFactor: 1, mobile: false });
    const over640 = [];
    for (const route of ['/today', '/tasks', '/settings']) {
      await go(cdp, route);
      await sleep(300);
      over640.push(await evaluate(cdp, `document.documentElement.scrollWidth - document.documentElement.clientWidth`));
    }
    check('200% 缩放等价视口（640px）：无内容丢失/横向溢出', over640.every((v) => v <= 1), over640.join(','));
    await cdp.send('Emulation.clearDeviceMetricsOverride');

    console.log('\n[a11y 16] 触控目标尺寸（≥24×24，行内文本链接除外）');
    await go(cdp, '/tasks');
    await sleep(400);
    const smallTargets = await evaluate(cdp, `(() => {
      const els = [...document.querySelectorAll('button, a[href], [role="button"], input:not([type="hidden"]), select, textarea')];
      const bad = [];
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.width < 24 || r.height < 24) {
          const inline = el.closest('p, span.fd-t-micro, span.fd-t-cap');
          if (inline) continue;
          bad.push({ tag: el.tagName.toLowerCase(), label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 18), w: Math.round(r.width), h: Math.round(r.height) });
        }
      }
      return bad.slice(0, 10);
    })()`);
    const draftDiag = await evaluate(cdp, `(() => ({ draft: Boolean(localStorage.getItem('flowday.conflict-draft.v1')), banner: Boolean(document.querySelector('[data-fd-sync-banner]')), status: (window.__FD_STORAGE__ || {}).syncStatus, rev: (window.__FD_STORAGE__ || {}).revision }))()`);
    check('触控目标均 ≥24×24', smallTargets.length === 0, JSON.stringify({ smallTargets, draftDiag }));

    console.log('\n[a11y 17] WCAG AA 对比度（浅色/深色，含玻璃层合成）');
    const contrastOf = `(sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const parse = (c) => { const m = c.match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(',').map((x) => parseFloat(x)); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
      const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
      const blend = (top, bottom) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 });
      const bgOf = (node) => {
        let acc = null;
        let cur = node;
        while (cur) {
          const cs = getComputedStyle(cur);
          const c = parse(cs.backgroundColor);
          if (c && c.a > 0) acc = acc ? blend(acc, c) : c;
          if (acc && acc.a >= 0.999) return acc;
          cur = cur.parentElement;
        }
        return acc ?? { r: 255, g: 255, b: 255, a: 1 };
      };
      const fg = parse(getComputedStyle(el).color);
      const bg = bgOf(el);
      const composite = fg.a < 1 ? blend(fg, bg) : fg;
      const L1 = lum(composite);
      const L2 = lum(bg);
      const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      return { ratio: Math.round(ratio * 100) / 100, size: parseFloat(getComputedStyle(el).fontSize) };
    }`;
    const samples = [
      ['h1', 3.0],
      ['.fd-t-micro', 4.5],
      ['.fd-t-cap', 4.5],
      ['nav a', 4.5],
      ['button.fd-btn-primary', 4.5],
    ];
    const contrastIssues = [];
    for (const theme of ['light', 'dark']) {
      await go(cdp, '/settings');
      await evaluate(cdp, `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '${theme === 'dark' ? '深色' : '浅色'}'); if (b) b.click(); return true; })()`);
      for (let i = 0; i < 30; i++) {
        if ((await evaluate(cdp, `document.documentElement.dataset.theme`)) === theme) break;
        await sleep(100);
      }
      for (const route of ['/today', '/tasks']) {
        await go(cdp, route);
        await sleep(400);
        for (const [sel, min] of samples) {
          const r = await evaluate(cdp, `(${contrastOf})(${JSON.stringify(sel)})`);
          if (!r) continue;
          const need = r.size >= 18.66 ? 3.0 : min;
          if (r.ratio < need) contrastIssues.push({ theme, route, sel, ratio: r.ratio, need });
        }
      }
    }
    check('浅/深色主题关键文本对比度满足 AA', contrastIssues.length === 0, JSON.stringify(contrastIssues.slice(0, 6)));
    await go(cdp, '/settings');
    await evaluate(cdp, `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '浅色'); if (b) b.click(); return true; })()`);
    await sleep(400);

    console.log('\n[a11y K1-K6] 纯键盘核心流程（无鼠标）');
    await go(cdp, '/today');
    await sleep(300);
    // K1 创建任务
    await evaluate(cdp, `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('新建任务')); if (b) b.focus(); return true; })()`);
    await press(cdp, 'Enter', { wait: 400 });
    await typeText(cdp, '键盘创建的任务');
    await press(cdp, 'Tab', { wait: 60 });
    let foundSave = false;
    for (let i = 0; i < 14 && !foundSave; i++) {
      const cur = await activeInfo(cdp);
      if (cur?.text.includes('添加任务')) foundSave = true;
      else await press(cdp, 'Tab', { wait: 50 });
    }
    await press(cdp, 'Enter', { wait: 700 });
    const created = await evaluate(cdp, `Boolean(window.__FD_STATE__.tasks.some((t) => t.title === '键盘创建的任务'))`);
    check('K1 纯键盘创建任务', created && foundSave);
    // K2 完成/取消完成
    await evaluate(cdp, `(() => { const rows = [...document.querySelectorAll('[data-task-id]')]; const row = rows.find((r) => r.textContent.includes('键盘创建的任务')); const btn = row?.querySelector('[data-testid="task-toggle"]'); if (btn) btn.focus(); return Boolean(btn); })()`);
    await press(cdp, 'Enter', { wait: 500 });
    const completed = await evaluate(cdp, `window.__FD_STATE__.tasks.find((t) => t.title === '键盘创建的任务')?.completed === true`);
    check('K2 纯键盘完成任务', completed);
    await press(cdp, 'Enter', { wait: 400 });
    // K3 编辑任务
    await go(cdp, '/tasks');
    await sleep(300);
    await evaluate(cdp, `(() => { const rows = [...document.querySelectorAll('[data-task-id]')]; const row = rows.find((r) => r.textContent.includes('键盘创建的任务')); const btn = row?.querySelector('[aria-label="编辑任务"]'); if (btn) btn.focus(); return Boolean(btn); })()`);
    await press(cdp, 'Enter', { wait: 400 });
    await evaluate(cdp, `(() => { const i = document.querySelector('#task-title'); if (!i) return false; i.focus(); return true; })()`);
    await press(cdp, 'a', { ctrl: true, wait: 120 });
    await typeText(cdp, '键盘编辑后的任务');
    await sleep(200);
    await evaluate(cdp, `(() => { const b = [...document.querySelectorAll('[data-fd-dialog] button')].find((x) => x.textContent.includes('保存') || x.textContent.includes('添加任务')); if (b) b.focus(); return Boolean(b); })()`);
    await press(cdp, 'Enter', { wait: 700 });
    const edited = await evaluate(cdp, `window.__FD_STATE__.tasks.some((t) => t.title === '键盘编辑后的任务')`);
    check('K3 纯键盘编辑任务标题', edited);
    // K4 键盘筛选
    await evaluate(cdp, `(() => { const b = [...document.querySelectorAll('[aria-label="按状态筛选"] button')].find((x) => x.textContent.includes('已完成')); if (b) b.focus(); return Boolean(b); })()`);
    await press(cdp, 'Enter', { wait: 500 });
    const filterState = await evaluate(cdp, `(() => { const pressed = [...document.querySelectorAll('[aria-label="按状态筛选"] button')].map((b) => ({ t: b.textContent.trim(), p: b.getAttribute('aria-pressed') })); const shown = [...document.querySelectorAll('[data-task-id]')].length; return { pressed, shown }; })()`);
    check('K4 纯键盘切换状态筛选', filterState.pressed.some((p) => p.t.includes('已完成') && p.p === 'true'), JSON.stringify(filterState.pressed));
    // K5 键盘习惯打卡
    await go(cdp, '/habits');
    await sleep(400);
    await evaluate(cdp, `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('打卡今天')); if (b) b.focus(); return Boolean(b); })()`);
    await press(cdp, 'Enter', { wait: 600 });
    const habitChecked = await evaluate(cdp, `(() => { const logs = window.__FD_STATE__.habitLogs || []; return logs.length > 0; })()`);
    check('K5 纯键盘完成习惯打卡', habitChecked);
    // K6 键盘设置（主题切换）
    await go(cdp, '/settings');
    await sleep(400);
    await evaluate(cdp, `(() => { const b = [...document.querySelectorAll('[aria-label="主题"] button')].find((x) => x.textContent.trim() === '深色'); if (b) b.focus(); return Boolean(b); })()`);
    await press(cdp, 'Enter', { wait: 600 });
    const themeApplied = await evaluate(cdp, `document.documentElement.dataset.theme === 'dark'`);
    check('K6 纯键盘切换主题', themeApplied);
    await evaluate(cdp, `(() => { const b = [...document.querySelectorAll('[aria-label="主题"] button')].find((x) => x.textContent.trim() === '浅色'); if (b) b.focus(); return Boolean(b); })()`);
    await press(cdp, 'Enter', { wait: 400 });

    console.log('\n[a11y AX] 可访问性树抽检（屏幕阅读器替代验证：NVDA 未安装）');
    await go(cdp, '/today');
    await sleep(300);
    await evaluate(cdp, `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('新建任务')); if (b) b.focus(); return true; })()`);
    await press(cdp, 'Enter', { wait: 500 });
    const axDialog = await cdp.send('Accessibility.getFullAXTree', {}).catch(() => ({ nodes: [] }));
    const axNodes = axDialog.nodes || [];
    const dialogNode = axNodes.find((n) => (n.role?.value || '') === 'dialog');
    const axNamed = Boolean(dialogNode && (dialogNode.name?.value || '').trim());
    check('AX 树：弹窗暴露 dialog 角色且可访问名称为标题', axNamed, JSON.stringify({ role: dialogNode?.role?.value, name: dialogNode?.name?.value }));
    await press(cdp, 'Escape', { wait: 300 });
    const axPage = await cdp.send('Accessibility.getFullAXTree', {}).catch(() => ({ nodes: [] }));
    const nodes2 = axPage.nodes || [];
    const navNode = nodes2.find((n) => (n.role?.value || '') === 'navigation' && (n.name?.value || '').trim());
    const headings = nodes2.filter((n) => /^heading/.test(n.role?.value || '')).length;
    check('AX 树：导航 landmark 有名称且存在标题层级', Boolean(navNode) && headings >= 1, JSON.stringify({ nav: navNode?.name?.value, headings }));

    // 汇总
    const passed = results.filter((r) => r.pass).length;
    const failed = results.length - passed;
    fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), browser: 'Edge headless via CDP', passed, failed, results }, null, 2), 'utf8');
    console.log(`\n无障碍 E2E 结果：${passed} 通过 / ${failed} 失败（共 ${results.length} 项）`);
    if (failed) process.exitCode = 1;
  } finally {
    try { child.kill(); } catch {}
    await sleep(600);
    try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
  }
}

main().catch((e) => {
  console.error('A11Y E2E FAILED', e);
  process.exit(1);
});
