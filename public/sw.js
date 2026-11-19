/* FlowDay Service Worker（Phase 5.0-a D4）
 *
 * 设计约束：
 * - 自研、无构建插件、无第三方依赖（保持运行时依赖不变）
 * - 只缓存「应用壳」与哈希静态资源；**绝不缓存**备份文件、用户数据、带 Authorization
 *   的请求、no-store 响应或跨域响应
 * - 更新只提示、不自动 skipWaiting（避免编辑中被换版本导致未保存状态丢失）
 * - 缓存命名统一 fd- 前缀，激活时只清理自己的旧缓存，不影响同源其他应用/站点
 */
const CACHE_PREFIX = 'fd-';
const SHELL_CACHE = 'fd-shell-v1';
const RUNTIME_CACHE = 'fd-runtime-v1';
const KEEP_CACHES = [SHELL_CACHE, RUNTIME_CACHE];
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-192-maskable.png',
  '/icons/icon-512-maskable.png',
  '/icons/apple-touch-icon-180.png',
];
const NAVIGATION_TIMEOUT_MS = 3000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .catch(() => undefined)
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith(CACHE_PREFIX) && !KEEP_CACHES.includes(name))
          .map((name) => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

/** 是否允许进入缓存：仅同源 GET，且不是数据接口/备份类请求 */
function isCacheable(request, url) {
  if (request.method !== 'GET') return false;
  if (url.origin !== self.location.origin) return false;
  if (request.headers.get('authorization')) return false;
  if (url.pathname.startsWith('/api/')) return false;
  return true;
}

async function networkFirstNavigation(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), NAVIGATION_TIMEOUT_MS);
    const response = await fetch(request, { signal: controller.signal });
    clearTimeout(timer);
    if (response && response.ok) {
      // 只缓存应用壳（index.html），不缓存任何接口或用户数据响应
      cache.put('/index.html', response.clone()).catch(() => undefined);
    }
    return response;
  } catch (err) {
    const cached = (await cache.match('/index.html')) || (await cache.match('/'));
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirstAsset(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) cache.put(request, response.clone()).catch(() => undefined);
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone()).catch(() => undefined);
      return response;
    })
    .catch(() => cached);
  return cached || network;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  let url;
  try {
    url = new URL(request.url);
  } catch (err) {
    return;
  }
  if (!isCacheable(request, url)) return; // 直接放行：不拦截、不缓存

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirstAsset(request));
    return;
  }
  if (url.pathname === '/manifest.webmanifest' || url.pathname.startsWith('/icons/')) {
    event.respondWith(staleWhileRevalidate(request));
  }
  // 其余同源 GET：不缓存（避免误缓存数据类响应）
});
