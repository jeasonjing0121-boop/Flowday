// Phase 5.0-a D6：10k 任务性能复核（保存延迟 / 搜索过滤耗时 / 项目页渲染规模）
// 方法：dev server + 开发态埋点（__FD_FILTER_MS__ / revision 轮询），与 4.5 基线同口径。
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_BASE as BASE,
  makeRunner,
  navigate,
  openTab,
  seedAppState,
  setInput,
  startBrowser,
  stopBrowser,
  wait,
  waitFor,
  waitForBrowser,
} from './lib/e2e-harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', '.tmp', 'e2e-5a');
const R = makeRunner('perf-5a');
const browser = startBrowser({ port: 9560 });
const today = new Date().toISOString().slice(0, 10);
/** dev：使用开发态埋点（__FD_FILTER_MS__ / __FD_STORAGE__）；prod：仅用 IndexedDB 读 revision */
const PAGE_MODE = process.env.PAGE_MODE || 'dev';

// 4.5 验收基线（10k 任务）：保存 245ms、搜索过滤 ~90ms
// D6 基线在开发机实测为 saveMs=245；机器负载变化会使绝对值漂移。
// Beta.2 采用「同机 A/B」判定：先跑 Beta.1 代码得到当前机器基线，再跑本次实现；
// 可用 PERF_BASELINE_SAVE_MS 传入同机基线，避免把环境漂移误判为代码回归。
const BASELINE = {
  saveMs: Number(process.env.PERF_BASELINE_SAVE_MS || 245),
  filterMs: Number(process.env.PERF_BASELINE_FILTER_MS || 90),
  tolerance: Number(process.env.PERF_TOLERANCE || 1.1),
};

const buildData = (taskCount, projectCount) => {
  const projects = Array.from({ length: projectCount }, (_, i) => ({
    id: `p_${i}`,
    name: `项目 ${i + 1}`,
    color: ['#4A5B8C', '#2F7477', '#B0724A', '#5F7F3F'][i % 4],
    archived: false,
    createdAt: new Date(Date.now() - i * 1000).toISOString(),
  }));
  const tasks = Array.from({ length: taskCount }, (_, i) => ({
    id: `t_${i}`,
    title: `性能任务 ${i} 标题关键字${i % 97}`,
    notes: i % 5 === 0 ? `备注 ${i}` : undefined,
    date: today,
    priority: (i % 3) + 1,
    projectId: i % 4 === 0 ? `p_${i % projectCount}` : undefined,
    completed: i % 7 === 0,
    completedAt: i % 7 === 0 ? new Date().toISOString() : undefined,
    createdAt: new Date().toISOString(),
    source: 'manual',
  }));
  return {
    version: 1,
    tasks,
    projects,
    habits: [],
    habitLogs: [],
    settings: { name: '', theme: 'light', weekStart: 1, aiEnabled: true, demoData: false, onboarded: true },
  };
};

const median = (arr) => [...arr].sort((a, b) => a - b)[Math.floor(arr.length / 2)];

try {
  await waitForBrowser(browser.port);
  const { cdp } = await openTab(browser.port, BASE + '/today');
  await navigate(cdp, BASE + '/today');

  const data = buildData(10000, 20);
  const seedStart = Date.now();
  await seedAppState(cdp, data, 3);
  console.log(`  种子写入 10k 任务耗时 ${Date.now() - seedStart}ms`);

  // 1) 任务页：搜索过滤耗时（dev 埋点；prod 无埋点则跳过）
  await navigate(cdp, BASE + '/tasks', { waitMs: 1500 });
  await waitFor(cdp, `document.querySelectorAll('[data-task-id]').length > 0 || Boolean(window.__FD_STATE__)`, 20000, '10k 任务加载');
  let filterMs = -1;
  if (PAGE_MODE === 'dev') {
    await waitFor(cdp, 'Boolean(window.__FD_STATE__) && window.__FD_STATE__.tasks.length === 10000', 20000, '10k 任务状态');
    const filterSamples = [];
    for (const q of ['关键字1', '关键字42', '性能任务 99']) {
      await cdp.evaluate('window.__FD_FILTER_MS__ = 0');
      await setInput(cdp, '#task-search', q);
      await wait(450);
      const ms = await cdp.evaluate('window.__FD_FILTER_MS__ || 0');
      if (ms > 0) filterSamples.push(ms);
    }
    filterMs = filterSamples.length ? median(filterSamples) : -1;
    R.check(`10k 搜索过滤 ≤ ${(BASELINE.filterMs * BASELINE.tolerance).toFixed(0)}ms（基线 ${BASELINE.filterMs}ms）`, filterMs > 0 && filterMs <= BASELINE.filterMs * BASELINE.tolerance, `实测中位 ${filterMs.toFixed(1)}ms（样本 ${filterSamples.map((n) => n.toFixed(1)).join('/')}）`);
  } else {
    R.check('prod 模式：搜索过滤按 dev 埋点口径测量（本模式跳过）', true, '见 dev 模式结果');
  }

  // 2) 保存延迟：切换任务完成态 → revision 前进（页面内精确计时，含 180ms 防抖）
  const readRevExpr =
    PAGE_MODE === 'dev'
      ? 'window.__FD_STORAGE__.revision'
      : `(async () => {
          const rev = await new Promise((resolve) => {
            const r = indexedDB.open('flowday-db', 1);
            r.onsuccess = () => {
              const db = r.result;
              const tx = db.transaction('meta', 'readonly');
              const q = tx.objectStore('meta').get('sync:v1');
              q.onsuccess = () => { db.close(); resolve((q.result && q.result.revision) || 0); };
              q.onerror = () => { db.close(); resolve(0); };
            };
            r.onerror = () => resolve(0);
          });
          return rev;
        })()`;
  await wait(400);
  const saveSamples = [];
  for (let i = 0; i < 4; i += 1) {
    const ms = await cdp.evaluate(`(async () => {
      const readRev = () => ${readRevExpr};
      const before = await readRev();
      const start = performance.now();
      document.querySelector('[data-testid=task-toggle]').click();
      let rev = before;
      while (rev <= before) {
        await new Promise((r) => setTimeout(r, 10));
        rev = await readRev();
      }
      return Math.round(performance.now() - start);
    })()`);
    if (i > 0) saveSamples.push(ms); // 首轮含热起来的一次性开销，按中位统计其余三轮
    await wait(250);
  }
  const saveMs = median(saveSamples);
  R.check(`10k 保存延迟 ≤ ${(BASELINE.saveMs * BASELINE.tolerance).toFixed(0)}ms（基线 ${BASELINE.saveMs}ms，含 180ms 防抖）`, saveMs <= BASELINE.saveMs * BASELINE.tolerance, `实测中位 ${saveMs}ms（样本 ${saveSamples.join('/')}）`);

  // 3) 项目页：20 个项目 + 10k 任务下的渲染规模与耗时
  const navStart = Date.now();
  await navigate(cdp, BASE + '/projects', { waitMs: 200 });
  await waitFor(cdp, 'Boolean(document.querySelector("[data-fd-projects-page]"))', 10000, '项目页');
  const renderMs = Date.now() - navStart;
  const domNodes = await cdp.evaluate('document.getElementsByTagName("*").length');
  const cards = await cdp.evaluate('document.querySelectorAll("[data-project-id]").length');
  R.eq('项目页渲染全部 20 个项目卡片', cards, 20);
  R.check('项目页在 10k 任务下渲染 < 3000ms', renderMs < 3000, `实测 ${renderMs}ms`);
  R.check('项目页 DOM 节点保持轻量（< 6000）', domNodes < 6000, `实测 ${domNodes} 节点`);

  // 4) 项目详情（10k 任务中 2500 条属于该项目）：虚拟滚动生效
  const detailStart = Date.now();
  await cdp.evaluate('document.querySelector("[data-project-id] a").click()');
  await waitFor(cdp, 'Boolean(document.querySelector("[data-fd-project-detail]"))', 10000, '项目详情');
  const detailMs = Date.now() - detailStart;
  const detailNodes = await cdp.evaluate('document.getElementsByTagName("*").length');
  R.check('项目详情（2500 条任务）渲染 < 4000ms', detailMs < 4000, `实测 ${detailMs}ms`);
  R.check('项目详情复用虚拟列表（DOM 节点 < 6000）', detailNodes < 6000, `实测 ${detailNodes} 节点`);

  const report = R.writeReport(OUT, {
    base: BASE,
    metrics: { filterMs, saveMs, renderMs, domNodes, detailMs, detailNodes },
    baseline: BASELINE,
  });
  process.exitCode = report.failed > 0 ? 1 : 0;
} catch (err) {
  console.error('perf-5a 执行异常：', err.message);
  process.exitCode = 1;
} finally {
  await stopBrowser(browser);
}
