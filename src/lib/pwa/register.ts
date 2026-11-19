import type { CacheStrategy } from './cachePolicy';

/**
 * Service Worker 注册与更新流程（Phase 5.0-a D4）。
 *
 * 原则：
 * - **只在生产构建注册**（`import.meta.env.PROD`），避免干扰 dev server 下的既有 E2E
 * - 新版本只提示、不自动激活；用户点击「立即更新」才 skipWaiting
 * - 自动刷新最多一次/会话，避免 controllerchange 循环
 * - 所有失败静默降级为普通网页（PWA 不可用不影响主功能）
 */

const RELOAD_GUARD_KEY = 'fd_pwa_reload';
const CHECK_INTERVAL_MS = 30 * 60 * 1000;

export const PWA_UPDATE_EVENT = 'fd:pwa-update-ready';

let waitingWorker: ServiceWorker | null = null;
let registration: ServiceWorkerRegistration | null = null;
let deferredInstallPrompt: (Event & { prompt?: () => Promise<void> }) | null = null;
const listeners = new Set<() => void>();

function notifyUpdate(): void {
  for (const listener of listeners) listener();
  window.dispatchEvent(new Event(PWA_UPDATE_EVENT));
}

export function isPwaSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
}

/**
 * 是否运行在 Capacitor 原生容器内（Android/iOS WebView）。
 * 原生容器下资源已随 APK 打包，Service Worker 会与原生缓存层叠加，
 * 可能造成「旧 JS + 新 CSS」混用或更新不可控，因此原生环境不注册 SW。
 */
export function isNativeContainer(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; platform?: string } };
  if (w.Capacitor?.isNativePlatform?.()) return true;
  if (typeof navigator !== 'undefined' && /capacitor/i.test(navigator.userAgent)) return true;
  return false;
}

export function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false;
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches === true;
  const iosStandalone = (navigator as unknown as { standalone?: boolean }).standalone === true;
  return standalone || iosStandalone;
}

export function subscribePwaUpdate(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function isPwaUpdateReady(): boolean {
  return waitingWorker !== null;
}

/** 用户在「更新提示」中确认更新：允许等待中的 SW 接管。 */
export function applyPwaUpdate(): void {
  if (!waitingWorker) return;
  waitingWorker.postMessage({ type: 'SKIP_WAITING' });
  waitingWorker = null;
  notifyUpdate();
}

export type CheckResult = 'updated' | 'up-to-date' | 'unsupported' | 'error';

/** 手动检查更新（设置页按钮）。 */
export async function checkPwaUpdate(): Promise<CheckResult> {
  if (!isPwaSupported()) return 'unsupported';
  try {
    const reg = registration ?? (await navigator.serviceWorker.getRegistration());
    if (!reg) return 'unsupported';
    await reg.update();
    if (waitingWorker) return 'updated';
    return 'up-to-date';
  } catch {
    return 'error';
  }
}

/** 安装提示（beforeinstallprompt）订阅：返回取消函数。 */
export function subscribeInstallPrompt(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const handler = (event: Event) => {
    event.preventDefault();
    deferredInstallPrompt = event as Event & { prompt?: () => Promise<void> };
    listener();
  };
  window.addEventListener('beforeinstallprompt', handler);
  return () => window.removeEventListener('beforeinstallprompt', handler);
}

export function canPromptInstall(): boolean {
  return deferredInstallPrompt !== null;
}

/** 触发安装提示；返回是否真的弹出。 */
export async function promptInstall(): Promise<boolean> {
  const event = deferredInstallPrompt;
  if (!event?.prompt) return false;
  deferredInstallPrompt = null;
  try {
    await event.prompt();
    return true;
  } catch {
    return false;
  }
}

/**
 * 注册 Service Worker（prod only）。返回是否发起注册。
 * 更新提示通过 subscribePwaUpdate 通知 UI；此处不自动 reload。
 */
export function registerPwa(): boolean {
  if (!isPwaSupported()) return false;
  if (!import.meta.env.PROD) return false;
  // 原生容器（Capacitor）：资源随包分发，不注册 Service Worker
  if (isNativeContainer()) return false;
  if (isStandaloneDisplay() && !navigator.serviceWorker.controller) {
    // 首次以独立窗口启动也照常注册（下面 register 会创建 SW）
  }

  const start = () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { updateViaCache: 'none' })
      .then((reg) => {
        registration = reg;
        if (reg.waiting && navigator.serviceWorker.controller) {
          waitingWorker = reg.waiting;
          notifyUpdate();
        }
        reg.addEventListener('updatefound', () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              waitingWorker = installing;
              notifyUpdate();
            }
          });
        });
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') void reg.update().catch(() => undefined);
        });
        window.setInterval(() => void reg.update().catch(() => undefined), CHECK_INTERVAL_MS);
      })
      .catch(() => undefined);
  };

  // 等首屏稳定后再注册，避免抢占首屏资源
  if (document.readyState === 'complete') window.setTimeout(start, 1200);
  else window.addEventListener('load', () => window.setTimeout(start, 1200), { once: true });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    try {
      if (sessionStorage.getItem(RELOAD_GUARD_KEY) === '1') return; // 单会话只自动刷新一次，防循环
      sessionStorage.setItem(RELOAD_GUARD_KEY, '1');
    } catch {
      return;
    }
    window.location.reload();
  });

  return true;
}

/** 供设置页显示的缓存策略说明（避免 UI 内部重复硬编码文案）。 */
export const CACHE_STRATEGY_SUMMARY: { strategy: CacheStrategy; label: string }[] = [
  { strategy: 'navigation', label: '页面导航：优先网络，离线回退应用壳' },
  { strategy: 'asset', label: '静态资源：优先缓存（文件名含内容哈希）' },
  { strategy: 'shell-metadata', label: '图标与 manifest：后台更新' },
  { strategy: 'passthrough', label: '数据与备份：永不缓存' },
];
