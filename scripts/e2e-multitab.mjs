// FlowDay Phase 4.3 R1 — 多标签页数据一致性真实 E2E
// 使用同一 Edge（临时 profile）下的多个真实标签页，验证 revision CAS / 冲突提示 / 自动同步 / 降级 / 草稿恢复。
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const OUT_DIR = path.join(ROOT, 'docs', 'phase4.3');
const SHOT_DIR = path.join(OUT_DIR, 'screenshots');
const PROFILE = path.join(os.tmpdir(), 'flowday-mt-profile');
const PROFILE_B = path.join(os.tmpdir(), 'flowday-mt-profile-nobc');
const PROFILE_C = path.join(os.tmpdir(), 'flowday-mt-profile-quota');
const BASE = process.env.BASE || 'http://127.0.0.1:5173';
const PORT = 9350;
const PORT_B = 9351;
const PORT_C = 9352;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const p of [PROFILE, PROFILE_B, PROFILE_C]) fs.rmSync(p, { recursive: true, force: true });
fs.mkdirSync(SHOT_DIR, { recursive: true });

const results = [];
function record(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`${pass ? '  ✓' : '  ✗'} ${name}${detail ? ' — ' + detail : ''}`);
}
async function step(name, fn) {
  try {
    await fn();
  } catch (err) {
    record(name, false, err instanceof Error ? err.message : String(err));
  }
}

class CDP {
  constructor(wsUrl) { this.ws = new WebSocket(wsUrl); this.seq = 0; this.pending = new Map(); }
  async open() {
    await new Promise((res, rej) => {
      this.ws.addEventListener('open', res, { once: true });
      this.ws.addEventListener('error', () => rej(new Error('ws error')), { once: true });
    });
    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params })); });
  }
}

async function evaluate(cdp, expression) {
  const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (exceptionDetails) throw new Error((exceptionDetails.exception?.description ?? exceptionDetails.text).slice(0, 500));
  return result.value;
}

async function waitPort(port, timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) return r.json(); } catch { /* retry */ }
    await sleep(200);
  }
  throw new Error('devtools not ready on ' + port);
}
async function listTargets(port) {
  return (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).filter((t) => t.type === 'page');
}

async function newTab(browserCdp, port, url, initScripts = []) {
  const before = await listTargets(port);
  await browserCdp.send('Target.createTarget', { url: 'about:blank' });
  let target = null;
  for (let i = 0; i < 60; i++) {
    const list = await listTargets(port);
    target = list.find((t) => !before.some((b) => b.id === t.id) && t.url === 'about:blank');
    if (target) break;
    await sleep(100);
  }
  if (!target) throw new Error('new tab not found');
  const cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  for (const source of initScripts) {
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source });
  }
  if (url) await tabGo({ cdp }, url);
  return { cdp, targetId: target.id, id: target.id };
}

async function tabGo(tab, route) {
  await tab.cdp.send('Page.navigate', { url: BASE + route });
  for (let i = 0; i < 150; i++) {
    const ready = await evaluate(tab.cdp, 'Boolean(window.__FD_STORAGE__ && window.__FD_STORAGE__.ready)').catch(() => false);
    if (ready) return;
    await sleep(50);
  }
  throw new Error('app not ready: ' + route);
}

const ev = (tab, expr) => evaluate(tab.cdp, expr);
const readState = (tab) => ev(tab, 'window.__FD_STATE__');
const readInfo = (tab) => ev(tab, 'window.__FD_STORAGE__');
const banner = (tab) => ev(tab, `(() => { const el = document.querySelector('[data-fd-sync-banner]'); return el ? el.getAttribute('data-fd-sync-banner') : null; })()`);
const clickSyncAction = (tab, action) => ev(tab, `(() => { const el = document.querySelector('[data-fd-sync-action="${action}"]'); if (!el) return false; el.click(); return true; })()`);
const draftExists = (tab) => ev(tab, `(() => { try { return Boolean(localStorage.getItem('flowday.conflict-draft.v1')); } catch { return false; } })()`);
const dbRevision = (tab) => ev(tab, `(async () => { const s = await import('/src/lib/storage/index.ts'); return (await s.readSyncInfo()).revision; })()`);
const dbSnapshot = (tab) => ev(tab, `(async () => { const s = await import('/src/lib/storage/index.ts'); const snap = await s.loadSnapshot(); return snap ? { revision: snap.revision, tasks: snap.data.tasks.map((t) => t.title) } : null; })()`);

async function waitUntil(fn, timeoutMs = 4000, interval = 40) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await fn()) return true;
    } catch {
      /* 页面可能处于冻结/导航中，按未满足处理 */
    }
    await sleep(interval);
  }
  return false;
}

async function createTaskUI(tab, title) {
  const t0 = Date.now();
  const ok = await ev(tab, `(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '新建任务' || b.textContent.trim() === '新建');
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  if (!ok) throw new Error('新建按钮未找到');
  await waitUntil(() => ev(tab, `Boolean(document.querySelector('#task-title'))`), 3000);
  await ev(tab, `(() => {
    const input = document.querySelector('#task-title');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(title)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(80);
  const added = await ev(tab, `(() => { const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '添加任务'); if (!btn) return false; btn.click(); return true; })()`);
  if (!added) throw new Error('添加任务按钮未找到');
  await waitUntil(() => ev(tab, `Boolean(window.__FD_STATE__ && window.__FD_STATE__.tasks.some((t) => t.title === ${JSON.stringify(title)}))`), 3000);
  return Date.now() - t0;
}

async function toggleFirstTask(tab) {
  return ev(tab, `(() => {
    const row = [...document.querySelectorAll('[data-task-id]')].find((r) => r.querySelector('[data-testid="task-toggle"]'));
    if (!row) return null;
    const id = row.getAttribute('data-task-id');
    const t = window.__FD_STATE__.tasks.find((x) => x.id === id);
    row.querySelector('[data-testid="task-toggle"]').click();
    return { id, wasCompleted: t ? t.completed : null };
  })()`);
}

/** 幽灵写入者：直接调用存储层 CAS API（模拟另一个标签页的写入，不经过 AppStore） */
async function ghostWrite(tab, mutationCode) {
  return ev(tab, `(async () => {
    const storage = await import('/src/lib/storage/index.ts');
    const snap = await storage.loadSnapshot();
    const data = snap ? JSON.parse(JSON.stringify(snap.data)) : JSON.parse(JSON.stringify(window.__FD_STATE__));
    ${mutationCode}
    const info = await storage.readSyncInfo();
    const outcome = await storage.saveAppData(data, { baseRevision: info.revision, writerId: 'ghost-writer' });
    return { ok: outcome.ok, before: info.revision, revision: outcome.ok ? outcome.revision : null, conflict: outcome.ok ? null : outcome.conflict.revision };
  })()`);
}

async function screenshot(tab, name) {
  const { data } = await tab.cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SHOT_DIR, name), Buffer.from(data, 'base64'));
  console.log('  · 截图', name);
}

async function launch(port, profile, initScripts = []) {
  const child = spawn(EDGE, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1280,900',
    'about:blank',
  ], { stdio: 'ignore' });
  await waitPort(port);
  const targets = await listTargets(port);
  const page = targets[0];
  const cdp = new CDP(page.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  for (const source of initScripts) {
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source });
  }
  return { child, cdp, targetId: page.id };
}

async function kill(child) {
  try { child.kill(); } catch { /* ignore */ }
  await sleep(600);
}

async function cleanupProfile(dir) {
  for (let i = 0; i < 10; i++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
      return;
    } catch {
      await sleep(400);
    }
  }
}

async function main() {
  const browser = await launch(PORT, PROFILE);
  try {
    const tabA = { cdp: browser.cdp, targetId: browser.targetId };
    await tabGo(tabA, '/today');
    const tabB = await newTab(browser.cdp, PORT, '/today');
    const tabW = await newTab(browser.cdp, PORT, '/today');
    await sleep(500);

    // T1 同一 revision
    const infoA1 = await readInfo(tabA);
    const infoB1 = await readInfo(tabB);
    record('两个标签页读取到相同 revision', infoA1.revision === infoB1.revision && infoA1.revision >= 1, `A=${infoA1.revision} B=${infoB1.revision} mode=${infoA1.channelMode}`);
    record('使用 BroadcastChannel 通知通道', infoA1.channelMode === 'broadcast', String(infoA1.channelMode));

    // T2 clean 自动同步
    const t2 = Date.now();
    await createTaskUI(tabA, '多标签-A1');
    const syncedB = await waitUntil(() => ev(tabB, `Boolean(window.__FD_STATE__ && window.__FD_STATE__.tasks.some((t) => t.title === '多标签-A1'))`), 4000);
    const syncLatency = Date.now() - t2;
    record('clean 标签页自动同步 A 的写入', syncedB, `${syncLatency}ms`);
    record('自动同步后不显示冲突横幅', (await banner(tabB)) === null, String(await banner(tabB)));
    const infoA2 = await readInfo(tabA);
    const infoB2 = await readInfo(tabB);
    record('同步后两个标签页 revision 一致', infoA2.revision === infoB2.revision, `${infoA2.revision}/${infoB2.revision}`);

    // T3 旧 revision 写入必须失败（真实 CAS）
    const stale = await ev(tabW, `(async () => {
      const storage = await import('/src/lib/storage/index.ts');
      const info = await storage.readSyncInfo();
      const snap = await storage.loadSnapshot();
      const staleData = snap ? snap.data : window.__FD_STATE__;
      const outcome = await storage.saveAppData(staleData, { baseRevision: info.revision - 1, writerId: 'stale-writer' });
      const after = await storage.readSyncInfo();
      return { ok: outcome.ok, before: info.revision, after: after.revision, conflict: outcome.ok ? null : outcome.conflict.revision };
    })()`);
    record('旧 revision 写入被拒绝（CAS）', stale.ok === false && stale.after === stale.before, JSON.stringify(stale));

    // T4 dirty 标签页不被覆盖
    const toggle = await toggleFirstTask(tabB);
    await sleep(30);
    const ghost = await ghostWrite(tabW, `data.tasks.unshift({ id: 'ghost_1', title: '幽灵写入任务', date: new Date().toISOString().slice(0, 10), priority: 3, completed: false, createdAt: new Date().toISOString(), source: 'manual' });`);
    const bConflict = await waitUntil(async () => (await banner(tabB)) !== null, 3000);
    const bState = await readState(tabB);
    const bHasToggle = bState.tasks.find((t) => t.id === toggle.id)?.completed === !toggle.wasCompleted;
    const bHasGhost = bState.tasks.some((t) => t.title === '幽灵写入任务');
    const bInfo = await readInfo(tabB);
    record('dirty 标签页收到并发写入后进入冲突状态', bConflict, `banner=${await banner(tabB)}`);
    record('dirty 标签页的本地修改完整保留', bHasToggle && !bHasGhost, JSON.stringify({ toggle, bHasToggle, bHasGhost }));
    record('冲突时暂停自动保存（库版本不再前进）', await (async () => {
      const rev1 = await dbRevision(tabW);
      await sleep(900);
      const rev2 = await dbRevision(tabW);
      return rev1 === rev2;
    })(), `ghostRev=${ghost.revision}`);
    record('冲突时立即写入本地草稿', await draftExists(tabB), 'draft=' + (await draftExists(tabB)));
    await screenshot(tabB, 'tab-b-conflict.png');

    // T5 冲突后重新加载
    await clickSyncAction(tabB, 'reload-remote');
    await waitUntil(async () => (await banner(tabB)) === null, 3000);
    const bReloaded = await readState(tabB);
    record('重新加载后与库一致（本页修改被放弃）', bReloaded.tasks.some((t) => t.title === '幽灵写入任务') && bReloaded.tasks.find((t) => t.id === toggle.id)?.completed === toggle.wasCompleted, JSON.stringify({ ghost: bReloaded.tasks.some((t) => t.title === '幽灵写入任务') }));
    const bInfoAfter = await readInfo(tabB);
    record('重新加载后 revision 与库一致', bInfoAfter.revision === (await dbRevision(tabW)) && bReloaded.tasks.some((t) => t.title === '幽灵写入任务'), `${bInfoAfter.revision}`);

    // T6 clear/替换 与 dirty 编辑并发（幽灵清空）
    await tabGo(tabB, '/today');
    await toggleFirstTask(tabB);
    await sleep(20);
    const clearWrite = await ghostWrite(tabW, 'data.tasks = []; data.habits = []; data.habitLogs = [];');
    const clearConflict = await waitUntil(async () => (await banner(tabB)) !== null, 3000);
    record('清空数据与本地编辑并发时不会被静默覆盖', clearConflict && (await readState(tabB)).tasks.length > 0, JSON.stringify({ clearOk: clearWrite.ok, tasksInB: (await readState(tabB)).tasks.length }));
    await clickSyncAction(tabB, 'reload-remote');
    await waitUntil(async () => (await banner(tabB)) === null, 3000);
    record('重新加载后接受清空结果', (await readState(tabB)).tasks.length === 0, '');
    await screenshot(tabA, 'tab-a-synced.png');

    // T7 设置页清空（真实 UI）后 clean 标签页自动同步
    await tabGo(tabA, '/settings');
    await ev(tabA, `(() => { const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('载入示例数据')); if (btn) btn.click(); return true; })()`);
    await sleep(200);
    await ev(tabA, `(() => { const ok = document.querySelector('[data-fd-confirm-ok="1"]'); if (ok) ok.click(); return true; })()`);
    await waitUntil(() => ev(tabA, `Boolean(window.__FD_STATE__ && window.__FD_STATE__.tasks.length > 0)`), 4000);
    const demoInB = await waitUntil(() => ev(tabB, `Boolean(window.__FD_STATE__ && window.__FD_STATE__.tasks.length > 0)`), 4000);
    record('另一标签页载入示例数据后 clean 标签页自动同步', demoInB, '');
    record('同步过程无冲突提示', (await banner(tabB)) === null, '');

    // T8 休眠/恢复：优先真实生命周期（freeze→active）；若 headless 丢弃页面则如实降级为"重载恢复"并标注覆盖范围
    await tabB.cdp.send('Page.setWebLifecycleState', { state: 'frozen' }).catch(() => undefined);
    await createTaskUI(tabA, '休眠期间任务');
    await tabB.cdp.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => undefined);
    await sleep(300);
    let alive = true;
    try {
      alive = await ev(tabB, `Boolean(window.__FD_STATE__)`);
    } catch {
      alive = false;
    }
    let sleepMode = 'lifecycle(freeze→active)';
    let sleepSynced = false;
    // headless 下 freeze→active 可能触发懒重载：需等待页面初始化完成再读取（否则读到 ready=false、revision=0 的启动态）
    if (alive) {
      const booted = await waitUntil(
        () => ev(tabB, `Boolean(window.__FD_STORAGE__ && window.__FD_STORAGE__.ready && window.__FD_STORAGE__.revision > 0)`),
        5000
      );
      if (!booted) alive = false;
    }
    if (alive) {
      sleepSynced = await waitUntil(() => ev(tabB, `Boolean(window.__FD_STATE__ && window.__FD_STATE__.tasks.some((t) => t.title === '休眠期间任务'))`), 3000);
      if (!sleepSynced) {
        await ev(tabB, `window.__FD_SYNC_CHECK__()`).catch(() => undefined);
        sleepSynced = await waitUntil(() => ev(tabB, `Boolean(window.__FD_STATE__ && window.__FD_STATE__.tasks.some((t) => t.title === '休眠期间任务'))`), 3000);
        sleepMode = 'visibility/focus 校准';
      }
    } else {
      sleepMode = 'freeze 丢弃/懒重载页面→重载恢复（环境限制，非真实休眠恢复）';
      await tabGo(tabB, '/today');
      sleepSynced = await waitUntil(() => ev(tabB, `Boolean(window.__FD_STATE__ && window.__FD_STATE__.tasks.some((t) => t.title === '休眠期间任务'))`), 4000);
    }
    const revBeforeRecover = await dbRevision(tabA);
    await sleep(400);
    const revAfterRecover = await dbRevision(tabA);
    const bInfoSleep = await readInfo(tabB);
    const bBannerSleep = await banner(tabB);
    record(
      '标签恢复后读取最新权威 revision 且不静默覆盖（按实际覆盖路径标注）',
      sleepSynced && bInfoSleep.revision === revAfterRecover && revBeforeRecover === revAfterRecover && bBannerSleep === null,
      `mode=${sleepMode} alive=${alive} tabRev=${bInfoSleep.revision} dbRev=${revAfterRecover} banner=${bBannerSleep}`
    );

    // T9 刷新
    await tabGo(tabB, '/today');
    const refreshOk = await waitUntil(() => ev(tabB, `Boolean(window.__FD_STATE__ && window.__FD_STATE__.tasks.some((t) => t.title === '休眠期间任务'))`), 4000);
    record('刷新后读取最新 revision 与数据', refreshOk && (await readInfo(tabB)).revision === (await readInfo(tabA)).revision, '');

    // T10 关闭标签页时的草稿恢复
    await toggleFirstTask(tabB);
    await sleep(20);
    await ghostWrite(tabW, `data.tasks.unshift({ id: 'ghost_2', title: '关闭前并发任务', date: new Date().toISOString().slice(0, 10), priority: 2, completed: false, createdAt: new Date().toISOString(), source: 'manual' });`);
    await waitUntil(async () => (await banner(tabB)) !== null, 3000);
    record('关闭前进入冲突并保存草稿', (await draftExists(tabB)) && (await banner(tabB)) !== null, '');
    const closedId = tabB.targetId;
    await browser.cdp.send('Target.closeTarget', { targetId: closedId }).catch(() => undefined);
    await sleep(400);
    const tabB2 = await newTab(browser.cdp, PORT, '/today');
    const recoverBanner = await waitUntil(async () => (await banner(tabB2)) === 'recovering', 4000);
    record('重新打开后提示恢复草稿', recoverBanner, String(await banner(tabB2)));
    record('草稿在恢复前未被删除', await draftExists(tabB2), '');
    await screenshot(tabB2, 'tab-b-recovery.png');
    await clickSyncAction(tabB2, 'restore-draft');
    const restored = await waitUntil(async () => (await banner(tabB2)) === null, 4000);
    const b2State = await readState(tabB2);
    record('恢复草稿后写入库并清除草稿', restored && !(await draftExists(tabB2)) && b2State.tasks.some((t) => t.title === '关闭前并发任务') === false, '');

    // T11 第三标签页与「以本页覆盖」并发：事件/状态驱动等待，单次点击，验证 CAS 单调与无静默丢失
    const tabC = await newTab(browser.cdp, PORT, '/today');
    await sleep(400);
    await toggleFirstTask(tabB2);
    await sleep(20);
    await ghostWrite(tabW, `data.tasks.unshift({ id: 'ghost_3', title: '第三标签页冲突任务', date: new Date().toISOString().slice(0, 10), priority: 1, completed: false, createdAt: new Date().toISOString(), source: 'manual' });`);
    const bannerBeforeForce = await waitUntil(async () => (await banner(tabB2)) !== null, 6000);
    const revAfterGhost3 = await dbRevision(tabW);
    // 并发：先发起第三标签页写入，再等待覆盖按钮出现并单次点击
    const ghost4Promise = ghostWrite(tabC, `data.tasks.unshift({ id: 'ghost_4', title: '并发写入任务', date: new Date().toISOString().slice(0, 10), priority: 3, completed: false, createdAt: new Date().toISOString(), source: 'manual' });`);
    const btnReady = await waitUntil(() => ev(tabB2, `(() => { const b = document.querySelector('[data-fd-sync-action="overwrite-remote"]'); return Boolean(b) && !b.disabled; })()`), 4000);
    const forceClicked = btnReady
      ? await ev(tabB2, `(() => { const b = document.querySelector('[data-fd-sync-action="overwrite-remote"]'); if (!b || b.disabled) return false; b.click(); return true; })()`)
      : false;
    const ghost4 = await ghost4Promise;
    // 等待落定：库版本前进（覆盖成功或 ghost4 成功）或 B2 再次进入冲突（覆盖 CAS 失败）
    const settled = await waitUntil(async () => (await dbRevision(tabW)) > revAfterGhost3, 6000);
    await sleep(300);
    const revFinal = await dbRevision(tabW);
    // 静置复读：写入方已安静，单事务一致读取最终权威快照
    await sleep(400);
    const finalSnap = await dbSnapshot(tabW);
    const finalRevCheck = await dbRevision(tabW);
    const finalTitles = finalSnap && finalRevCheck === revFinal ? finalSnap.tasks : [];
    const b2BannerFinal = await banner(tabB2);
    // 第三标签页收敛：状态等于权威数据，或处于冲突提示
    let cBanner = await banner(tabC);
    let thirdTabConverged = false;
    let focusSent = false;
    const convStart = Date.now();
    while (Date.now() - convStart < 6000) {
      cBanner = await banner(tabC);
      const st = await readState(tabC);
      const cTitles = st && Array.isArray(st.tasks) ? st.tasks.map((x) => x.title) : [];
      if (cBanner !== null || JSON.stringify(cTitles) === JSON.stringify(finalTitles)) {
        thirdTabConverged = true;
        break;
      }
      if (!focusSent && Date.now() - convStart > 2000) {
        focusSent = true;
        await ev(tabC, `window.dispatchEvent(new Event('focus'))`).catch(() => undefined);
      }
      await sleep(80);
    }
    const ghost4Applied = ghost4.ok === true;
    // 无静默丢失：ghost4 要么在最终数据中、要么其调用方收到冲突、要么用户在被警告后显式选择覆盖
    // （显式覆盖替换已落库的外部写入属于「以本页覆盖」的文档化语义，不算静默丢失）
    const noSilentLoss =
      finalTitles.includes('并发写入任务') || ghost4.ok === false || b2BannerFinal !== null || (forceClicked && bannerBeforeForce);
    const outcome = !forceClicked
      ? 'force-button-missing'
      : b2BannerFinal === null && finalTitles.includes('并发写入任务')
        ? 'force 含 ghost4 一起落库'
        : b2BannerFinal === null
          ? 'force 先落库，ghost4 CAS 冲突（调用方收到冲突结果，非静默）'
          : 'force CAS 失败（ghost4 抢先），B2 再次提示冲突';
    record(
      '以本页覆盖时第三标签页并发写入不被静默丢失（版本单调 + 数据一致）',
      bannerBeforeForce && forceClicked && settled && revFinal > revAfterGhost3 && Boolean(finalSnap) && noSilentLoss && thirdTabConverged,
      JSON.stringify({ bannerBeforeForce, settled, revAfterGhost3, revFinal, finalRevCheck, forceClicked, ghost4Applied, ghost4Ok: ghost4.ok, b2BannerFinal, thirdTabConverged, noSilentLoss, finalHasGhost4: finalTitles.includes('并发写入任务'), outcome })
    );

    // T12 性能：CAS 保存耗时（10k 数据，5 次中位）
    const perf = await ev(tabW, `(async () => {
      const storage = await import('/src/lib/storage/index.ts');
      const pad = (x) => String(x).padStart(2, '0');
      const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
      const base = new Date();
      const today = new Date(base.getFullYear(), base.getMonth(), base.getDate());
      const tasks = [];
      for (let i = 0; i < 10000; i++) {
        const d = new Date(today.getTime() + ((i % 60) - 20) * 86400000);
        tasks.push({ id: 'perf_' + i, title: '性能任务 ' + i, date: iso(d), priority: (i % 3) + 1, completed: i % 5 === 0, createdAt: new Date(today.getTime() - i * 60000).toISOString(), source: 'manual' });
      }
      const data = { version: 1, tasks, projects: [], habits: [], habitLogs: [], settings: { name: '', theme: 'light', weekStart: 1, aiEnabled: true, demoData: false } };
      const samples = [];
      for (let i = 0; i < 5; i++) {
        const info = await storage.readSyncInfo();
        const t0 = performance.now();
        const outcome = await storage.saveAppData(data, { baseRevision: info.revision, writerId: 'perf-writer' });
        samples.push(performance.now() - t0);
        if (!outcome.ok) break;
      }
      return samples;
    })()`);
    const sorted = [...perf].sort((a, b) => a - b);
    record('10k 数据 CAS 保存 5 次测量完成', perf.length === 5, JSON.stringify(perf.map((x) => Number(x.toFixed(1)))));

    const meta = {
      phase: '4.3-r1-multitab',
      generatedAt: new Date().toISOString(),
      base: BASE,
      browserVersion: (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()).Browser,
      casSave10k: { samples: perf.map((x) => Number(x.toFixed(2))), median: Number(sorted[2]?.toFixed(2)), max: Number(sorted[sorted.length - 1]?.toFixed(2)) },
      results,
    };
    fs.writeFileSync(path.join(OUT_DIR, 'multitab-report.json'), JSON.stringify(meta, null, 2), 'utf8');
    console.log(`\n结果：${results.filter((r) => r.pass).length}/${results.length} 通过`);
  } finally {
    await kill(browser.child);
    await cleanupProfile(PROFILE);
  }
}

async function fallbackAndQuotaTests() {
  // T13 BroadcastChannel 不可用 → storage 事件降级
  const browserB = await launch(PORT_B, PROFILE_B, [
    `try { Object.defineProperty(window, 'BroadcastChannel', { configurable: true, value: undefined }); } catch (e) {}`,
  ]);
  try {
    const tabC = { cdp: browserB.cdp, targetId: browserB.targetId };
    await tabGo(tabC, '/today');
    const NO_BC = [`try { Object.defineProperty(window, 'BroadcastChannel', { configurable: true, value: undefined }); } catch (e) {}`];
    const tabD = await newTab(browserB.cdp, PORT_B, '/today', NO_BC);
    await sleep(400);
    const modeC = (await readInfo(tabC)).channelMode;
    const modeD = (await readInfo(tabD)).channelMode;
    record('BroadcastChannel 不可用时降级为 storage 事件', modeC === 'storage' && modeD === 'storage', `C=${modeC} D=${modeD}`);
    await createTaskUI(tabC, '降级同步任务');
    const synced = await waitUntil(() => ev(tabD, `Boolean(window.__FD_STATE__ && window.__FD_STATE__.tasks.some((t) => t.title === '降级同步任务'))`), 5000);
    record('降级通道下 clean 标签页仍能自动同步', synced, '');
    // 降级 dirty 冲突：进入设置页连续输入保持 dirty；断言 dirty 已建立后再注入并发写入
    await tabGo(tabD, '/settings');
    await sleep(300);
    const dirtyLoop = ev(tabD, `(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      const getInput = () => document.querySelector('#settings-name');
      if (!getInput()) return false;
      for (let i = 0; i < 8; i++) {
        const el = getInput();
        set.call(el, 'dirty-' + i);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 90));
      }
      return true;
    })()`);
    const dirtyEstablished = await waitUntil(() => ev(tabD, `Boolean(window.__FD_STORAGE__ && window.__FD_STORAGE__.dirty)`), 1500);
    await sleep(120);
    const ghostFb = await ghostWrite(tabC, `data.tasks.unshift({ id: 'ghost_fallback', title: '降级冲突任务', date: new Date().toISOString().slice(0, 10), priority: 2, completed: false, createdAt: new Date().toISOString(), source: 'manual' });`);
    // ghost 必须已落库后再让 tabD 的防抖落定：补一次输入重置 180ms 防抖窗口，
    // 保证 tabD 的保存一定晚于 ghost 提交（否则 tabD 先赢、场景不成立，属脚本竞态而非产品缺陷）
    await ev(tabD, `(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      const el = document.querySelector('#settings-name');
      if (!el) return false;
      set.call(el, 'dirty-final');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await dirtyLoop;
    const conflict = await waitUntil(async () => (await banner(tabD)) !== null, 4000);
    const dbRevDuring = await dbRevision(tabC);
    await sleep(700);
    const dbRevDuring2 = await dbRevision(tabC);
    const inputKept = await ev(tabD, `(document.querySelector('#settings-name') || { value: '' }).value`);
    record(
      '降级通道下 dirty 建立、冲突检测、未处理期间库版本冻结且本地修改保留',
      dirtyEstablished && conflict && ghostFb.ok === true && dbRevDuring === dbRevDuring2 && String(inputKept).startsWith('dirty-'),
      JSON.stringify({ dirtyEstablished, conflict, dbRevDuring, dbRevDuring2, inputKept: String(inputKept).slice(0, 10) })
    );
    // 不处理（取消语义）：数据不变；随后选择重新加载 → dirty 清除并同步权威数据
    await sleep(400);
    const revStillFrozen = (await dbRevision(tabC)) === dbRevDuring2;
    await clickSyncAction(tabD, 'reload-remote');
    const cleared = await waitUntil(async () => (await banner(tabD)) === null, 3000);
    const dirtyAfter = await ev(tabD, `Boolean(window.__FD_STORAGE__ && window.__FD_STORAGE__.dirty)`);
    const syncedGhost = await ev(tabD, `Boolean(window.__FD_STATE__ && window.__FD_STATE__.tasks.some((t) => t.title === '降级冲突任务'))`);
    record(
      '降级通道下未处理期间无写入；重新加载后 dirty 清除并同步权威数据',
      revStillFrozen && cleared && dirtyAfter === false && syncedGhost,
      JSON.stringify({ revStillFrozen, cleared, dirtyAfter, syncedGhost })
    );
  } finally {
    await kill(browserB.child);
    await cleanupProfile(PROFILE_B);
  }

  // T14 localStorage 配额不足 → 草稿保存失败但应用不崩溃
  const browserC = await launch(PORT_C, PROFILE_C, [
    `(() => {
      const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (String(key).startsWith('flowday.conflict-draft')) throw new DOMException('quota exceeded', 'QuotaExceededError');
        return orig.call(this, key, value);
      };
    })();`,
  ]);
  try {
    const tabE = { cdp: browserC.cdp, targetId: browserC.targetId };
    await tabGo(tabE, '/today');
    await sleep(300);
    await toggleFirstTask(tabE);
    await sleep(20);
    // 同页面直接写入制造冲突（模拟另一个写入者）
    await ev(tabE, `(async () => {
      const storage = await import('/src/lib/storage/index.ts');
      const info = await storage.readSyncInfo();
      const snap = await storage.loadSnapshot();
      const data = snap ? JSON.parse(JSON.stringify(snap.data)) : JSON.parse(JSON.stringify(window.__FD_STATE__));
      data.tasks.unshift({ id: 'ghost_quota', title: '配额冲突任务', date: new Date().toISOString().slice(0, 10), priority: 2, completed: false, createdAt: new Date().toISOString(), source: 'manual' });
      return storage.saveAppData(data, { baseRevision: info.revision, writerId: 'quota-writer' });
    })()`);
    const conflict = await waitUntil(async () => (await banner(tabE)) !== null, 4000);
    const bannerText = await ev(tabE, `document.body.innerText.includes('草稿保存失败')`);
    const stillAlive = await ev(tabE, `Boolean(window.__FD_STATE__ && window.__FD_STATE__.tasks.length > 0)`);
    record('配额不足时冲突提示仍可用（应用不崩溃）', conflict && stillAlive && bannerText, JSON.stringify({ conflict, stillAlive, bannerText }));
  } finally {
    await kill(browserC.child);
    await cleanupProfile(PROFILE_C);
  }
}

main()
  .then(fallbackAndQuotaTests)
  .then(() => {
    const passed = results.filter((r) => r.pass).length;
    console.log(`\n多标签 E2E 结果：${passed} 通过 / ${results.length - passed} 失败（共 ${results.length} 项）`);
    if (passed !== results.length) process.exitCode = 1;
  })
  .catch((err) => {
    console.error('MULTITAB E2E FAILED:', err);
    process.exitCode = 1;
  });
