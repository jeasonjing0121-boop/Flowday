// Phase 5.0-a D4 专项 E2E：PWA（manifest / SW 注册 / 缓存范围 / 离线 / dev 不注册）
// 需要生产构建 + preview 服务器：npm run build && npm run preview -- --port 4173
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  makeRunner,
  navigate,
  openTab,
  startBrowser,
  stopBrowser,
  wait,
  waitFor,
  waitForBrowser,
} from './lib/e2e-harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', '.tmp', 'e2e-5a');
const PREVIEW = process.env.BASE || 'http://127.0.0.1:4173';
const DEV = process.env.DEV_BASE || 'http://127.0.0.1:5173';
const R = makeRunner('e2e-pwa');
const browser = startBrowser({ port: 9550 });

try {
  await waitForBrowser(browser.port);
  const { cdp } = await openTab(browser.port, PREVIEW + '/today');
  await navigate(cdp, PREVIEW + '/today', { waitMs: 800 });

  // 1) manifest 可访问且结构正确
  const manifest = await cdp.evaluate(`fetch('/manifest.webmanifest').then(r => r.json()).catch(() => null)`);
  R.check('manifest 可访问并解析为 JSON', Boolean(manifest));
  R.eq('manifest display 为 standalone', manifest?.display, 'standalone');
  R.eq('manifest start_url 与 scope', [manifest?.start_url, manifest?.scope], ['/', '/']);
  const iconSizes = (manifest?.icons || []).map((i) => i.sizes);
  R.check('manifest 含 192 与 512 图标', iconSizes.includes('192x192') && iconSizes.includes('512x512'), iconSizes.join(','));
  R.check('manifest 含 maskable 图标', (manifest?.icons || []).some((i) => i.purpose === 'maskable'));

  // 2) Service Worker 注册并激活
  const swReady = await waitFor(
    cdp,
    `navigator.serviceWorker.getRegistration().then((r) => Boolean(r && (r.active || r.installing || r.waiting))).catch(() => false)`,
    20000,
    'SW 注册'
  );
  R.check('Service Worker 注册成功', Boolean(swReady));
  R.check('sw.js 可访问且包含缓存名', await cdp.evaluate(`fetch('/sw.js').then(r=>r.text()).then(t=>t.includes('fd-shell-v1')&&t.includes('fd-runtime-v1')).catch(()=>false)`));

  // 3) 缓存范围：只包含 fd- 前缀的壳缓存；不得包含接口/备份
  await wait(1500); // 等待预缓存完成
  const cacheNames = await cdp.evaluate('caches.keys()');
  R.check('存在应用壳缓存', cacheNames.includes('fd-shell-v1'), cacheNames.join(','));
  R.check('只清理/管理自己前缀的缓存', cacheNames.every((n) => n.startsWith('fd-')));
  const sensitive = await cdp.evaluate(`(async () => {
    const names = await caches.keys();
    const hits = [];
    for (const name of names) {
      const cache = await caches.open(name);
      const reqs = await cache.keys();
      for (const req of reqs) {
        if (req.url.includes('/api/') || req.url.includes('.json') || req.url.includes('backup')) hits.push(req.url);
      }
    }
    return hits;
  })()`);
  R.eq('缓存中不含接口/备份/JSON 数据', sensitive, []);

  // 4) 应用壳已预缓存且离线可启动
  const shellCached = await cdp.evaluate(`caches.open('fd-shell-v1').then(c => c.match('/index.html')).then(Boolean)`);
  R.check('应用壳 index.html 已预缓存', Boolean(shellCached));
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await cdp.evaluate('location.reload()');
  await wait(1600);
  const offlineOk = await cdp.evaluate('Boolean(document.querySelector("[data-fd-main]")) || Boolean(document.querySelector("nav")) || Boolean(document.querySelector("#root") && document.querySelector("#root").children.length > 0)');
  R.check('离线重载仍渲染应用壳', Boolean(offlineOk));
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

  // 5) 更新接口可用（当前不应有待接管版本）
  const update = await cdp.evaluate(`(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return 'no-registration';
    try { await reg.update(); } catch (e) { return 'error'; }
    return reg.waiting ? 'waiting' : 'none';
  })()`);
  R.eq('registration.update() 可用且无待接管版本', update, 'none');

  // 6) dev server 不注册 SW（保护既有 E2E）
  const dev = await openTab(browser.port, DEV + '/today');
  await navigate(dev.cdp, DEV + '/today', { waitMs: 600 });
  await wait(2500);
  const devReg = await dev.cdp.evaluate(`navigator.serviceWorker.getRegistration().then((r) => Boolean(r)).catch(() => false)`);
  R.check('dev 环境不注册 Service Worker', !devReg);
  dev.cdp.close();

  const report = R.writeReport(OUT, { preview: PREVIEW, dev: DEV });
  process.exitCode = report.failed > 0 ? 1 : 0;
} catch (err) {
  console.error('e2e-pwa 执行异常：', err.message);
  process.exitCode = 1;
} finally {
  await stopBrowser(browser);
}
