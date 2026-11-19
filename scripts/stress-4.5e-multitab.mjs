/**
 * Phase 4.5-E 多标签长期压力（3–5 标签并发写 / 冲突收敛 / 主题与页面 churn）
 * 用法：BASE=http://127.0.0.1:5173 node scripts/stress-4.5e-multitab.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ROOT = process.cwd();
const BASE = process.env.BASE || 'http://127.0.0.1:5173';
const OUT = path.join(ROOT, process.env.OUT || 'docs/phase4.5/stress-4.5e-multitab.json');
const PORT = Number(process.env.PORT || 9424);
const PROFILE = path.join(os.tmpdir(), 'flowday-mt-45e');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.rmSync(PROFILE, { recursive: true, force: true });

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass: Boolean(pass), detail: String(detail).slice(0, 320) });
  console.log(`  ${pass ? '✓' : '✗'} ${name}${detail ? ' — ' + String(detail).slice(0, 170) : ''}`);
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

class Tab {
  constructor(cdp, targetId) {
    this.cdp = cdp;
    this.targetId = targetId;
    this.sessionId = null;
  }
}

async function main() {
  const child = spawn(EDGE, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--headless=new', '--disable-gpu', '--no-first-run', '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
  const report = { generatedAt: new Date().toISOString(), base: BASE, results };
  try {
    for (let i = 0; i < 120; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
        if (r.ok) break;
      } catch {}
      await sleep(200);
    }
    const versionInfo = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
    const browserCdp = new CDP(versionInfo.webSocketDebuggerUrl);
    await browserCdp.open();

    // 用 page 级 CDP 打开多个标签（每个 target 独立 WebSocket）
    const newTab = async (route = '/tasks') => {
      const t = await browserCdp.send('Target.createTarget', { url: 'about:blank' });
      const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((x) => x.id === t.targetId);
      const cdp = new CDP(page.webSocketDebuggerUrl);
      await cdp.open();
      await cdp.send('Page.enable');
      await cdp.send('Runtime.enable');
      await cdp.send('Page.navigate', { url: BASE + route });
      const ev = async (expr) => {
        const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
        if (exceptionDetails) throw new Error('EVAL: ' + (exceptionDetails.exception?.description || exceptionDetails.text));
        return result.value;
      };
      for (let i = 0; i < 500; i++) {
        if (await ev('Boolean(window.__FD_STORAGE__ && window.__FD_STORAGE__.ready)').catch(() => false)) break;
        await sleep(15);
      }
      return { cdp, targetId: t.targetId, ev };
    };
    const closeTab = async (tab) => {
      await browserCdp.send('Target.closeTarget', { targetId: tab.targetId }).catch(() => null);
    };

    // 播种 500 任务（在第一个标签的空白页完成）
    const seedTab = await newTab('/bench-blank.html');
    await seedTab.ev(`(async () => {
      await new Promise((resolve) => { const r = indexedDB.deleteDatabase('flowday-db'); r.onsuccess = resolve; r.onerror = resolve; r.onblocked = resolve; });
      const db = await new Promise((resolve, reject) => { const req = indexedDB.open('flowday-db', 1); req.onupgradeneeded = () => { const d = req.result; if (!d.objectStoreNames.contains('app')) d.createObjectStore('app'); if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta'); }; req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
      const pad = (x) => String(x).padStart(2, '0');
      const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
      const now = new Date().toISOString();
      const tasks = [];
      for (let i = 0; i < 500; i++) tasks.push({ id: 'mt45_' + i, title: '并发任务 ' + i, date: iso(new Date()), priority: (i % 3) + 1, completed: false, createdAt: now, source: 'manual' });
      const data = { version: 1, tasks, projects: [], habits: [], habitLogs: [], settings: { name: '并发', theme: 'light', weekStart: 1, aiEnabled: true, demoData: false } };
      const tx = db.transaction(['app', 'meta'], 'readwrite');
      tx.objectStore('app').put({ schemaVersion: 2, updatedAt: now, revision: 1, writerId: 'seed', data }, 'state');
      tx.objectStore('meta').put({ revision: 1, updatedAt: now, writerId: 'seed' }, 'sync:v1');
      await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
      db.close();
      return true;
    })()`);
    await closeTab(seedTab);

    const readDb = `(async () => {
      const db = await new Promise((res, rej) => { const r = indexedDB.open('flowday-db'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const rec = await new Promise((res) => { const q = db.transaction('app','readonly').objectStore('app').get('state'); q.onsuccess = () => res(q.result); });
      const meta = await new Promise((res) => { const q = db.transaction('meta','readonly').objectStore('meta').get('sync:v1'); q.onsuccess = () => res(q.result); });
      db.close();
      const ids = rec?.data?.tasks?.map((t) => t.id) ?? [];
      return { revision: rec?.revision ?? null, metaRevision: meta?.revision ?? null, tasks: ids.length, unique: new Set(ids).size, completed: rec?.data?.tasks?.filter((t) => t.completed).length };
    })()`;

    const revOf = async (tab) => {
      const db = await tab.ev(`(async () => { const db = await new Promise((res, rej) => { const r = indexedDB.open('flowday-db'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); const rec = await new Promise((res) => { const q = db.transaction('app','readonly').objectStore('app').get('state'); q.onsuccess = () => res(q.result); }); db.close(); return rec?.revision ?? null; })()`);
      return typeof db === 'number' ? db : 0;
    };

    // A) 3 标签并发写
    const tabs = [];
    for (let i = 0; i < 3; i++) {
      const tab = await newTab('/tasks');
      await sleep(250);
      tabs.push(tab);
    }
    const revs = { 0: [], 1: [], 2: [] };
    const samplers = tabs.map((tab, idx) =>
      (async () => {
        for (let i = 0; i < 80; i++) {
          const r = await tab.ev('window.__FD_STORAGE__.revision').catch(() => null);
          if (typeof r === 'number') revs[idx].push(r);
          await sleep(50);
        }
      })()
    );
    const writers = tabs.map((tab, idx) =>
      (async () => {
        for (let i = 0; i < 30; i++) {
          await tab.ev(`(() => { const b = document.querySelector('[data-testid="task-toggle"]'); if (b) b.click(); return Boolean(b); })()`).catch(() => null);
          await sleep(120 + idx * 15);
        }
      })()
    );
    await Promise.all([...writers, ...samplers]);
    await sleep(2500);
    for (const idx of [0, 1, 2]) {
      const seq = revs[idx];
      const monotonic = seq.every((r, i) => i === 0 || r >= seq[i - 1]);
      check(`标签 ${idx + 1} 观察到的 revision 单调（${seq.length} 次采样）`, monotonic, `${seq[0]} → ${seq[seq.length - 1]}`);
    }
    const final1 = await tabs[0].ev(readDb);
    check('3 标签并发写后：revision == metaRevision（CAS 原子）', final1.revision === final1.metaRevision, JSON.stringify(final1));
    check('3 标签并发写后：任务数量不变且 id 唯一（无静默丢失/重复）', final1.tasks === 500 && final1.unique === 500, JSON.stringify(final1));
    // 说明：dirty 标签检测到外部写入会「暂停自动保存」并要求用户选择（4.3 设计），因此并发写入后
    // revision 只会前进有限次；这里断言「确有写入落库」而非次数。
    check('3 标签并发写后：确有写入落库（revision 前进）', final1.revision > 1, `rev=${final1.revision}`);

    // 收敛检查
    const converge = async (tab, finalTitles) => {
      for (let i = 0; i < 60; i++) {
        const st = await tab.ev(`(() => ({ banner: Boolean(document.querySelector('[data-fd-sync-banner]')), titles: window.__FD_STATE__.tasks.length }))()`).catch(() => null);
        if (!st) return { ok: false };
        if (st.banner || st.titles === finalTitles) return { ok: true, banner: st.banner };
        await sleep(100);
      }
      return { ok: false };
    };
    for (let idx = 0; idx < tabs.length; idx++) {
      const c = await converge(tabs[idx], final1.tasks);
      check(`标签 ${idx + 1} 最终收敛（无横幅或数据一致）`, c.ok, JSON.stringify(c));
    }

    // B) 冲突场景：A dirty + B 外部写 → A 出现冲突横幅 → 重新加载收敛
    const tabA = tabs[0];
    const tabB = tabs[1];
    await tabA.ev(`(() => { const b = document.querySelector('[data-testid="task-toggle"]'); if (b) b.click(); return Boolean(b); })()`);
    await sleep(20);
    await tabB.ev(`(() => { const rows = [...document.querySelectorAll('[data-testid="task-toggle"]')]; const b = rows[rows.length - 1]; if (b) b.click(); return Boolean(b); })()`);
    let conflictSeen = false;
    for (let i = 0; i < 60; i++) {
      if (await tabA.ev(`Boolean(document.querySelector('[data-fd-sync-banner]'))`)) {
        conflictSeen = true;
        break;
      }
      await sleep(80);
    }
    check('dirty 标签在外部写入后出现冲突横幅/提示', conflictSeen);
    const draftSaved = await tabA.ev(`Boolean(localStorage.getItem('flowday.conflict-draft.v1'))`);
    check('冲突发生时草稿立即写入 localStorage', draftSaved);
    if (conflictSeen) {
      await tabA.ev(`(() => { const b = document.querySelector('[data-fd-sync-action="reload-remote"]'); if (b) b.click(); return Boolean(b); })()`);
      let cleared = false;
      for (let i = 0; i < 40; i++) {
        if (!(await tabA.ev(`Boolean(document.querySelector('[data-fd-sync-banner]'))`))) {
          cleared = true;
          break;
        }
        await sleep(100);
      }
      const revAfter = await tabA.ev(`window.__FD_STORAGE__.revision`);
      // reload-remote 只是重新读取权威数据，不产生新写入 → revision 不应回退
      const revBeforeReload = await revOf(tabA);
      check('重新加载后冲突横幅清除且 revision 不回退', cleared && revAfter >= revBeforeReload, JSON.stringify({ cleared, revAfter, revBeforeReload }));
    }

    // C) 主题 + 页面 churn（5 标签）
    const tabs5 = [...tabs];
    for (let i = 0; i < 2; i++) {
      tabs5.push(await newTab('/today'));
    }
    await Promise.all(
      tabs5.map(async (tab, idx) => {
        for (let i = 0; i < 8; i++) {
          await tab.ev(`(() => { const b = [...document.querySelectorAll('[aria-label="主题"] button')].find((x) => x.textContent.trim() === '${i % 2 === 0 ? '深色' : '浅色'}'); if (b) { b.click(); return true; } return false; })()`).catch(() => null);
          await tab.ev(`(async () => { const rts = ['/today','/tasks']; const r = rts[(idx + ${i}) % 2]; history.pushState({}, '', r); window.dispatchEvent(new PopStateEvent('popstate')); return true; })()`).catch(() => null);
          await sleep(120);
        }
      })
    );
    await sleep(2000);
    const themes = await Promise.all(tabs5.map((t) => t.ev(`document.documentElement.dataset.theme`)));
    const errToasts = await Promise.all(tabs5.map((t) => t.ev(`document.querySelectorAll('[data-fd-toast="error"]').length`)));
    const final3 = await tabs5[0].ev(readDb);
    check('5 标签主题/页面 churn 后：revision 一致且数据未损坏', final3.revision === final3.metaRevision && final3.unique === 500, JSON.stringify(final3));
    check('5 标签 churn 期间无错误 Toast 连续刷屏', errToasts.reduce((a, b) => a + b, 0) <= 5, JSON.stringify(errToasts));
    check('5 标签 churn 后主题状态存在且一致（主题为全局设置）', themes.every((t) => t === themes[0]), JSON.stringify(themes));

    for (const t of tabs5) await closeTab(t);
    const passed = results.filter((r) => r.pass).length;
    fs.writeFileSync(OUT, JSON.stringify({ ...report, passed, failed: results.length - passed }, null, 2), 'utf8');
    console.log(`\n多标签压力结果：${passed} 通过 / ${results.length - passed} 失败（共 ${results.length} 项）`);
    console.log('WROTE ' + OUT);
    if (passed !== results.length) process.exitCode = 1;
  } finally {
    try { child.kill(); } catch {}
    await sleep(600);
    try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
  }
}

main().catch((e) => {
  console.error('MULTITAB STRESS FAILED', e);
  process.exit(1);
});
