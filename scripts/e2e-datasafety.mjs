// Phase 5.0-a D0 专项 E2E：安全阻断（不兼容版本 / 损坏数据时绝不写入、绝不覆盖）
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_BASE as BASE,
  click,
  exists,
  makeRunner,
  navigate,
  openTab,
  readStoredState,
  startBrowser,
  stopBrowser,
  wait,
  waitFor,
  waitForBrowser,
} from './lib/e2e-harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', '.tmp', 'e2e-5a');
const R = makeRunner('e2e-datasafety');
const browser = startBrowser({ port: 9540 });

const writeRawRecord = (cdp, record) =>
  cdp.evaluate(`(async () => {
    const record = ${JSON.stringify(record)};
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('flowday-db', 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('app')) d.createObjectStore('app');
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['app', 'meta'], 'readwrite');
      tx.objectStore('app').put(record.state, 'state');
      tx.objectStore('meta').put(record.meta, 'sync:v1');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return true;
  })()`);

const deleteDatabase = (cdp) =>
  cdp.evaluate(`new Promise((resolve) => {
    const req = indexedDB.deleteDatabase('flowday-db');
    req.onsuccess = () => resolve(true);
    req.onerror = () => resolve(false);
    req.onblocked = () => resolve(false);
  })`);

const futureState = {
  schemaVersion: 999,
  updatedAt: '2026-01-01T00:00:00.000Z',
  revision: 3,
  writerId: 'future-app',
  data: {
    version: 1,
    tasks: [
      {
        id: 't_future',
        title: '未来版本任务',
        date: '2026-01-01',
        priority: 1,
        completed: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        source: 'manual',
      },
    ],
    projects: [],
    habits: [],
    habitLogs: [],
    settings: { name: 'future', theme: 'dark', weekStart: 1, aiEnabled: true, demoData: false },
  },
};

try {
  await waitForBrowser(browser.port);
  const { cdp } = await openTab(browser.port, BASE + '/bench-blank.html');
  await navigate(cdp, BASE + '/bench-blank.html');

  // 1) 写入「未来版本」数据库，再启动应用 → 必须阻断
  await writeRawRecord(cdp, { state: futureState, meta: { revision: 3, updatedAt: futureState.updatedAt, writerId: 'future-app' } });
  await navigate(cdp, BASE + '/today');
  await waitFor(cdp, 'Boolean(document.querySelector("[data-fd-blocked]"))', 10000, '安全阻断界面');
  R.eq('未来版本数据 → 阻断界面（schema-too-new）', await cdp.evaluate('document.querySelector("[data-fd-blocked]").getAttribute("data-fd-blocked")'), 'schema-too-new');
  R.check('阻断界面说明未写入数据', await cdp.evaluate('document.body.textContent.includes("不会覆盖、清空或迁移")'));
  R.check('阻断界面明确「本次启动未写入任何示例数据」', await cdp.evaluate('document.body.textContent.includes("未写入任何示例数据")'));
  R.check('提供原始数据导出入口', await exists(cdp, '[data-fd-blocked-export]'));

  // 2) 等待防抖窗口后确认：没有被任何写入覆盖
  await wait(2500);
  const stored = await readStoredState(cdp);
  R.eq('阻断期间数据库 schemaVersion 未被修改', stored?.schemaVersion, 999);
  R.eq('阻断期间 revision 未被推进', stored?.revision, 3);
  R.eq('阻断期间用户任务未被改动', stored?.data?.tasks?.[0]?.title, '未来版本任务');
  R.eq('阻断期间未写入示例数据（仍只有 1 条任务）', stored?.data?.tasks?.length, 1);

  // 3) 重新加载仍阻断（不自动清库、不降级）
  await click(cdp, 'button.fd-btn-primary');
  await wait(1500);
  await waitFor(cdp, 'Boolean(document.querySelector("[data-fd-blocked]"))', 10000, '重新加载后仍阻断');
  const stored2 = await readStoredState(cdp);
  R.eq('重新加载后原始记录仍完整', stored2?.schemaVersion, 999);
  R.eq('重新加载后任务仍在', stored2?.data?.tasks?.length, 1);

  // 4) 用户显式清除后恢复正常启动（受支持的恢复路径）
  await deleteDatabase(cdp);
  await navigate(cdp, BASE + '/today');
  await waitFor(cdp, 'Boolean(document.querySelector("[data-fd-main]")) || Boolean(document.querySelector("main"))', 10000, '恢复正常启动');
  R.check('清除后恢复正常界面（无阻断）', !(await exists(cdp, '[data-fd-blocked]')));

  // 5) 结构损坏数据 → 阻断为 corrupt，且记录不被覆盖
  await navigate(cdp, BASE + '/bench-blank.html');
  await writeRawRecord(cdp, {
    state: { schemaVersion: 2, updatedAt: '2026-01-02T00:00:00.000Z', revision: 4, writerId: 'broken', data: { tasks: 'not-an-array', habits: [] } },
    meta: { revision: 4, updatedAt: '2026-01-02T00:00:00.000Z', writerId: 'broken' },
  });
  await navigate(cdp, BASE + '/today');
  await waitFor(cdp, 'Boolean(document.querySelector("[data-fd-blocked]"))', 10000, '损坏数据阻断');
  R.eq('损坏数据 → 阻断界面（corrupt）', await cdp.evaluate('document.querySelector("[data-fd-blocked]").getAttribute("data-fd-blocked")'), 'corrupt');
  await wait(2200);
  const brokenStored = await readStoredState(cdp);
  R.eq('损坏数据未被覆盖（revision 仍为 4）', brokenStored?.revision, 4);
  R.eq('损坏数据内容保持原样', brokenStored?.data?.tasks, 'not-an-array');

  const report = R.writeReport(OUT, { base: BASE });
  process.exitCode = report.failed > 0 ? 1 : 0;
} catch (err) {
  console.error('e2e-datasafety 执行异常：', err.message);
  process.exitCode = 1;
} finally {
  await stopBrowser(browser);
}
