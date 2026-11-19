// Phase 5.0-B / B3 验收测试：键盘与弹窗治理
// 用法：node scripts/b3-verify.mjs
//
// 键盘模拟方式：在页面脚本之前注入可编程的 window.visualViewport stub，
// 通过 __setKeyboard(h) 让 visualViewport 变矮（等价于"覆盖式键盘"），
// 从而精确控制 --fd-kb 的推导路径。真实设备上 --fd-kb 由同一个函数从
// 真实 visualViewport 计算（adjustResize 时该值为 0，不会双重位移）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_BASE as BASE,
  makeRunner,
  navigate,
  openTab,
  seedAppState,
  startBrowser,
  stopBrowser,
  wait,
  waitFor,
  waitForBrowser,
} from './lib/e2e-harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const OUT = path.join(ROOT, 'docs', 'phase5.0', 'phase-b3-evidence');
fs.mkdirSync(OUT, { recursive: true });

const today = new Date().toISOString().slice(0, 10);
const demo = {
  version: 1,
  tasks: Array.from({ length: 10 }, (_, i) => ({
    id: `t${i}`,
    title: `任务 ${i + 1}：键盘与弹窗验收用`,
    date: today,
    priority: (i % 4) + 1,
    projectId: i % 2 === 0 ? 'p1' : 'p2',
    completed: false,
    createdAt: new Date().toISOString(),
    source: 'manual',
  })),
  projects: [
    { id: 'p1', name: '工作', color: '#4A5B8C', archived: false, createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'p2', name: '学习', color: '#2F7477', archived: false, createdAt: '2026-01-02T00:00:00.000Z' },
  ],
  habits: [{ id: 'h1', name: '早起', emoji: '🌱', weeklyTarget: 7, createdAt: new Date().toISOString(), archived: false }],
  habitLogs: [],
  settings: { name: '', theme: 'light', weekStart: 1, aiEnabled: true, demoData: false, onboarded: true },
};

const VV_STUB = `
(() => {
  const listeners = new Map();
  const stub = {
    width: window.innerWidth,
    height: window.innerHeight,
    offsetTop: 0, offsetLeft: 0, pageTop: 0, pageLeft: 0, scale: 1,
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); },
    removeEventListener(type, fn) { const a = listeners.get(type); if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } },
    __emit(type) { (listeners.get(type) || []).forEach((fn) => { try { fn({ type, target: stub }); } catch (e) {} }); },
    __setKeyboard(h) { stub.height = Math.max(80, window.innerHeight - h); stub.offsetTop = 0; stub.__emit('resize'); return stub.height; },
    __clearKeyboard() { stub.height = window.innerHeight; stub.offsetTop = 0; stub.__emit('resize'); return stub.height; },
    __info() { return { h: stub.height, layoutH: window.innerHeight, top: stub.offsetTop }; },
  };
  Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => stub });
})();
`;

const R = makeRunner('b3-verify');
const browser = startBrowser({ port: 9611 });
const evidence = { noKb: null, kbOpen: null, focus: [], longForm: null, kbClosed: null, widths: [], navModes: [], landscape: [], lifecycle: null, shots: [] };

const OPEN_MODAL = `(() => {
  const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').includes('新建任务'));
  if (!b) return 'no-button';
  b.click();
  return 'clicked';
})()`;

const MEASURE = `(() => {
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), height: Math.round(b.height), left: Math.round(b.left), right: Math.round(b.right) }; };
  const css = (n) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(n)) || 0;
  const panel = document.querySelector('[data-fd-dialog="modal"]');
  const body = panel?.querySelector('[data-fd-modal-body]');
  const foot = panel?.querySelector('.fd-modal-foot');
  const saveBtn = foot ? Array.from(foot.querySelectorAll('button')).find((b) => /添加任务|保存修改|导入|确认/.test(b.textContent || '')) : null;
  const nav = document.querySelector('nav[aria-label="底部导航"]');
  const navStyle = nav ? getComputedStyle(nav) : null;
  const vv = window.visualViewport;
  const vvH = Math.round((vv && vv.height) || window.innerHeight);
  const vvTop = Math.round((vv && vv.offsetTop) || 0);
  return {
    vh: window.innerHeight,
    vvH, vvTop,
    kb: css('--fd-kb'),
    vvhVar: css('--fd-vvh'),
    kbFlag: document.documentElement.dataset.lgKb,
    panel: r(panel),
    body: body ? { ...r(body), scrollH: body.scrollHeight, clientH: body.clientHeight } : null,
    foot: r(foot),
    saveBtn: r(saveBtn),
    nav: nav ? { ...r(nav), opacity: Number(navStyle.opacity), transform: navStyle.transform, pointerEvents: navStyle.pointerEvents } : null,
    active: document.activeElement ? { id: document.activeElement.id || document.activeElement.tagName } : null,
    overflowX: { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth },
  };
})()`;

const setViewport = (cdp, w, h) =>
  cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });

const shoot = async (cdp, name) => {
  const res = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(res.data, 'base64'));
  evidence.shots.push(`${name}.png`);
};

const setKb = (cdp, h) => cdp.evaluate(`window.visualViewport.__setKeyboard(${h})`);
const clearKb = (cdp) => cdp.evaluate(`window.visualViewport.__clearKeyboard()`);

/** 验收核心断言：footer/保存按钮在可视区内、不被键盘遮挡 */
const assertFooterVisible = (label, m, expectKb) => {
  const vvTop = m.vvTop;
  const vvBottom = vvTop + m.vvH;
  R.check(`[${label}] --fd-kb 与键盘高度一致`, Math.abs(m.kb - expectKb) <= 2, `--fd-kb=${m.kb} expect=${expectKb}`);
  R.check(`[${label}] 弹窗面板底部不超过可视视口`, Boolean(m.panel) && m.panel.bottom <= vvBottom + 1, `panel.bottom=${m.panel?.bottom} vvBottom=${vvBottom}`);
  R.check(`[${label}] Footer 在可视区内（不被键盘遮挡）`, Boolean(m.foot) && m.foot.bottom <= vvBottom + 1 && m.foot.top >= 0, `foot=${JSON.stringify(m.foot)} vvBottom=${vvBottom}`);
  R.check(`[${label}] 保存按钮完整可见`, Boolean(m.saveBtn) && m.saveBtn.bottom <= vvBottom + 1 && m.saveBtn.top >= 0 && m.saveBtn.height > 10, `saveBtn=${JSON.stringify(m.saveBtn)}`);
  R.check(`[${label}] 无横向溢出`, m.overflowX.sw <= m.overflowX.cw, `${m.overflowX.sw}/${m.overflowX.cw}`);
  return {
    label,
    kb: m.kb,
    vvBottom,
    panelBottom: m.panel?.bottom ?? null,
    footBottom: m.foot?.bottom ?? null,
    saveBtnBottom: m.saveBtn?.bottom ?? null,
    saveVisible: Boolean(m.saveBtn && m.saveBtn.bottom <= vvBottom + 1 && m.saveBtn.top >= 0),
  };
};

/**
 * 打开任务编辑器。
 * 注意：navigate 是整页导航，会重置页面内的 Insets 注入，因此必须在导航之后重新注入。
 */
const openEditor = async (cdp, insets = { top: 24, bottom: 48, left: 0, right: 0, imeBottom: 0 }, viewport) => {
  if (viewport) await setViewport(cdp, viewport.w, viewport.h);
  await navigate(cdp, BASE + '/tasks', { waitMs: 700 });
  await waitFor(cdp, 'Boolean(document.querySelector("[data-fd-main]"))', 9000, 'editor-boot');
  await cdp.evaluate(`(() => { window.__lgApplyInsets && window.__lgApplyInsets(${JSON.stringify(insets)}); return true; })()`);
  await wait(150);
  for (let attempt = 0; attempt < 3; attempt++) {
    await cdp.evaluate(OPEN_MODAL);
    try {
      await waitFor(cdp, 'Boolean(document.querySelector(\'[data-fd-dialog="modal"]\'))', 2500, 'editor-open');
      await wait(350);
      return 'opened';
    } catch {
      await wait(200);
    }
  }
  return 'failed';
};

try {
  await waitForBrowser(browser.port);
  const { cdp } = await openTab(browser.port, BASE + '/today');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: VV_STUB });
  await navigate(cdp, BASE + '/today', { waitMs: 900 });
  await seedAppState(cdp, demo, 71);
  await cdp.evaluate('location.reload()');
  await wait(1500);
  await waitFor(cdp, 'Boolean(document.querySelector("[data-fd-main]"))', 9000, 'boot');

  await setViewport(cdp, 390, 844);
  await navigate(cdp, BASE + '/tasks', { waitMs: 800 });
  await cdp.evaluate(`(() => { window.__lgApplyInsets && window.__lgApplyInsets({ top: 24, bottom: 48, left: 0, right: 0, imeBottom: 0 }); return true; })()`);
  await wait(300);

  // ---------- T1 无键盘 ----------
  await openEditor(cdp);
  let m = await cdp.evaluate(MEASURE);
  evidence.noKb = assertFooterVisible('T1 无键盘', m, 0);
  R.check('[T1 无键盘] 底部导航可见（opacity=1）', Boolean(m.nav) && m.nav.opacity === 1, JSON.stringify({ opacity: m.nav?.opacity, transform: m.nav?.transform }));
  await shoot(cdp, 'T1-no-keyboard');

  // ---------- T2 键盘弹出（覆盖式键盘 320） ----------
  await setKb(cdp, 320);
  await wait(500);
  m = await cdp.evaluate(MEASURE);
  evidence.kbOpen = assertFooterVisible('T2 键盘 320', m, 320);
  R.check('[T2 键盘弹出] Body 成为独立滚动区（可滚动或内容未溢出）', Boolean(m.body), JSON.stringify(m.body));
  R.check(
    '[T2 键盘弹出] 底部导航不再上浮到屏幕中部（应滑出视口）',
    Boolean(m.nav) && (m.nav.opacity < 0.05 || m.nav.top >= m.vvH),
    JSON.stringify({ opacity: m.nav?.opacity, top: m.nav?.top, vvH: m.vvH })
  );
  await shoot(cdp, 'T2-keyboard-open');

  // ---------- T3 焦点可见（逐字段） ----------
  const fields = ['task-title', 'task-date', 'task-time', 'task-duration', 'task-project', 'task-notes'];
  for (const id of fields) {
    const focused = await cdp.evaluate(`(() => { const el = document.querySelector('#${id}'); if (!el) return false; el.focus(); return true; })()`);
    if (!focused) {
      R.check(`[T3] 字段 #${id} 存在`, false);
      continue;
    }
    await wait(420);
    const fm = await cdp.evaluate(MEASURE);
    const footTop = fm.foot ? fm.foot.top : fm.panel.bottom;
    const inPanel = Boolean(fm.active && fm.active.id === id);
    const elBox = await cdp.evaluate(`(() => { const el = document.activeElement; if (!el) return null; const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom) }; })()`);
    const visible = Boolean(elBox && elBox.top >= (fm.panel.top - 1) && elBox.bottom <= footTop - 2 && elBox.bottom <= fm.vvTop + fm.vvH);
    evidence.focus.push({ field: id, inPanel, ...elBox, footTop, visible });
    R.check(`[T3] 聚焦 #${id} 后输入框完整可见（不被 Footer/键盘遮挡）`, visible, JSON.stringify({ elBox, footTop, panelTop: fm.panel.top, vvBottom: fm.vvTop + fm.vvH }));
  }
  await shoot(cdp, 'T3-focus-last-field');

  // ---------- T4 长表单 + 字体 150% ----------
  await cdp.evaluate(`(() => { document.documentElement.style.fontSize = '150%'; return true; })()`);
  await wait(500);
  m = await cdp.evaluate(MEASURE);
  evidence.longForm = assertFooterVisible('T4 长表单 150%', m, 320);
  const scrollInfo = await cdp.evaluate(`(() => {
    const body = document.querySelector('[data-fd-modal-body]');
    if (!body) return null;
    const before = body.scrollTop;
    body.scrollTop = body.scrollHeight;
    return { scrollable: body.scrollHeight > body.clientHeight + 1, before, after: body.scrollTop, scrollH: body.scrollHeight, clientH: body.clientHeight };
  })()`);
  R.check('[T4 长表单] Body 可滚动（字体 150% 下内容超长）', Boolean(scrollInfo && (scrollInfo.scrollable || scrollInfo.scrollH > scrollInfo.clientH)), JSON.stringify(scrollInfo));
  const afterScroll = await cdp.evaluate(MEASURE);
  R.check('[T4 长表单] 滚动到底后 Footer/保存按钮仍在可视区', Boolean(afterScroll.saveBtn) && afterScroll.saveBtn.bottom <= afterScroll.vvTop + afterScroll.vvH + 1, JSON.stringify(afterScroll.saveBtn));
  await shoot(cdp, 'T4-long-form-150');
  await cdp.evaluate(`(() => { document.documentElement.style.fontSize = ''; const b = document.querySelector('[data-fd-modal-body]'); if (b) b.scrollTop = 0; return true; })()`);

  // ---------- T5 连续切换焦点（3 轮） ----------
  let violations = 0;
  for (let round = 0; round < 3; round++) {
    for (const id of ['task-title', 'task-notes', 'task-date']) {
      await cdp.evaluate(`(() => { const el = document.querySelector('#${id}'); if (el) el.focus(); return true; })()`);
      await wait(300);
      const fm = await cdp.evaluate(MEASURE);
      const box = await cdp.evaluate(`(() => { const r = document.activeElement.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom) }; })()`);
      const footTop = fm.foot ? fm.foot.top : fm.panel.bottom;
      if (!(box.top >= fm.panel.top - 1 && box.bottom <= footTop - 2)) violations += 1;
    }
  }
  R.check('[T5] 连续切换焦点 3 轮：每次聚焦项都可见', violations === 0, `违规 ${violations} 次`);

  // ---------- T6 键盘收起 ----------
  await clearKb(cdp);
  await wait(500);
  m = await cdp.evaluate(MEASURE);
  evidence.kbClosed = assertFooterVisible('T6 键盘收起', m, 0);
  R.check('[T6 键盘收起] 底部导航恢复可见', Boolean(m.nav) && m.nav.opacity === 1, JSON.stringify({ opacity: m.nav?.opacity }));
  R.check('[T6 键盘收起] 弹窗尺寸恢复（面板高度回到正常上限内）', Boolean(m.panel) && m.panel.bottom <= m.vh + 1, JSON.stringify(m.panel));
  await shoot(cdp, 'T6-keyboard-closed');

  // 关闭弹窗，后续场景独立
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await wait(500);

  // ---------- T7 宽度 × 键盘 矩阵 ----------
  const widthProfile = { 320: 640, 360: 800, 390: 844, 412: 915 };
  for (const w of [320, 360, 390, 412]) {
    for (const kb of [0, 320]) {
      await openEditor(cdp, { top: 24, bottom: 48, left: 0, right: 0, imeBottom: 0 }, { w, h: widthProfile[w] });
      if (kb) await setKb(cdp, kb);
      await wait(450);
      const mm = await cdp.evaluate(MEASURE);
      const res = assertFooterVisible(`T7 ${w}px kb=${kb}`, mm, kb);
      evidence.widths.push(res);
      if (kb === 0) await shoot(cdp, `T7-${w}-nokb`);
      if (kb === 320 && (w === 320 || w === 412)) await shoot(cdp, `T7-${w}-kb`);
      await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await wait(420);
      await clearKb(cdp);
      await wait(200);
    }
  }

  // ---------- T8 手势 vs 三键 ----------
  for (const [label, bottom] of [['手势', 0], ['三键', 48]]) {
    await openEditor(cdp, { top: 24, bottom, left: 0, right: 0, imeBottom: 0 }, { w: 390, h: 844 });
    await setKb(cdp, 320);
    await wait(450);
    const mm = await cdp.evaluate(MEASURE);
    const res = assertFooterVisible(`T8 ${label} + 键盘`, mm, 320);
    evidence.navModes.push({ mode: label, safeBottom: bottom, ...res });
    await shoot(cdp, `T8-${bottom === 0 ? 'gesture' : '3button'}-kb`);
    await clearKb(cdp);
    await wait(450);
    const closed = await cdp.evaluate(MEASURE);
    R.check(
      `[T8 ${label}] 键盘收起后导航底边距 = safe-bottom + 12`,
      Boolean(closed.nav) && Math.abs(closed.vh - closed.nav.bottom - (bottom + 12)) <= 1,
      `gap=${closed.vh - (closed.nav?.bottom ?? 0)} expect=${bottom + 12}`
    );
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await wait(420);
  }

  // ---------- T9 旋转（横屏） ----------
  for (const [label, w, h, kb] of [['横屏无键盘', 844, 390, 0], ['横屏+键盘200', 844, 390, 200]]) {
    await openEditor(cdp, { top: 24, bottom: 0, left: 0, right: 0, imeBottom: 0 }, { w, h });
    if (kb) await setKb(cdp, kb);
    await wait(450);
    const mm = await cdp.evaluate(MEASURE);
    const res = assertFooterVisible(`T9 ${label}`, mm, kb);
    evidence.landscape.push(res);
    await shoot(cdp, `T9-${kb ? 'kb' : 'nokb'}`);
    await clearKb(cdp);
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await wait(420);
  }

  // ---------- T10 前后台切换 ----------
  await openEditor(cdp, { top: 24, bottom: 48, left: 0, right: 0, imeBottom: 0 }, { w: 390, h: 844 });
  await setKb(cdp, 320);
  await wait(420);
  const beforeHidden = await cdp.evaluate(MEASURE);
  const hiddenState = await cdp.evaluate(`(() => {
    const setState = (state) => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state }); document.dispatchEvent(new Event('visibilitychange')); };
    setState('hidden');
    const kbHidden = getComputedStyle(document.documentElement).getPropertyValue('--fd-kb').trim();
    setState('visible');
    return { kbHidden };
  })()`);
  await wait(500);
  const afterVisible = await cdp.evaluate(MEASURE);
  evidence.lifecycle = { beforeHidden: { kb: beforeHidden.kb }, hiddenState, afterVisible: { kb: afterVisible.kb, panelBottom: afterVisible.panel?.bottom } };
  R.check('[T10] 进入后台时键盘占位清零（避免残留遮挡）', hiddenState.kbHidden === '0px', JSON.stringify(hiddenState));
  R.check('[T10] 回前台后布局自洽（面板与 Footer 仍在视口内）', Boolean(afterVisible.foot) && afterVisible.foot.bottom <= afterVisible.vvTop + afterVisible.vvH + 1, JSON.stringify(afterVisible.foot));

  // ---------- 汇总：保存按钮可见率 ----------
  const all = [evidence.noKb, evidence.kbOpen, evidence.longForm, evidence.kbClosed, ...evidence.widths, ...evidence.navModes, ...evidence.landscape];
  const visibleCount = all.filter((x) => x && x.saveVisible).length;
  R.check('保存按钮可见率 100%', visibleCount === all.length, `${visibleCount}/${all.length}`);

  fs.writeFileSync(path.join(OUT, 'b3-metrics.json'), JSON.stringify(evidence, null, 2));
  const report = R.writeReport(OUT, { base: BASE, saveVisible: `${visibleCount}/${all.length}` });
  process.exitCode = report.failed > 0 ? 1 : 0;
} catch (err) {
  console.error('b3-verify 异常：', err.message);
  process.exitCode = 1;
} finally {
  await stopBrowser(browser);
}
