// FlowDay Phase 0 - 真实浏览器 E2E 验证 + 截图
// 使用 Edge headless + CDP（不引入 Playwright 等额外依赖，不产生任何 API 费用）
// 输出：docs/phase0/e2e-report.json 与 docs/phase0/screenshots/*.png
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const OUT_DIR = path.join(ROOT, process.env.E2E_OUT || 'docs/phase0');
const SHOT_DIR = path.join(OUT_DIR, 'screenshots');
const PROFILE = path.join(os.tmpdir(), 'flowday-e2e-edge-profile');
const BASE = process.env.BASE || 'http://127.0.0.1:5173';
const PORT = 9337;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const consoleErrors = [];

function record(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`${pass ? '  ✓' : '  ✗'} ${name}${detail ? ' — ' + detail : ''}`);
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
      for (const [, p] of this.pending) p.reject(new Error('ws closed'));
      this.pending.clear();
    });
    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) {
        for (const fn of this.listeners.get(msg.method) || []) fn(msg.params);
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
  on(method, fn) {
    const arr = this.listeners.get(method) || [];
    arr.push(fn);
    this.listeners.set(method, arr);
  }
  once(method, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout ' + method)), timeoutMs);
      const fn = (p) => {
        clearTimeout(timer);
        this.listeners.set(method, (this.listeners.get(method) || []).filter((x) => x !== fn));
        resolve(p);
      };
      this.on(method, fn);
    });
  }
}

async function waitDevtools(timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return res.json();
    } catch {
      /* retry */
    }
    await sleep(300);
  }
  throw new Error('devtools not ready');
}

let cdp;

async function evaluate(expression) {
  const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (exceptionDetails) throw new Error(exceptionDetails.text + ' ' + (exceptionDetails.exception?.description ?? ''));
  return result.value;
}

async function go(route) {
  const loaded = cdp.once('Page.loadEventFired').catch(() => null);
  await cdp.send('Page.navigate', { url: BASE + route });
  await loaded;
  // 应用页面：等待 App 初始化完成（__FD_STORAGE__.ready），避免慢加载下读到示例数据
  if (!route.includes('.svg')) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const ready = await evaluate('Boolean(window.__FD_STORAGE__ && window.__FD_STORAGE__.ready)').catch(() => false);
      if (ready) break;
      await sleep(60);
    }
  }
  await sleep(300);
}

async function clickText(text, tag = 'button', exact = false) {
  return evaluate(`(() => {
    const text = ${JSON.stringify(text)};
    const els = [...document.querySelectorAll(${JSON.stringify(tag)})];
    const el = els.find((e) => ${exact ? 'e.textContent.trim() === text' : 'e.textContent.includes(text)'});
    if (!el) return false;
    el.click();
    return true;
  })()`);
}

async function clickSelector(selector) {
  return evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);
}

async function selectOption(selector, value) {
  return evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
}

async function setInput(selector, value) {
  return evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
}

async function getData() {
  return evaluate('window.__FD_STATE__');
}

async function resetStorage() {
  await evaluate(`(async () => {
    try {
      await new Promise((resolve) => {
        const req = indexedDB.deleteDatabase('flowday-db');
        req.onsuccess = resolve; req.onerror = resolve; req.onblocked = resolve;
      });
    } catch {
      /* ignore */
    }
    localStorage.removeItem('flowday.v1');
    localStorage.removeItem('flowday.legacy-backup.v1');
    return true;
  })()`);
}

async function seedLegacyData(data) {
  await evaluate(`localStorage.setItem('flowday.v1', ${JSON.stringify(JSON.stringify(data))})`);
}

async function corruptDbRecord() {
  await evaluate(`(async () => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('flowday-db');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    await new Promise((res, rej) => {
      const tx = db.transaction('app', 'readwrite');
      tx.objectStore('app').put({ schemaVersion: 2, updatedAt: new Date().toISOString(), data: { tasks: 'broken' } }, 'state');
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
    db.close();
    return true;
  })()`);
}

async function readDbRecord() {
  return evaluate(`(async () => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('flowday-db');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const rec = await new Promise((res, rej) => {
      const tx = db.transaction('app', 'readonly');
      const q = tx.objectStore('app').get('state');
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
    db.close();
    return rec || null;
  })()`);
}

async function pickImportFile(inputIndex, filePath) {
  const { root } = await cdp.send('DOM.getDocument');
  const inputs = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: 'input[type=file]' });
  const nodeId = inputs.nodeIds[inputIndex ?? 0];
  if (!nodeId) return false;
  await cdp.send('DOM.setFileInputFiles', { files: [filePath], nodeId });
  return true;
}

async function bodyText() {
  return evaluate(`document.body.innerText`);
}

async function screenshot(name) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SHOT_DIR, name + '.png'), Buffer.from(data, 'base64'));
}

async function setViewport(width, height, scale = 1) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: width < 600 });
}

(async () => {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  fs.rmSync(path.join(OUT_DIR, 'e2e-report.json'), { force: true });

  const edge = spawn(
    EDGE,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-networking',
      '--mute-audio',
      '--user-data-dir=' + PROFILE,
      '--remote-debugging-port=' + PORT,
      'about:blank',
    ],
    { stdio: 'ignore', windowsHide: true }
  );

  try {
    const version = await waitDevtools();
    console.log('浏览器：' + version.Browser + '\n');

    let targets = [];
    for (let i = 0; i < 20; i++) {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      targets = await res.json();
      if (targets.some((t) => t.type === 'page' && t.webSocketDebuggerUrl)) break;
      await sleep(300);
    }
    const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    cdp = new CDP(page.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.send('Page.enable');
    await cdp.send('DOM.enable').catch(() => undefined);
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.on('Page.javascriptDialogOpening', () => {
      cdp.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
    });
    await cdp.on('Runtime.consoleAPICalled', (p) => {
      if (p.type === 'error') consoleErrors.push(p.args.map((a) => a.value ?? a.description ?? '').join(' '));
    });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source:
        'window.__fdErrors=[];window.addEventListener("error",e=>window.__fdErrors.push(String(e.message)));window.addEventListener("unhandledrejection",e=>window.__fdErrors.push("unhandledrejection:"+String(e.reason)));',
    });

    // 初始化为干净状态：清空本地数据 → 刷新（应用会自动载入示例数据）
    await setViewport(1440, 900, 1);
    await go('/today');
    await go('/vite.svg');
    await resetStorage();
    await go('/today');

    console.log('[1] 页面渲染');
    const dashText = await bodyText();
    record('首页渲染出今日工作台', dashText.includes('今日焦点') && dashText.includes('今日完成'));
    record('示例数据提示可见', dashText.includes('示例数据'));
    record('首页无横向溢出', await evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'));
    record('无 JS 运行时错误', (await evaluate('window.__fdErrors.length')) === 0);

    console.log('\n[2] 任务：创建 → 完成 → 删除');
    await go('/tasks');
    const beforeCreate = (await getData()).tasks.length;
    await clickText('新建');
    await sleep(400);
    const titleOk = await setInput('#task-title', 'E2E 测试任务');
    await sleep(200);
    const addOk = await clickText('添加任务');
    await sleep(500);
    const afterCreate = await getData();
    record('打开新建任务弹窗并填写标题', titleOk);
    record('点击「添加任务」成功', addOk);
    record('任务写入 IndexedDB', afterCreate.tasks.length === beforeCreate + 1);
    record('新任务出现在列表中', (await bodyText()).includes('E2E 测试任务'));

    // 完成/撤销
    const toggleDone = await evaluate(`(() => {
      const btn = [...document.querySelectorAll('button[aria-label="标记为已完成"]')]
        .find((b) => (b.closest('.group')?.textContent || '').includes('E2E 测试任务'));
      if (!btn) return false; btn.click(); return true;
    })()`);
    await sleep(400);
    const afterDone = await getData();
    const target = afterDone.tasks.find((t) => t.title === 'E2E 测试任务');
    record('点击复选框标记完成', toggleDone && target?.completed === true);
    await evaluate(`(() => {
      const btn = [...document.querySelectorAll('button[aria-label="标记为未完成"]')]
        .find((b) => (b.closest('.group')?.textContent || '').includes('E2E 测试任务'));
      if (!btn) return false; btn.click(); return true;
    })()`);
    await sleep(300);
    record('可撤销完成', (await getData()).tasks.find((t) => t.title === 'E2E 测试任务')?.completed === false);

    // 刷新后数据仍在（持久化）
    await go('/tasks');
    record('刷新页面后任务仍在（IndexedDB 持久化）', (await bodyText()).includes('E2E 测试任务'));

    // 删除（玻璃确认框：二次确认后才真正删除）
    const delOk = await evaluate(`(() => {
      const btn = [...document.querySelectorAll('button[aria-label="删除任务"]')]
        .find((b) => (b.closest('.group')?.textContent || '').includes('E2E 测试任务'));
      if (!btn) return false; btn.click(); return true;
    })()`);
    await sleep(400);
    const confirmVisible = await evaluate(`Boolean(document.querySelector('[data-fd-confirm]'))`);
    const confirmDeleteOk = await evaluate(`(() => { const b = document.querySelector('[data-fd-confirm-ok="1"]'); if (!b) return false; b.click(); return true; })()`);
    await sleep(500);
    record('删除任务需二次确认（玻璃确认框）', delOk && confirmVisible && confirmDeleteOk);
    record('删除任务并从存储移除', !(await getData()).tasks.some((t) => t.title === 'E2E 测试任务'));

    console.log('\n[2.5] 搜索 / 筛选 / 编辑 / 统计联动');
    const todayStr = await evaluate("new Date().toLocaleDateString('sv-SE')");
    await go('/tasks');
    await setInput('#task-search', '周报');
    await sleep(400);
    const searchText = await bodyText();
    record('搜索关键词过滤列表', searchText.includes('写本周周报') && !searchText.includes('产品评审会'));
    await setInput('#task-search', '');
    await sleep(300);
    await selectOption('#filter-priority', '1');
    await sleep(400);
    const p1Shown = await evaluate(`document.querySelectorAll('[data-task-id]').length`);
    const p1Expected = await evaluate(`window.__FD_STATE__.tasks.filter((t) => t.priority === 1).length`);
    record('优先级筛选结果与数据一致', p1Shown === p1Expected && p1Expected > 0, `shown=${p1Shown} expected=${p1Expected}`);
    await selectOption('#filter-priority', 'all');
    await sleep(300);
    await clickText('已完成', 'button', true);
    await sleep(400);
    const doneOnly = await evaluate(`(() => {
      const d = window.__FD_STATE__;
      const done = new Set(d.tasks.filter((t) => t.completed).map((t) => t.id));
      const rows = [...document.querySelectorAll('[data-task-id]')];
      return rows.length > 0 && rows.every((el) => done.has(el.getAttribute('data-task-id')));
    })()`);
    record('状态筛选「已完成」只显示已完成任务', doneOnly);
    await clickText('全部', 'button', true);
    await sleep(300);
    await selectOption('#filter-date', 'overdue');
    await sleep(400);
    record('日期筛选无结果时给出空状态提示', (await bodyText()).includes('没有符合筛选条件'));
    await clickText('清空筛选');
    await sleep(300);

    await clickText('新建', 'button', true);
    await sleep(400);
    await setInput('#task-title', '编辑测试任务');
    await setInput('#task-time', '08:00');
    await clickText('添加任务');
    await sleep(500);
    await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '编辑测试任务'); if (!b) return false; b.click(); return true; })()`);
    await sleep(500);
    await setInput('#task-title', '编辑后任务');
    await setInput('#task-time', '09:15');
    await clickText('P1 紧急', 'button', true);
    await sleep(200);
    await clickText('保存修改');
    await sleep(500);
    const edited = (await getData()).tasks.find((x) => x.title === '编辑后任务');
    record('编辑名称/时间/优先级并保存', Boolean(edited && edited.time === '09:15' && edited.priority === 1));
    record('操作成功出现 Toast 提示', await evaluate(`Boolean(document.querySelector('[data-fd-toast]'))`));

    const beforeDone = await evaluate(`window.__FD_STATE__.tasks.filter((t) => t.completed && t.date === ${JSON.stringify(todayStr)}).length`);
    await evaluate(`(() => {
      const btn = [...document.querySelectorAll('button[aria-label="标记为已完成"]')]
        .find((b) => (b.closest('.group')?.textContent || '').includes('编辑后任务'));
      if (!btn) return false; btn.click(); return true;
    })()`);
    await sleep(600);
    const afterDoneCount = await evaluate(`window.__FD_STATE__.tasks.filter((t) => t.completed && t.date === ${JSON.stringify(todayStr)}).length`);
    record('标记完成后完成数 +1', afterDoneCount === beforeDone + 1, `${beforeDone} -> ${afterDoneCount}`);
    await go('/today');
    await sleep(500);
    const dashTextStats = await bodyText();
    const stats = await evaluate(`(() => {
      const d = window.__FD_STATE__;
      const t = ${JSON.stringify(todayStr)};
      const todays = d.tasks.filter((x) => x.date <= t);
      return { total: todays.length, done: todays.filter((x) => x.completed).length, open: todays.filter((x) => !x.completed).length };
    })()`);
    const expectedPercent = stats.total === 0 ? 0 : Math.round((stats.done / stats.total) * 100);
    const domStats = await evaluate(`(() => { const el = document.querySelector('[data-fd-stats]'); return el ? JSON.parse(el.getAttribute('data-fd-stats')) : null; })()`);
    record('首页完成率与本地数据一致', Boolean(domStats && domStats.total === stats.total && domStats.done === stats.done && domStats.percent === expectedPercent), JSON.stringify(domStats));
    record('已完成任务不计入待办数量', Boolean(domStats && domStats.open === stats.open));

    // 旧数据迁移、防重复迁移与备份恢复见 [7.8] 数据层专项
    console.log('\n[3] 习惯打卡');
    await go('/habits');
    const logsBefore = (await getData()).habitLogs.length;
    const checkOk = await clickText('打卡今天');
    await sleep(500);
    const logsAfter = (await getData()).habitLogs.length;
    record('点击「打卡今天」写入打卡记录', checkOk && logsAfter === logsBefore + 1);
    await go('/habits');
    record('刷新后打卡记录仍在', (await getData()).habitLogs.length === logsAfter);
    const undoOk = await clickText('今天已打卡 · 撤销');
    await sleep(400);
    record('可撤销打卡', undoOk && (await getData()).habitLogs.length === logsBefore);

    console.log('\n[4] 日历切换');
    await go('/calendar');
    const monthLabel = await evaluate(`document.body.innerText.split('\\n').find((s) => s.includes('年')) || ''`);
    record('默认月视图显示月份标题', monthLabel.includes('年'));
    await clickText('周', 'button', true);
    await sleep(400);
    record('可切换到周视图', (await bodyText()).includes('周') && (await evaluate(`document.querySelectorAll('button').length > 0`)));
    await clickText('日', 'button', true);
    await sleep(400);
    record('可切换到日视图', (await bodyText()).includes('的时间线'));
    await clickText('月', 'button', true);
    await sleep(400);
    const nextOk = await clickSelector('button[aria-label="下一页"]');
    await sleep(400);
    record('可翻到下一月并刷新标题', nextOk && (await bodyText()).includes('年'));
    const todayOk = await clickText('回到今天');
    await sleep(400);
    record('可一键回到今天', todayOk);

    console.log('\n[4.5] 日历排程与冲突检测');
    await go('/calendar');
    await clickText('日', 'button', true);
    await sleep(500);
    await clickText('添加', 'button', true);
    await sleep(400);
    await setInput('#task-title', '排程测试任务');
    await clickText('添加任务');
    await sleep(500);
    record('无时间任务进入「未安排」列表', (await bodyText()).includes('排程测试任务'));
    const openSched = await evaluate(`(() => { const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '排时间'); if (!btn) return false; btn.click(); return true; })()`);
    await sleep(300);
    await setInput('#sched-time', '15:00');
    const confirmSched = await clickText('确认排程');
    await sleep(500);
    const schedTask = (await getData()).tasks.find((x) => x.title === '排程测试任务');
    record('「排时间」写入 time=15:00', openSched && confirmSched && schedTask?.time === '15:00');
    record('时间线渲染 15:00–16:00 时间块', (await bodyText()).includes('15:00–16:00'));
    await clickText('添加', 'button', true);
    await sleep(400);
    await setInput('#task-title', '冲突测试任务');
    await clickText('添加任务');
    await sleep(400);
    await evaluate(`(() => { const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '排时间'); if (!btn) return false; btn.click(); return true; })()`);
    await sleep(300);
    await setInput('#sched-time', '15:30');
    await clickText('确认排程');
    await sleep(500);
    record('重叠排程触发冲突提示', (await bodyText()).includes('时间冲突'));
    const box = await evaluate(`(() => { const el = document.querySelector('[data-fd-timeline]'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + 8 }; })()`);
    if (box) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
      await sleep(500);
      const timeVal = await evaluate(`document.querySelector('#task-time')?.value || ''`);
      record('点击时间线空白处快速创建（预填时间）', Boolean(timeVal), timeVal);
      await clickText('取消');
      await sleep(300);
    } else {
      record('点击时间线空白处快速创建（预填时间）', false, 'timeline not found');
    }
    await screenshot('desktop-calendar-day');
    await go('/calendar');
    await clickText('日', 'button', true);
    await sleep(500);
    record('排程结果刷新后保留', (await bodyText()).includes('15:00–16:00'));

    console.log('\n[5] AI 助手「Jing」（本地演示，无 API 调用）');
    await go('/assistant');
    record('助手页面显示演示模式说明', (await bodyText()).includes('演示模式'));
    const tasksBeforeAi = (await getData()).tasks.length;
    await evaluate(`(() => {
      const chip = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('帮我规划今天'));
      if (!chip) return false; chip.click(); return true;
    })()`);
    await sleep(1400);
    record('发送消息后生成提案卡', (await bodyText()).includes('提案'));
    const confirmOk = await clickText('确认执行');
    await sleep(600);
    const tasksAfterAi = (await getData()).tasks.length;
    record('确认执行后真实写入任务', confirmOk && tasksAfterAi === tasksBeforeAi + 3);
    record('对话区显示已执行状态', (await bodyText()).includes('已执行'));

    console.log('\n[6] 页面导航');
    await evaluate(`(() => { const a = [...document.querySelectorAll('a')].find((x) => x.getAttribute('href') === '/habits'); if (a) a.click(); return Boolean(a); })()`);
    await sleep(700);
    record('侧边栏导航到「习惯」', (await evaluate('location.pathname')) === '/habits');
    record('页面标题随路由更新', (await bodyText()).includes('习惯'));

    console.log('\n[7] 移动端适配（390px）');
    await setViewport(390, 844, 2);
    await go('/today');
    record('移动端无横向溢出', await evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'));
    record('移动端底部导航存在 5 个入口', (await evaluate(`document.querySelectorAll('nav.fixed a').length`)) === 5);
    const navInfo = await evaluate(`(() => {
      const n = document.querySelector('nav.fixed');
      if (!n) return { found: false };
      const r = n.getBoundingClientRect();
      return { found: true, position: getComputedStyle(n).position, bottom: Math.round(r.bottom), innerH: window.innerHeight };
    })()`);
    record('底部导航固定在视口底部（悬浮玻璃胶囊）', Boolean(navInfo.found && navInfo.innerH - navInfo.bottom <= 40 && navInfo.innerH - navInfo.bottom >= 0), JSON.stringify(navInfo));
    // Beta.2（Liquid Glass v2）：底栏是 L1 液态玻璃材质，选中态为独立位移胶囊
    const navGlass = await evaluate(`(() => { const el = document.querySelector('nav[aria-label="底部导航"]'); if (!el) return null; const cs = getComputedStyle(el); return { bf: cs.backdropFilter || cs.webkitBackdropFilter || '', bg: cs.backgroundColor, bi: cs.backgroundImage.slice(0, 160) }; })()`);
    const alphaOf = (value) => {
      if (!value) return 1;
      if (value.startsWith('rgba')) return Number(value.split(',')[3]?.replace(')', '') ?? 1);
      const m = value.match(/\/\s*([0-9.]+)\s*\)/);
      return m ? Number(m[1]) : 1;
    };
    record(
      '移动端底栏为液态玻璃材质（backdrop blur + 半透明 + 多层材质）',
      Boolean(navGlass && /blur/.test(navGlass.bf) && alphaOf(navGlass.bg) < 1 && /gradient|radial/.test(navGlass.bi)),
      JSON.stringify({ bf: navGlass?.bf, bg: navGlass?.bg, alpha: alphaOf(navGlass?.bg) })
    );
    const pill = await evaluate(`(() => {
      const el = document.querySelector('nav[aria-label="底部导航"] .lg-tab-pill');
      if (!el) return null;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), opacity: Number(cs.opacity), bi: cs.backgroundImage.slice(0, 120), transform: cs.transform, transition: cs.transitionProperty };
    })()`);
    record(
      '移动端选中 Tab 为液态高光胶囊（独立位移元素 + 渐变材质）',
      Boolean(pill && pill.w > 8 && pill.h > 8 && pill.opacity === 1 && /gradient/.test(pill.bi) && /transform/.test(pill.transition)),
      JSON.stringify(pill)
    );
    const pillBefore = pill?.transform ?? '';
    await clickText('任务', 'a');
    await sleep(560);
    const pillAfter = await evaluate(`(() => { const el = document.querySelector('nav[aria-label="底部导航"] .lg-tab-pill'); return el ? getComputedStyle(el).transform : null; })()`);
    record('液态胶囊随 Tab 切换产生形态位移（非淡入淡出）', Boolean(pillAfter && pillAfter !== pillBefore), `${pillBefore} → ${pillAfter}`);
    await go('/today');
    await sleep(320);
    const mobBlur = await evaluate(`(() => { const el = document.querySelector('header > div'); const cs = getComputedStyle(el); return cs.backdropFilter || cs.webkitBackdropFilter || ''; })()`);
    record('移动端玻璃模糊与桌面接近（16px）', /blur\(16px\)/.test(mobBlur), mobBlur);
    await go('/calendar');
    await clickText('周', 'button', true);
    await sleep(500);
    const weekScroll = await evaluate(`(() => { const el = document.querySelector('section.fd-scroll'); return el ? el.scrollWidth > el.clientWidth : false; })()`);
    record('移动端周视图为横向 7 列滑动条（与桌面同效）', weekScroll);
    await screenshot('mobile-calendar-week');
    await go('/today');
    await sleep(300);

    // 恢复演示数据（干净状态截图）
    await go('/vite.svg');
    await resetStorage();
    await go('/today');
    const resetErrors = await evaluate('window.__fdErrors.length');
    console.log('\n[7.5] 液态玻璃材质（桌面）');
    await setViewport(1440, 900, 1);
    await sleep(400);
    const glassChecks = await evaluate(`(() => {
      const pick = (sel) => { const el = document.querySelector(sel); if (!el) return null; const cs = getComputedStyle(el); return { bf: cs.backdropFilter || cs.webkitBackdropFilter || '', bg: cs.backgroundColor, bi: cs.backgroundImage, shadow: cs.boxShadow, border: cs.borderTopColor }; };
      return { aside: pick('aside.fd-glass'), header: pick('header .fd-glass'), active: pick('a.fd-nav-item-active') };
    })()`);
    record('侧边栏玻璃：backdrop-filter 含 blur', /blur/.test(glassChecks.aside?.bf || ''), glassChecks.aside?.bf);
    record('侧边栏玻璃：半透明材质底色（alpha < 1）', (() => { const bg = glassChecks.aside?.bg || ''; const m = bg.match(/\/\s*([0-9.]+)\s*\)/) || bg.match(/rgba\([^)]*,\s*([0-9.]+)\s*\)/); return Boolean(bg) && (!m || Number(m[1]) < 1); })(), glassChecks.aside?.bg);
    record('侧边栏玻璃：柔和阴影 + 内高光(inset)', (glassChecks.aside?.shadow || '').includes('inset'));
    record('顶栏玻璃：backdrop-filter 含 blur', /blur/.test(glassChecks.header?.bf || ''), glassChecks.header?.bf);
    record('顶栏玻璃：细边框存在', Boolean(glassChecks.header?.border));
    record('导航选中态为液态高光胶囊（渐变内光 + 内衬高光）', Boolean(glassChecks.active && /gradient|radial/.test(glassChecks.active.bi || '') && /inset/.test(glassChecks.active.shadow || '')), JSON.stringify({ bi: glassChecks.active?.bi?.slice(0, 90), inset: /inset/.test(glassChecks.active?.shadow || '') }));
    const avatarOk = await clickSelector('button[aria-label="账户菜单"]');
    await sleep(400);
    const menuVisible = await evaluate(`document.body.innerText.includes('导出 JSON 备份')`);
    const menuGlass = await evaluate(`(() => { const els = [...document.querySelectorAll('div.fd-glass.fd-pop')]; const el = els[els.length-1]; if (!el) return null; const cs = getComputedStyle(el); return cs.backdropFilter || cs.webkitBackdropFilter || ''; })()`);
    record('头像玻璃下拉菜单可打开', avatarOk && menuVisible);
    record('下拉菜单为玻璃材质', /blur/.test(menuGlass || ''), menuGlass);
    await screenshot('desktop-avatar-menu');
    await evaluate(`(() => { const o = document.querySelector('div.fixed.inset-0.z-40'); if (o) o.click(); return true; })()`);
    await sleep(300);
    record('浏览器控制台/运行时无错误', consoleErrors.length === 0 && resetErrors === 0);
    console.log('\n[7.6] 堆叠效果');
    const stackLayer = await evaluate(`(() => { const el = document.querySelector('aside.fd-stack'); if (!el) return null; const cs = getComputedStyle(el, '::after'); return { h: cs.height, bg: cs.backgroundColor }; })()`);
    record('玻璃面板带堆叠薄片层（::after 有可见高度）', Boolean(stackLayer && parseFloat(stackLayer.h) >= 8), JSON.stringify(stackLayer));
    await go('/today');
    const stickyPos = await evaluate(`[...document.querySelectorAll('main section.sticky')].slice(0, 6).map((e) => getComputedStyle(e).position)`);
    record('Dashboard 卡片为 sticky 堆叠（≥6 张）', stickyPos.length >= 6 && stickyPos.every((p) => p === 'sticky'), JSON.stringify(stickyPos));
    await evaluate(`window.scrollTo({ top: 900 })`);
    await sleep(500);
    const tops = await evaluate(`[...document.querySelectorAll('main section.sticky')].map((e) => Math.round(e.getBoundingClientRect().top))`);
    record('滚动时卡片依次吸顶形成堆叠', Boolean(tops.length >= 3 && tops[0] >= 70 && tops[0] <= tops[1] + 40), JSON.stringify(tops));
    await screenshot('desktop-today-stacked');
    await evaluate(`window.scrollTo({ top: 0 })`);
    await sleep(300);

    console.log('\n[7.7] Toast 生命周期 / 快速连点 / 多分辨率 / 空数据 / 异常数据');
    await setViewport(1440, 900, 1);
    await go('/tasks');
    await evaluate(`(() => {
      const btn = document.querySelector('button[aria-label="标记为已完成"], button[aria-label="标记为未完成"]');
      if (!btn) return false; btn.click(); return true;
    })()`);
    await sleep(300);
    record('操作后 Toast 出现', await evaluate(`Boolean(document.querySelector('[data-fd-toast]'))`));
    await sleep(3000);
    record('Toast 自动消失（含离场动画）', await evaluate(`document.querySelectorAll('[data-fd-toast]').length === 0`));
    await evaluate(`(() => { const b = document.querySelector('button[aria-label="标记为已完成"], button[aria-label="标记为未完成"]'); if (b) b.click(); return true; })()`);
    await sleep(300);

    const rapid = await evaluate(`(async () => {
      const d = window.__FD_STATE__;
      const first = d.tasks[0];
      const btn = () => {
        const row = [...document.querySelectorAll('[data-task-id]')].find((el) => el.getAttribute('data-task-id') === first.id);
        return row && row.querySelector('[data-testid="task-toggle"]');
      };
      const b1 = btn();
      if (!b1) return { ok: false, reason: 'not-found' };
      b1.click();
      await new Promise((r) => setTimeout(r, 80));
      const b2 = btn();
      if (!b2) return { ok: false, reason: 'unmounted' };
      b2.click();
      await new Promise((r) => setTimeout(r, 350));
      const after = window.__FD_STATE__.tasks.find((t) => t.id === first.id);
      return { ok: true, before: first.completed, after: after.completed };
    })()`);
    record('快速连点两次状态与数据保持一致', Boolean(rapid.ok && rapid.before === rapid.after), JSON.stringify(rapid));

    const widths = [360, 768, 1024, 1440];
    const overflowChecks = [];
    for (const w of widths) {
      await setViewport(w, w < 600 ? 800 : 900, 1);
      await go('/today');
      overflowChecks.push({ w, ok: await evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1') });
    }
    record('360/768/1024/1440 均无横向溢出', overflowChecks.every((x) => x.ok), JSON.stringify(overflowChecks));

    const navState = async () => evaluate(`(() => {
      const aside = document.querySelector('aside');
      const nav = document.querySelector('nav.fd-glass');
      return { aside: !!aside && getComputedStyle(aside).display !== 'none', nav: !!nav && getComputedStyle(nav).display !== 'none' };
    })()`);
    await setViewport(768, 1024, 1);
    await go('/today');
    const tabletState = await navState();
    record('平板(768)使用底部导航、隐藏侧栏', tabletState.nav && !tabletState.aside, JSON.stringify(tabletState));
    await setViewport(1024, 800, 1);
    await go('/today');
    const deskState = await navState();
    record('桌面(1024)使用侧边栏、隐藏底栏', deskState.aside && !deskState.nav, JSON.stringify(deskState));

    await setViewport(1440, 900, 1);
    await go('/vite.svg');
    await resetStorage();
    await go('/today');
    const emptyRoutes = ['/today', '/tasks', '/calendar', '/habits', '/assistant', '/settings'];
    const emptyResults = [];
    for (const route of emptyRoutes) {
      await go(route);
      const text = await bodyText();
      emptyResults.push({ route, len: text.length, errors: await evaluate('window.__fdErrors.length') });
    }
    record('清空数据后 6 个页面均正常渲染且无异常', emptyResults.every((r) => r.len > 50 && r.errors === 0), JSON.stringify(emptyResults));

    await go('/vite.svg');
    await corruptDbRecord();
    await go('/today');
    await sleep(600);
    const corruptText = await bodyText();
    const corruptToast = await evaluate(`Boolean(document.querySelector('[data-fd-toast][data-fd-toast="error"]'))`);
    record('损坏的 IndexedDB 数据可恢复（示例数据 + 错误提示）', corruptText.includes('示例数据') && corruptToast && (await evaluate('window.__fdErrors.length')) === 0);
    await go('/vite.svg');
    await resetStorage();
    await go('/today');
    record('全流程控制台无未处理错误', consoleErrors.length === 0 && (await evaluate('window.__fdErrors.length')) === 0);

    console.log('\n[7.8] 数据层：IndexedDB 初始化 / 迁移 / 备份恢复');
    await go('/vite.svg');
    await resetStorage();
    await go('/today');
    await sleep(600);
    const dbRecord = await readDbRecord();
    record(
      '首次启动创建 IndexedDB 并写入 schema v2',
      Boolean(dbRecord && dbRecord.schemaVersion === 2 && Array.isArray(dbRecord.data?.tasks) && dbRecord.data.tasks.length > 0),
      JSON.stringify({ schemaVersion: dbRecord?.schemaVersion, tasks: dbRecord?.data?.tasks?.length })
    );

    const todayStr2 = await evaluate("new Date().toLocaleDateString('sv-SE')");
    const legacyPayload = {
      version: 1,
      tasks: [
        { id: 'legacy_t1', title: '旧数据迁移任务', date: todayStr2, priority: 4, completed: false, createdAt: new Date().toISOString(), source: 'manual' },
      ],
      projects: [],
      habits: [],
      habitLogs: [],
      settings: { name: '', theme: 'light', weekStart: 1, aiEnabled: true, demoData: false },
    };
    await go('/vite.svg');
    await resetStorage();
    await seedLegacyData(legacyPayload);
    await go('/today');
    {
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline) {
        const done = await evaluate('Boolean(window.__FD_STATE__ && window.__FD_STATE__.tasks.some((t) => t.title === \'旧数据迁移任务\'))').catch(() => false);
        if (done) break;
        await sleep(80);
      }
    }
    const migratedState = await evaluate('window.__FD_STATE__');
    const legacyCopies = await evaluate(`({ legacy: Boolean(localStorage.getItem('flowday.v1')), backup: Boolean(localStorage.getItem('flowday.legacy-backup.v1')) })`);
    record(
      'localStorage 旧数据自动迁移到 IndexedDB（优先级 4→3）',
      Boolean(migratedState && migratedState.tasks.some((t) => t.title === '旧数据迁移任务' && t.priority === 3))
    );
    record('迁移后保留旧数据与回滚副本（不立即清空）', legacyCopies.legacy && legacyCopies.backup, JSON.stringify(legacyCopies));

    await evaluate(`(() => {
      const raw = JSON.parse(localStorage.getItem('flowday.v1'));
      raw.tasks.push({ id: 'legacy_t2', title: '不应被回灌', date: raw.tasks[0].date, priority: 1, completed: false, createdAt: new Date().toISOString(), source: 'manual' });
      localStorage.setItem('flowday.v1', JSON.stringify(raw));
      return true;
    })()`);
    await go('/today');
    await sleep(700);
    const afterNoRepeat = await evaluate('window.__FD_STATE__');
    record('重复启动不重复迁移旧数据', Boolean(afterNoRepeat && !afterNoRepeat.tasks.some((t) => t.title === '不应被回灌')));

    // 迁移失败：提示错误、回退示例数据、旧数据原样保留
    await go('/vite.svg');
    await resetStorage();
    await evaluate(`localStorage.setItem('flowday.v1', '{corrupted legacy data')`);
    await go('/today');
    await sleep(800);
    const failureToast = await evaluate(`(() => [...document.querySelectorAll('[data-fd-toast]')].map((x) => x.textContent).join(' '))()`);
    const legacyIntact = await evaluate(`localStorage.getItem('flowday.v1') === '{corrupted legacy data'`);
    const failureFallback = (await bodyText()).includes('示例数据');
    record('迁移失败时提示错误且旧数据原样保留', failureToast.includes('旧数据迁移失败') && legacyIntact && failureFallback, failureToast.slice(0, 60));
    await go('/vite.svg');
    await resetStorage();
    await go('/today');
    await sleep(700);

    await go('/tasks');
    await sleep(500);
    await clickText('新建', 'button', true);
    await sleep(400);
    await setInput('#task-title', 'IndexedDB 持久化任务');
    await clickText('添加任务');
    await sleep(800);
    const persistedInline = await evaluate(`window.__FD_STATE__.tasks.some((t) => t.title === 'IndexedDB 持久化任务')`);
    await go('/tasks');
    await sleep(500);
    const persistedAfterReload = await evaluate(`window.__FD_STATE__.tasks.some((t) => t.title === 'IndexedDB 持久化任务')`);
    record('IndexedDB 读写：新建任务刷新后仍在', persistedInline && persistedAfterReload);
    const delDbOk = await evaluate(`(() => {
      const btn = [...document.querySelectorAll('button[aria-label="删除任务"]')]
        .find((b) => (b.closest('.group')?.textContent || '').includes('IndexedDB 持久化任务'));
      if (!btn) return false; btn.click(); return true;
    })()`);
    await sleep(400);
    await evaluate(`(() => { const b = document.querySelector('[data-fd-confirm-ok="1"]'); if (!b) return false; b.click(); return true; })()`);
    await sleep(800);
    await go('/tasks');
    await sleep(500);
    const removedAfterReload = await evaluate(`window.__FD_STATE__.tasks.some((t) => t.title === 'IndexedDB 持久化任务')`);
    record('IndexedDB 删除：删除后刷新不再出现', delDbOk && !removedAfterReload);

    // 导出备份（真实下载文件）
    const downloadDir = path.join(ROOT, '.tmp', 'e2e-download');
    fs.rmSync(downloadDir, { recursive: true, force: true });
    fs.mkdirSync(downloadDir, { recursive: true });
    await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir }).catch(() => undefined);
    await go('/settings');
    await sleep(400);
    await clickText('导出 JSON 备份');
    await sleep(1600);
    let downloadedFiles = [];
    try {
      downloadedFiles = fs.readdirSync(downloadDir).filter((f) => f.endsWith('.json'));
    } catch {
      downloadedFiles = [];
    }
    let backupContent = null;
    if (downloadedFiles.length) {
      try {
        backupContent = JSON.parse(fs.readFileSync(path.join(downloadDir, downloadedFiles[0]), 'utf8'));
      } catch {
        backupContent = null;
      }
    }
    record(
      '导出 JSON 备份（含 schemaVersion 与数据）',
      Boolean(backupContent && backupContent.app === 'FlowDay' && backupContent.schemaVersion === 2 && Array.isArray(backupContent.data?.tasks)),
      `files=${downloadedFiles.length} version=${backupContent?.schemaVersion}`
    );

    // 合法备份导入（需确认）
    const importPath = path.join(ROOT, '.tmp', 'e2e-import.json');
    fs.mkdirSync(path.join(ROOT, '.tmp'), { recursive: true });
    const stateForImport = await evaluate('window.__FD_STATE__');
    const importPayload = {
      app: 'FlowDay',
      schemaVersion: 2,
      exportedAt: new Date().toISOString(),
      data: {
        ...stateForImport,
        tasks: [{ id: 'import_t1', title: '导入的备份任务', date: todayStr2, priority: 2, completed: false, createdAt: new Date().toISOString(), source: 'manual' }],
        habits: [],
        habitLogs: [],
        projects: [],
      },
    };
    fs.writeFileSync(importPath, JSON.stringify(importPayload), 'utf8');
    await go('/settings');
    await sleep(400);
    await pickImportFile(0, importPath);
    await sleep(900);
    const importPreviewShown = await evaluate(`Boolean(document.querySelector('[data-fd-import-preview]'))`);
    const importConfirmEnabled = await evaluate(`(() => { const b = document.querySelector('[data-fd-import-confirm="1"]'); return Boolean(b) && !b.disabled; })()`);
    await evaluate(`(() => { const b = document.querySelector('[data-fd-import-confirm="1"]'); if (!b) return false; b.click(); return true; })()`);
    await sleep(900);
    const importedTaskVisible = await evaluate(`window.__FD_STATE__.tasks.some((t) => t.title === '导入的备份任务')`);
    record('导入 JSON 备份（先预览确认再覆盖）写入数据', importPreviewShown && importConfirmEnabled && importedTaskVisible);

    // 非法 JSON 拒绝且数据不变
    const beforeInvalidCount = await evaluate(`window.__FD_STATE__.tasks.length`);
    fs.writeFileSync(importPath, '{not-json', 'utf8');
    await go('/settings');
    await sleep(400);
    await pickImportFile(0, importPath);
    await sleep(900);
    const invalidError = await evaluate(`(() => { const el = document.querySelector('[data-fd-import-error]'); return el ? el.textContent : ''; })()`);
    const invalidConfirmDisabled = await evaluate(`(() => { const b = document.querySelector('[data-fd-import-confirm="1"]'); return Boolean(b) && b.disabled; })()`);
    const afterInvalidCount = await evaluate(`window.__FD_STATE__.tasks.length`);
    record('非法 JSON 被拒绝且原数据不变', invalidError.includes('校验失败') && invalidConfirmDisabled && afterInvalidCount === beforeInvalidCount, `err=${invalidError.slice(0, 40)} ${beforeInvalidCount}->${afterInvalidCount}`);
    await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '取消' && x.closest('[data-fd-import-preview]')); if (b) b.click(); return true; })()`);
    await sleep(300);

    // 高版本备份拒绝
    fs.writeFileSync(importPath, JSON.stringify({ app: 'FlowDay', schemaVersion: 99, data: stateForImport }), 'utf8');
    await go('/settings');
    await sleep(400);
    await pickImportFile(0, importPath);
    await sleep(900);
    const versionError = await evaluate(`(() => { const el = document.querySelector('[data-fd-import-error]'); return el ? el.textContent : ''; })()`);
    const afterVersionCount = await evaluate(`window.__FD_STATE__.tasks.length`);
    record('高版本备份被拒绝（提示版本并保持原数据）', versionError.includes('版本') && afterVersionCount === beforeInvalidCount, versionError.slice(0, 80));
    await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '取消' && x.closest('[data-fd-import-preview]')); if (b) b.click(); return true; })()`);
    await sleep(300);

    // 恢复示例数据供截图
    await go('/settings');
    await sleep(400);
    await clickText('载入示例数据');
    await sleep(400);
    await evaluate(`(() => { const b = document.querySelector('[data-fd-confirm-ok="1"]'); if (!b) return false; b.click(); return true; })()`);
    await sleep(900);
    const demoRestored = await evaluate(`Boolean(window.__FD_STATE__.settings.demoData)`);
    record('恢复示例数据用于最终截图', demoRestored);

    console.log('\n[7.9] R3 聚合统计 / R4 搜索防抖与中文输入法');
    await go('/tasks');
    await sleep(400);
    const debounceRes = await evaluate(`(async () => {
      window.__FD_FILTER_COUNT__ = 0;
      window.__FD_FILTER_LAST_KEY__ = undefined;
      window.__FD_LAST_FILTERED_LEN__ = null;
      const input = document.querySelector('#task-search');
      const set = (v) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, v);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };
      for (const value of ['写', '写本', '写本周', '写本周周']) {
        set(value);
        await new Promise((r) => setTimeout(r, 30));
      }
      set('写本周周报');
      const t0 = performance.now();
      const deadline = t0 + 3000;
      while (performance.now() < deadline) {
        if (window.__FD_LAST_FILTERED_LEN__ !== null && !document.body.innerText.includes('搜索中…')) break;
        await new Promise((r) => setTimeout(r, 5));
      }
      return {
        filterCount: window.__FD_FILTER_COUNT__,
        len: window.__FD_LAST_FILTERED_LEN__,
        delay: performance.now() - t0,
        showsTarget: document.body.innerText.includes('写本周周报'),
      };
    })()`);
    record('连续 5 次输入只触发 1 次实际查询（120ms 防抖）', debounceRes.filterCount === 1, JSON.stringify(debounceRes));
    record('防抖后搜索结果正确', debounceRes.showsTarget && debounceRes.len === 1, JSON.stringify({ len: debounceRes.len }));

    await evaluate(`(() => {
      const el = document.querySelector('#task-search');
      window.__FD_FILTER_COUNT__ = 0;
      window.__FD_FILTER_LAST_KEY__ = undefined;
      el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, 'zhou');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await sleep(160);
    const imeDuring = await evaluate(`window.__FD_FILTER_COUNT__ || 0`);
    record('中文输入法组合期间不触发搜索', imeDuring === 0, String(imeDuring));

    await evaluate(`(() => {
      const el = document.querySelector('#task-search');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '周报');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '周报' }));
    })()`);
    await sleep(320);
    const imeAfter = await evaluate(`({
      count: window.__FD_FILTER_COUNT__ || 0,
      len: window.__FD_LAST_FILTERED_LEN__,
      showsTarget: document.body.innerText.includes('写本周周报'),
    })`);
    record('compositionend 后合并为一次查询并显示结果', imeAfter.count === 1 && imeAfter.showsTarget, JSON.stringify(imeAfter));

    await evaluate(`(() => {
      const el = document.querySelector('#task-search');
      window.__FD_FILTER_COUNT__ = 0;
      window.__FD_FILTER_LAST_KEY__ = undefined;
      window.__FD_LAST_FILTERED_LEN__ = null;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '产品');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    })()`);
    await sleep(140);
    const enterRes = await evaluate(`({ len: window.__FD_LAST_FILTERED_LEN__, count: window.__FD_FILTER_COUNT__ })`);
    record('Enter 立即执行搜索（不等防抖窗口）', enterRes.count === 1 && enterRes.len === 1, JSON.stringify(enterRes));

    await evaluate(`(() => {
      const el = document.querySelector('#task-search');
      window.__FD_FILTER_COUNT__ = 0;
      window.__FD_FILTER_LAST_KEY__ = undefined;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await sleep(160);
    const clearRes = await evaluate(`({ len: window.__FD_LAST_FILTERED_LEN__, total: window.__FD_STATE__.tasks.length, count: window.__FD_FILTER_COUNT__ })`);
    record('清空搜索立即恢复完整列表', clearRes.len === clearRes.total && clearRes.count >= 1, JSON.stringify(clearRes));

    // R3：Dashboard 聚合统计随新建/删除即时更新
    await go('/today');
    await sleep(500);
    const statsBefore = await evaluate(`JSON.parse(document.querySelector('[data-fd-stats]').getAttribute('data-fd-stats'))`);
    await evaluate(`(() => { const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '新建任务' || b.textContent.trim() === '新建'); btn && btn.click(); return true; })()`);
    await sleep(350);
    await setInput('#task-title', 'R3 聚合校验任务');
    await sleep(120);
    await clickText('添加任务');
    await sleep(800);
    const statsAfter = await evaluate(`JSON.parse(document.querySelector('[data-fd-stats]').getAttribute('data-fd-stats'))`);
    record(
      '新建今日任务后 Dashboard 统计即时更新',
      statsAfter.total === statsBefore.total + 1 && statsAfter.open === statsBefore.open + 1,
      JSON.stringify({ before: statsBefore, after: statsAfter })
    );

    await go('/tasks');
    await sleep(400);
    const r3DelOk = await evaluate(`(() => {
      const btn = [...document.querySelectorAll('button[aria-label="删除任务"]')]
        .find((b) => (b.closest('.group')?.textContent || '').includes('R3 聚合校验任务'));
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
    await sleep(300);
    await evaluate(`(() => { const b = document.querySelector('[data-fd-confirm-ok="1"]'); if (!b) return false; b.click(); return true; })()`);
    await sleep(700);
    await go('/today');
    await sleep(500);
    const statsRestored = await evaluate(`JSON.parse(document.querySelector('[data-fd-stats]').getAttribute('data-fd-stats'))`);
    record(
      '删除任务后 Dashboard 统计同步回落',
      r3DelOk && statsRestored.total === statsBefore.total && statsRestored.open === statsBefore.open,
      JSON.stringify(statsRestored)
    );

    console.log('\n[8] 截图');
    await setViewport(1440, 900, 1);
    for (const [route, name] of [
      ['/today', 'desktop-today'],
      ['/tasks', 'desktop-tasks'],
      ['/calendar', 'desktop-calendar'],
      ['/habits', 'desktop-habits'],
      ['/assistant', 'desktop-assistant'],
      ['/settings', 'desktop-settings'],
    ]) {
      await go(route);
      await screenshot(name);
      console.log('  · ' + name + '.png');
    }
    await setViewport(768, 1024, 1);
    await go('/today');
    await screenshot('tablet-today');
    await setViewport(1440, 900, 1);
    // 深色模式（Apple 黑 + 玻璃）截图：通过设置页真实切换
    await go('/settings');
    await clickText('深色', 'button', true);
    await sleep(400);
    await go('/today');
    await screenshot('desktop-today-dark');
    await go('/settings');
    await clickText('浅色', 'button', true);
    await sleep(400);
    await go('/today');
    await setViewport(390, 844, 2);
    for (const [route, name] of [
      ['/today', 'mobile-today'],
      ['/assistant', 'mobile-assistant'],
      ['/tasks', 'mobile-tasks'],
    ]) {
      await go(route);
      await screenshot(name);
      console.log('  · ' + name + '.png');
    }

    const passed = results.filter((r) => r.pass).length;
    const failed = results.length - passed;
    const report = {
      generatedAt: new Date().toISOString(),
      browser: version.Browser,
      baseUrl: BASE,
      viewportTested: ['1440x900', '390x844'],
      total: results.length,
      passed,
      failed,
      consoleErrors,
      results,
    };
    fs.writeFileSync(path.join(OUT_DIR, 'e2e-report.json'), JSON.stringify(report, null, 2), 'utf8');
    console.log(`\nE2E 结果：${passed} 通过 / ${failed} 失败（共 ${results.length} 项）`);
    await cdp.send('Browser.close').catch(() => {});
    if (failed > 0) process.exitCode = 1;
  } finally {
    try {
      edge.kill();
    } catch {
      /* ignore */
    }
  }
})().catch((e) => {
  console.error('E2E FAILED:', e.message);
  process.exit(1);
});
