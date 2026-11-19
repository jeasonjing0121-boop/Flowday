/**
 * PWA 缓存策略（纯函数，便于单元测试）。
 *
 * 与 `public/sw.js` 中的常量/规则保持一致（sw.js 是独立脚本，无法直接 import TS；
 * 任何修改都必须双向同步，阶段验收会用浏览器实测缓存行为兜底）。
 */

export const CACHE_PREFIX = 'fd-';
export const SHELL_CACHE = 'fd-shell-v1';
export const RUNTIME_CACHE = 'fd-runtime-v1';

export const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-192-maskable.png',
  '/icons/icon-512-maskable.png',
  '/icons/apple-touch-icon-180.png',
];

export type CacheStrategy = 'navigation' | 'asset' | 'shell-metadata' | 'passthrough';

export interface RequestDescriptor {
  pathname: string;
  method: string;
  mode?: string;
  sameOrigin: boolean;
  hasAuthorization?: boolean;
}

/**
 * 判断请求应使用的策略：
 * - 仅处理同源 GET；带 Authorization、/api/* 一律 passthrough（不缓存）
 * - 导航请求 → navigation（network-first + index.html 回退）
 * - /assets/* → asset（cache-first，文件名带内容哈希）
 * - manifest / icons → shell-metadata（stale-while-revalidate）
 * - 其他 → passthrough（不缓存，避免误缓存数据类响应）
 */
export function classifyRequest(input: RequestDescriptor): CacheStrategy {
  if (input.method !== 'GET') return 'passthrough';
  if (!input.sameOrigin) return 'passthrough';
  if (input.hasAuthorization) return 'passthrough';
  if (input.pathname.startsWith('/api/')) return 'passthrough';
  if (input.mode === 'navigate') return 'navigation';
  if (input.pathname.startsWith('/assets/')) return 'asset';
  if (input.pathname === '/manifest.webmanifest' || input.pathname.startsWith('/icons/')) return 'shell-metadata';
  return 'passthrough';
}

/** 是否属于 FlowDay 自己的缓存（激活时只清理这些，绝不动其他站点/应用的缓存）。 */
export function isOwnedCacheName(name: string): boolean {
  return name.startsWith(CACHE_PREFIX);
}

/** 是否为应被清理的旧缓存（保留当前两个版本）。 */
export function isStaleCache(name: string, keep: string[] = [SHELL_CACHE, RUNTIME_CACHE]): boolean {
  return isOwnedCacheName(name) && !keep.includes(name);
}

/** 安装时预缓存的应用壳地址。 */
export function precacheUrls(): string[] {
  return [...PRECACHE_URLS];
}
