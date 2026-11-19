/**
 * Liquid Glass 运行时（Phase 5.0-a Beta.2）
 *
 * 职责（全部为轻量、可降级）：
 * 1) 环境响应：根据路由 + 滚动位置采样「玻璃下方的内容色」，写入 --lg-ambient，
 *    让 L1 材质产生染色与环境光变化（而非固定 tint）。
 * 2) 光学标尺：--lg-lum（明暗）、--lg-scroll（滚动进度 → 阴影/浮起深度）。
 * 3) 安全区/视口度量已拆到 src/lib/insets.ts（B2：可拉取、可重发、单一真源）。
 * 4) 外观同步：向原生桥报告深色/浅色，供状态栏图标颜色切换。
 *
 * 性能约束：rAF + 120ms 节流；仅在滚动/路由变化时计算；无持续动画；
 * prefers-reduced-motion 下不做采样节流之外的任何变化。
 */

type Rgb = [number, number, number];

const ROUTE_AMBIENT: Record<string, Rgb> = {
  '/today': [120, 104, 170],
  '/tasks': [86, 122, 168],
  '/projects': [96, 140, 132],
  '/calendar': [128, 112, 100],
  '/habits': [96, 138, 108],
  '/settings': [104, 112, 128],
  '/assistant': [140, 104, 148],
};

const DEFAULT_AMBIENT: Rgb = [110, 118, 150];

let installed = false;
let rafId = 0;
let lastRun = 0;
let lastAmbient = '';

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function hexToRgb(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];
}

function ambientForRoute(pathname: string): Rgb {
  const key = Object.keys(ROUTE_AMBIENT).find((k) => pathname === k || pathname.startsWith(`${k}/`));
  return key ? ROUTE_AMBIENT[key] : DEFAULT_AMBIENT;
}

/**
 * 采样玻璃下方内容的环境色：取顶部导航正下方第一个带 data-ambient 的元素。
 * 没有命中时使用路由默认环境色。成本：一次 elementFromPoint + closest。
 */
function sampleAmbient(pathname: string): Rgb {
  const base = ambientForRoute(pathname);
  if (typeof document === 'undefined') return base;
  const probeY = 96;
  const probeX = Math.round(window.innerWidth / 2);
  const el = document.elementFromPoint(probeX, probeY) as HTMLElement | null;
  const host = el?.closest?.('[data-ambient]') as HTMLElement | null;
  const hex = host?.dataset.ambient;
  const rgb = hex ? hexToRgb(hex) : null;
  if (!rgb) return base;
  // 内容色只做轻微影响（24%），保证玻璃仍以中性材质为主，避免廉价彩色玻璃
  return mix(base, rgb, 0.24);
}

function applyAmbient(rgb: Rgb) {
  const value = `${rgb[0]} ${rgb[1]} ${rgb[2]}`;
  if (value === lastAmbient) return;
  lastAmbient = value;
  const el = document.documentElement;
  el.style.setProperty('--lg-ambient', value);
  // B4：材质染色使用"去饱和环境色"，避免整块玻璃变成明显的彩色塑料；
  // 折射/边缘仍使用原始环境色（需要一点色偏才有光学感）。
  const dark = el.dataset.theme === 'dark';
  const soft = mix(rgb, dark ? [20, 22, 30] : [246, 246, 250], 0.58);
  el.style.setProperty('--lg-ambient-soft', `${soft[0]} ${soft[1]} ${soft[2]}`);
}

function updateScrollState() {
  const scrolled = clamp(window.scrollY / 320, 0, 1);
  document.documentElement.style.setProperty('--lg-scroll', scrolled.toFixed(3));
}

function updateLum() {
  const theme = document.documentElement.dataset.theme;
  const dark = theme === 'dark';
  document.documentElement.style.setProperty('--lg-lum', dark ? '0' : '1');
  // 同步原生状态栏图标颜色（Capacitor 注入的桥或自定义桥）
  const w = window as unknown as { FlowDayNative?: { setDark?: (v: boolean) => void }; Capacitor?: unknown };
  try {
    w.FlowDayNative?.setDark?.(dark);
  } catch {
    /* 原生桥不可用时静默降级 */
  }
}

function run(force = false) {
  const now = performance.now();
  if (!force && now - lastRun < 120) return;
  lastRun = now;
  const pathname = window.location.pathname;
  applyAmbient(sampleAmbient(pathname));
  updateScrollState();
}

function schedule() {
  if (rafId) return;
  rafId = window.requestAnimationFrame(() => {
    rafId = 0;
    run();
  });
}

/** 应用启动时调用一次（幂等）。 */
export function installLiquidGlass(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  updateLum();
  run(true);

  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', () => run(true), { passive: true });
  window.addEventListener('popstate', () => run(true));
  // 路由切换：pushState 已 patch（见下）；再于导航后补一次采样，覆盖懒渲染场景。
  // 注意：不使用 main 子树的 MutationObserver——大数据量渲染会产生上万条记录，拖慢保存路径。
  window.setTimeout(() => run(true), 350);

  // 主题切换：data-theme 变化后刷新光学标尺与环境色
  const themeObserver = new MutationObserver(() => {
    updateLum();
    run(true);
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // 路由变化（React Router）通过 patch history 通知
  const wrap = (fn: History['pushState']) =>
    function patched(this: History, ...args: Parameters<History['pushState']>) {
      const result = fn.apply(this, args);
      window.setTimeout(() => run(true), 0);
      return result;
    };
  history.pushState = wrap(history.pushState);
  history.replaceState = wrap(history.replaceState);
}

/** 供测试/调试读取当前材质状态。 */
export function liquidGlassSnapshot() {
  const root = document.documentElement;
  return {
    ambient: root.style.getPropertyValue('--lg-ambient') || null,
    lum: root.style.getPropertyValue('--lg-lum') || null,
    scroll: root.style.getPropertyValue('--lg-scroll') || null,
    insets: root.dataset.lgInsets ?? null,
    ime: root.dataset.lgIme ?? null,
  };
}
