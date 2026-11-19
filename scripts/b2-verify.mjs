// Phase 5.0-B / B2 验收测试：Insets 交付模型 + 响应式布局几何
// 用法：node scripts/b2-verify.mjs
// 说明：全部为 Chromium 模拟（含"原生桥"mock），不等同真机；真机项见 B2 报告 §真机。
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
const OUT = path.join(ROOT, 'docs', 'phase5.0', 'phase-b2-evidence');
fs.mkdirSync(OUT, { recursive: true });

const today = new Date().toISOString().slice(0, 10);
const demo = {
  version: 1,
  tasks: Array.from({ length: 14 }, (_, i) => ({
    id: `t${i}`,
    title: `任务条目 ${i + 1}：用于验证底部导航与内容预留的测量条目`,
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

/** 模拟原生桥：只在 JS 主动请求时才回包（复刻 B1-01 的"推送早于钩子"场景）。 */
const MOCK_BRIDGE = `
(() => {
  const payload = { top: 24, bottom: 48, left: 0, right: 0, imeBottom: 0 };
  window.__mockInsetsCalls = 0;
  window.__mockFirstDelayMs = 800;      // 首次回包故意延迟，模拟原生缓存晚于 JS 就绪
  window.__mockPayload = payload;
  window.__mockActive = true;
  window.FlowDayNative = {
    requestInsets: function () {
      window.__mockInsetsCalls += 1;
      const stored = Number(localStorage.getItem('__mockTotal') || '0') + 1;
      localStorage.setItem('__mockTotal', String(stored));
      const delay = window.__mockInsetsCalls === 1 ? window.__mockFirstDelayMs : 30;
      setTimeout(function () {
        if (window.__mockActive !== false && typeof window.__lgApplyInsets === 'function') {
          window.__lgApplyInsets(window.__mockPayload);
          window.__mockApplied = (window.__mockApplied || 0) + 1;
          localStorage.setItem('__mockAppliedTotal', String((Number(localStorage.getItem('__mockAppliedTotal') || '0')) + 1));
        }
      }, delay);
    },
    setDark: function () {},
  };
})();
`;

const R = makeRunner('b2-verify');
const browser = startBrowser({ port: 9601 });

const READ = `(() => {
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right), w: Math.round(b.width), h: Math.round(b.height) }; };
  const nav = document.querySelector('nav[aria-label="底部导航"]');
  const header = document.querySelector('header');
  const main = document.querySelector('main');
  const root = document.documentElement;
  const cs = getComputedStyle(root);
  const navH = Math.round(nav ? nav.getBoundingClientRect().height : 0);
  const nodes = Array.from(document.querySelectorAll('main section, main .group, main button, main a'));
  let contentBottom = 0;
  for (const n of nodes) {
    const b = n.getBoundingClientRect();
    if (b.height > 4 && b.bottom > contentBottom) contentBottom = b.bottom;
  }
  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    safe: {
      top: parseFloat(cs.getPropertyValue('--lg-safe-top')) || 0,
      bottom: parseFloat(cs.getPropertyValue('--lg-safe-bottom')) || 0,
      left: parseFloat(cs.getPropertyValue('--lg-safe-left')) || 0,
      right: parseFloat(cs.getPropertyValue('--lg-safe-right')) || 0,
      ime: parseFloat(cs.getPropertyValue('--lg-ime')) || 0,
    },
    navH: parseFloat(cs.getPropertyValue('--fd-nav-h')) || navH,
    gap: parseFloat(cs.getPropertyValue('--fd-nav-gap')) || 12,
    nav: r(nav),
    header: r(header),
    mainPadBottom: parseFloat(getComputedStyle(main).paddingBottom) || 0,
    contentBottom: Math.round(contentBottom),
    overflowX: { sw: root.scrollWidth, cw: root.clientWidth },
    calls: window.__mockInsetsCalls || 0,
    appliedTotal: Number(localStorage.getItem('__mockAppliedTotal') || '0'),
    totalRequests: Number(localStorage.getItem('__mockTotal') || '0'),
    docScrollY: Math.round(window.scrollY),
    docScrollH: document.scrollingElement.scrollHeight,
  };
})()`;

const scrollEnd = `window.scrollTo(0, document.scrollingElement.scrollHeight); true;`;
const scrollTop = `window.scrollTo(0, 0); true;`;

const setViewport = (cdp, w, h) =>
  cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });

const shoot = async (cdp, name) => {
  const res = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(res.data, 'base64'));
};

const evidence = { handshake: {}, core: [], responsive: [], navHeight: {} };

/** 核心几何断言：内容不被应用导航遮挡 + 头部/底栏安全区公式正确 */
const assertGeometry = (label, m) => {
  const occlusion = m.contentBottom - (m.nav ? m.nav.top : 0);
  const navBottomGap = m.viewport.h - (m.nav ? m.nav.bottom : 0);
  const headerTop = m.header ? m.header.top : -1;
  const expectedReserve = m.navH + m.gap * 2 + m.safe.bottom + m.safe.ime + 8;
  R.check(`[${label}] 内容未被底部导航遮挡（遮挡 ≤ 0）`, occlusion <= 0, `遮挡=${occlusion}px contentBottom=${m.contentBottom} navTop=${m.nav?.top}`);
  R.check(`[${label}] 末尾内容与导航之间保留呼吸空间（≥ 8px）`, -occlusion >= 8, `间距=${-occlusion}px`);
  R.check(`[${label}] 头部让开状态栏（top = safe-top + 12）`, Math.abs(headerTop - (m.safe.top + 12)) <= 1, `headerTop=${headerTop} expect=${m.safe.top + 12}`);
  R.check(`[${label}] 底部导航让开系统导航栏（bottom gap = safe-bottom + 12）`, Math.abs(navBottomGap - (m.safe.bottom + m.gap)) <= 1, `gap=${navBottomGap} expect=${m.safe.bottom + m.gap}`);
  R.check(`[${label}] 内容预留 = navH + 2×gap + safe + ime + 8`, Math.abs(m.mainPadBottom - expectedReserve) <= 2, `reserve=${m.mainPadBottom} expect=${expectedReserve}`);
  R.check(`[${label}] 无横向溢出`, m.overflowX.sw <= m.overflowX.cw, `${m.overflowX.sw}/${m.overflowX.cw}`);
  return { occlusion, navBottomGap, headerTop, reserve: m.mainPadBottom, expectedReserve, safe: m.safe, navH: m.navH };
};

try {
  await waitForBrowser(browser.port);
  const { cdp } = await openTab(browser.port, BASE + '/today');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: MOCK_BRIDGE });

  // ---------- 1. 握手：首次回包延迟 800ms，仍必须最终生效（B1-01 修复验证） ----------
  await navigate(cdp, BASE + '/today', { waitMs: 1500 });
  await cdp.evaluate('localStorage.removeItem("__mockTotal"); localStorage.removeItem("__mockAppliedTotal")').catch(() => {});
  await navigate(cdp, BASE + '/today', { waitMs: 1800 });
  await wait(1200);
  const handshake = await cdp.evaluate(READ);
  evidence.handshake.afterBoot = { calls: handshake.calls, appliedTotal: handshake.appliedTotal, safe: handshake.safe };
  R.check('握手：JS 启动时主动向原生拉取 Insets', handshake.calls >= 1, `calls=${handshake.calls}`);
  R.check('握手：原生迟到回包（800ms）仍被应用（safe-top 生效）', handshake.safe.top === 24 && handshake.safe.bottom === 48, JSON.stringify(handshake.safe));

  // ---------- 2. 重载：页面 reload 后必须重新拉取并恢复安全区（B1-01 第二半） ----------
  const beforeReload = Number(await cdp.evaluate('localStorage.getItem("__mockTotal") || "0"'));
  await cdp.evaluate('location.reload()');
  await wait(1800);
  await waitFor(cdp, 'Boolean(document.querySelector("[data-fd-main]"))', 9000, 'reload');
  await wait(900);
  const afterReload = await cdp.evaluate(READ);
  const totalAfter = Number(await cdp.evaluate('localStorage.getItem("__mockTotal") || "0"'));
  evidence.handshake.afterReload = { beforeReload, totalAfter, safe: afterReload.safe };
  R.check('重载：页面刷新后重新向原生拉取（请求数增加）', totalAfter > beforeReload, `${beforeReload} → ${totalAfter}`);
  R.check('重载：刷新后安全区变量恢复（非冻结为 0）', afterReload.safe.top === 24 && afterReload.safe.bottom === 48, JSON.stringify(afterReload.safe));

  // ---------- 3. 回前台：visibilitychange 必须重新拉取 ----------
  const beforeForeground = Number(await cdp.evaluate('localStorage.getItem("__mockTotal") || "0"'));
  await cdp.evaluate(`(() => { document.dispatchEvent(new Event('visibilitychange')); return true; })()`);
  await wait(600);
  const afterForeground = Number(await cdp.evaluate('localStorage.getItem("__mockTotal") || "0"'));
  evidence.handshake.afterForeground = { beforeForeground, afterForeground };
  R.check('回前台：visibilitychange 触发重新拉取', afterForeground > beforeForeground, `${beforeForeground} → ${afterForeground}`);

  // ---------- 4. 四组核心场景几何 ----------
  await setViewport(cdp, 390, 844);
  await seedAppState(cdp, demo, 51);
  await cdp.evaluate('location.reload()');
  await wait(1600);
  await waitFor(cdp, 'Boolean(document.querySelector("[data-fd-main]"))', 9000, 'boot2');

  const scenarios = [
    { key: 'S1-无Insets', insets: { top: 0, bottom: 0, left: 0, right: 0, imeBottom: 0 }, font: '100' },
    { key: 'S2-手势导航', insets: { top: 24, bottom: 0, left: 0, right: 0, imeBottom: 0 }, font: '100' },
    { key: 'S3-三键导航', insets: { top: 24, bottom: 48, left: 0, right: 0, imeBottom: 0 }, font: '100' },
    { key: 'S4-三键+字体150%', insets: { top: 24, bottom: 48, left: 0, right: 0, imeBottom: 0 }, font: '150' },
  ];

  for (const sc of scenarios) {
    await setViewport(cdp, 390, 844);
    await navigate(cdp, BASE + '/tasks', { waitMs: 800 });
    // 删除 mock 原生桥：本轮以显式注入值作为"设备 Insets"唯一来源
    await cdp.evaluate(`(() => { window.__mockActive = false; try { delete window.FlowDayNative; } catch (e) { window.FlowDayNative = undefined; } return true; })()`);
    await cdp.evaluate(`(() => { window.__lgApplyInsets && window.__lgApplyInsets(${JSON.stringify(sc.insets)}); document.documentElement.style.fontSize = ${sc.font === '100' ? "''" : `'${sc.font}%'`}; return true; })()`);
    await wait(400);
    await cdp.evaluate(scrollEnd);
    await wait(450);
    const m = await cdp.evaluate(READ);
    R.check(
      `[${sc.key}] 安全区变量与本次注入一致`,
      m.safe.top === sc.insets.top && m.safe.bottom === sc.insets.bottom && m.safe.left === sc.insets.left && m.safe.right === sc.insets.right,
      JSON.stringify(m.safe) + ' expect ' + JSON.stringify(sc.insets)
    );
    const geo = assertGeometry(sc.key, m);
    evidence.core.push({ scenario: sc.key, insets: sc.insets, font: sc.font, ...geo, contentBottom: m.contentBottom, navTop: m.nav.top });
    await shoot(cdp, `core-${sc.key.replace(/[^\w\u4e00-\u9fa5%-]/g, '_')}`);
    await cdp.evaluate(`document.documentElement.style.fontSize = ''`);
  }

  // ---------- 5. 导航高度实测随字体变化（--fd-nav-h 生效，非硬编码） ----------
  for (const font of ['100', '130', '150']) {
    await setViewport(cdp, 390, 844);
    await navigate(cdp, BASE + '/today', { waitMs: 750 });
    await cdp.evaluate(`(() => { window.__mockActive = false; try { delete window.FlowDayNative; } catch (e) { window.FlowDayNative = undefined; } return true; })()`);
    await cdp.evaluate(`(() => { window.__lgApplyInsets && window.__lgApplyInsets({ top: 24, bottom: 48, left: 0, right: 0, imeBottom: 0 }); document.documentElement.style.fontSize = ${font === '100' ? "''" : `'${font}%'`}; return true; })()`);
    await wait(500);
    await cdp.evaluate(scrollEnd);
    await wait(400);
    const m = await cdp.evaluate(READ);
    const occlusion = m.contentBottom - m.nav.top;
    evidence.navHeight[`font${font}`] = { navH: m.navH, navRect: m.nav.h, reserve: m.mainPadBottom, occlusion };
    R.check(`字体 ${font}%：--fd-nav-h 与实际导航高度一致`, Math.abs(m.navH - m.nav.h) <= 1, `var=${m.navH} 实测=${m.nav.h}`);
    R.check(`字体 ${font}%：内容仍不被遮挡`, occlusion <= 0, `遮挡=${occlusion}`);
    await cdp.evaluate(`document.documentElement.style.fontSize = ''`);
  }
  R.check(
    '导航高度随字体缩放增长（100% → 150% 变高）',
    evidence.navHeight.font150.navH > evidence.navHeight.font100.navH,
    `${evidence.navHeight.font100.navH}px → ${evidence.navHeight.font150.navH}px`
  );

  // ---------- 6. 九组响应式 ----------
  const responsive = [
    { w: 320, h: 640, insets: { top: 24, bottom: 48 }, label: '320×640 三键' },
    { w: 360, h: 800, insets: { top: 24, bottom: 48 }, label: '360×800 三键' },
    { w: 390, h: 844, insets: { top: 24, bottom: 48 }, label: '390×844 三键' },
    { w: 412, h: 915, insets: { top: 24, bottom: 48 }, label: '412×915 三键' },
    { w: 320, h: 640, insets: { top: 24, bottom: 0 }, label: '320×640 手势' },
    { w: 360, h: 800, insets: { top: 24, bottom: 0 }, label: '360×800 手势' },
    { w: 390, h: 844, insets: { top: 24, bottom: 0 }, label: '390×844 手势' },
    { w: 412, h: 915, insets: { top: 24, bottom: 0 }, label: '412×915 手势' },
    { w: 844, h: 390, insets: { top: 0, bottom: 24, left: 48, right: 0 }, label: '844×390 横屏+左侧安全区' },
  ];

  for (const rp of responsive) {
    await setViewport(cdp, rp.w, rp.h);
    await navigate(cdp, BASE + '/today', { waitMs: 780 });
    await cdp.evaluate(`(() => { window.__mockActive = false; try { delete window.FlowDayNative; } catch (e) { window.FlowDayNative = undefined; } return true; })()`);
    await cdp.evaluate(`(() => { window.__lgApplyInsets && window.__lgApplyInsets(${JSON.stringify({ left: 0, right: 0, imeBottom: 0, ...rp.insets })}); return true; })()`);
    await wait(380);
    await cdp.evaluate(scrollEnd);
    await wait(420);
    const m = await cdp.evaluate(READ);
    const occlusion = m.contentBottom - m.nav.top;
    const navLeftGap = m.nav.left;
    const navRightGap = m.viewport.w - m.nav.right;
    evidence.responsive.push({
      label: rp.label,
      viewport: m.viewport,
      nav: m.nav,
      navLeftGap,
      navRightGap,
      safe: m.safe,
      occlusion,
      overflowX: m.overflowX,
    });
    R.check(`[${rp.label}] 无横向溢出`, m.overflowX.sw <= m.overflowX.cw, `${m.overflowX.sw}/${m.overflowX.cw}`);
    R.check(`[${rp.label}] 内容不被底部导航遮挡`, occlusion <= 0, `遮挡=${occlusion}`);
    R.check(
      `[${rp.label}] 底栏左右让开安全区`,
      Math.abs(navLeftGap - (m.safe.left + m.gap)) <= 2 && Math.abs(navRightGap - (m.safe.right + m.gap)) <= 2,
      `left=${navLeftGap}(expect ${m.safe.left + m.gap}) right=${navRightGap}(expect ${m.safe.right + m.gap})`
    );
    if (rp.w <= 412) await shoot(cdp, `resp-${rp.w}x${rp.h}-${rp.insets.bottom ? '3btn' : 'gest'}`);
  }

  fs.writeFileSync(path.join(OUT, 'b2-metrics.json'), JSON.stringify(evidence, null, 2));
  const report = R.writeReport(OUT, { base: BASE });
  process.exitCode = report.failed > 0 ? 1 : 0;
} catch (err) {
  console.error('b2-verify 异常：', err.message);
  process.exitCode = 1;
} finally {
  await stopBrowser(browser);
}
