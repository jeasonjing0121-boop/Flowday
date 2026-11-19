/**
 * 安全区与视口度量单一真源（Phase 5.0-B / B2）
 *
 * 背景（B1 审计结论）：
 *  - Android WebView 的 env(safe-area-inset-*) 恒为 0，唯一可靠来源是原生 WindowInsets；
 *  - 旧实现由原生在 onCreate 里"一次性推送"，此时 WebView 的 JS 钩子尚未定义 → 推送被丢弃；
 *  - 原生去重锁让"相同 Insets"永不再发 → 页面重载后也无法恢复。
 *
 * 本模块把 Insets 变成"可拉取 + 可重发"的单一真源：
 *  1) 定义 window.__lgApplyInsets（原生下发入口），写入 --lg-safe-* / --lg-ime；
 *  2) 启动、页面重载、回到前台、旋转/尺寸变化时调用 FlowDayNative.requestInsets() 主动拉取；
 *  3) 拉取带重试（原生缓存可能在极早期为空），收到任意一次回包后即停止重试；
 *  4) 非原生环境（Web/PWA/桌面）回退到 env()，保持 PWA 行为不变；
 *  5) 额外提供视口度量 --fd-vvh（visualViewport 高度）与底部导航实测高度 --fd-nav-h，
 *     供布局用"实测值"而非硬编码常量计算内容预留空间。
 */

type InsetsPayload = {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
  imeBottom?: number;
};

type NativeBridge = {
  requestInsets?: () => void;
  setDark?: (dark: boolean) => void;
};

const RETRY_DELAYS = [0, 120, 300, 700, 1500, 2600];

type InsetsState = {
  applied: boolean;
  applies: number;
  requests: number;
  source: 'native' | 'env' | 'none';
  values: { top: number; bottom: number; left: number; right: number; ime: number } | null;
};

const state: InsetsState = {
  applied: false,
  applies: 0,
  requests: 0,
  source: 'none',
  values: null,
};

declare global {
  interface Window {
    __lgApplyInsets?: (insets: InsetsPayload) => void;
    /** 诊断/测试探针：只读快照 */
    __fdInsetsState?: () => InsetsState & { navHeight: number; vvh: number };
  }
}

function root(): HTMLElement {
  return document.documentElement;
}

function nativeBridge(): NativeBridge | undefined {
  return (window as unknown as { FlowDayNative?: NativeBridge }).FlowDayNative;
}

/** 原生 → Web：写入安全区变量。原生侧在 JS 主动拉取时会无条件重发。 */
function applyInsets(payload: InsetsPayload): void {
  const el = root();
  const top = Math.max(0, Math.round(payload.top ?? 0));
  const bottom = Math.max(0, Math.round(payload.bottom ?? 0));
  const left = Math.max(0, Math.round(payload.left ?? 0));
  const right = Math.max(0, Math.round(payload.right ?? 0));
  const ime = Math.max(0, Math.round(payload.imeBottom ?? 0));

  el.style.setProperty('--lg-safe-top', `${top}px`);
  el.style.setProperty('--lg-safe-bottom', `${bottom}px`);
  el.style.setProperty('--lg-safe-left', `${left}px`);
  el.style.setProperty('--lg-safe-right', `${right}px`);
  el.style.setProperty('--lg-ime', `${ime}px`);
  el.dataset.lgInsets = `${top}/${bottom}/${left}/${right}`;
  el.dataset.lgIme = ime > 0 ? '1' : '0';

  state.applied = true;
  state.applies += 1;
  state.source = state.source === 'native' ? 'native' : state.source;
  state.values = { top, bottom, left, right, ime };
}

/** 浏览器环境（PWA/桌面）回退：读取 env() 安全区（不含系统栏，通常为 0）。 */
function browserEnvInsets(): InsetsPayload {
  const probe = document.createElement('div');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText =
    'position:absolute;left:-9999px;top:0;width:1px;height:1px;' +
    'padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px);' +
    'padding-left:env(safe-area-inset-left,0px);padding-right:env(safe-area-inset-right,0px)';
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const read = (v: string) => Math.round(parseFloat(v || '0') || 0);
  const out = {
    top: read(cs.paddingTop),
    bottom: read(cs.paddingBottom),
    left: read(cs.paddingLeft),
    right: read(cs.paddingRight),
    imeBottom: 0,
  };
  probe.remove();
  return out;
}

/** 主动向原生拉取 Insets（幂等，带重试；收到回包后停止）。 */
export function requestInsets(): void {
  const bridge = nativeBridge();
  if (bridge?.requestInsets) {
    state.requests += 1;
    try {
      bridge.requestInsets();
    } catch {
      /* 原生桥不可用时静默降级 */
    }
    return;
  }
  // Web/PWA：仅初始化一次 env() 值
  if (!state.applied) {
    state.source = 'env';
    applyInsets(browserEnvInsets());
  }
}

function scheduleRetries(): void {
  if (!nativeBridge()?.requestInsets) return;
  RETRY_DELAYS.forEach((delay, index) => {
    window.setTimeout(() => {
      if (index === 0) requestInsets();
      else if (!state.applied) requestInsets();
    }, delay);
  });
}

/** 键盘判定阈值：小于该高度视为地址栏收缩/滚动抖动，而不是键盘（B3） */
const KEYBOARD_MIN_PX = 80;

/**
 * 视口度量（B3 扩展）：visualViewport 高度 + 键盘实际占位。
 *
 * 为什么用 visualViewport 推导键盘高度，而不是直接用原生 ime Insets：
 *  - `adjustResize` 生效时，WebView 布局视口已被系统压缩，visualViewport.height 同步变小，
 *    此时 innerHeight - vv.height - vv.offsetTop ≈ 0 → --fd-kb = 0，**不会**再做第二次位移；
 *  - `adjustResize` 未生效（edge-to-edge 覆盖式键盘）时，布局视口不变、visualViewport 变矮，
 *    差值即为键盘覆盖高度 → --fd-kb > 0，弹窗据此上移。
 * 这样"双重位移"在数学上被消除：同一时刻只可能有一个来源为正。
 */
function installViewportMetrics(): void {
  const el = root();
  let raf = 0;
  // 值不变就不写：写 documentElement 的自定义属性会让整页样式失效，
  // 10k 行列表下这是可测量的开销（B3 性能回归点）。
  let lastVvH = -1;
  let lastVvTop = -1;
  let lastKb = -1;

  const write = () => {
    raf = 0;
    const vv = window.visualViewport;
    const layoutH = window.innerHeight;
    const vvH = Math.round(vv?.height ?? layoutH);
    const vvTop = Math.round(vv?.offsetTop ?? 0);
    const rawKb = Math.max(0, layoutH - vvH - vvTop);
    const kb = rawKb > KEYBOARD_MIN_PX ? rawKb : 0;

    if (vvH !== lastVvH) {
      lastVvH = vvH;
      el.style.setProperty('--fd-vvh', `${vvH}px`);
      el.dataset.vvh = String(vvH);
    }
    if (vvTop !== lastVvTop) {
      lastVvTop = vvTop;
      el.style.setProperty('--fd-vv-top', `${vvTop}px`);
    }
    if (kb !== lastKb) {
      lastKb = kb;
      el.style.setProperty('--fd-kb', `${kb}px`);
      el.dataset.lgKb = kb > 0 ? '1' : '0';
    }
  };

  const schedule = () => {
    if (raf) return;
    raf = window.requestAnimationFrame(write);
  };

  // 键盘是动画过程：焦点进入输入类控件后 250–400ms 才稳定，因此多采样几次。
  const isTextLike = (target: EventTarget | null): boolean => {
    const node = target as HTMLElement | null;
    if (!node || !node.tagName) return false;
    const tag = node.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || node.isContentEditable;
  };

  let focusTimers: number[] = [];
  const scheduleAfterFocus = (event: Event) => {
    if (!isTextLike(event.target)) return;
    focusTimers.forEach((t) => window.clearTimeout(t));
    focusTimers = [0, 90, 220, 380, 620].map((delay) => window.setTimeout(schedule, delay));
  };

  write();
  window.addEventListener('resize', schedule, { passive: true });
  window.addEventListener('orientationchange', schedule, { passive: true });
  window.visualViewport?.addEventListener('resize', schedule, { passive: true });
  window.visualViewport?.addEventListener('scroll', schedule, { passive: true });
  document.addEventListener('focusin', scheduleAfterFocus, true);
  document.addEventListener('focusout', scheduleAfterFocus, true);
  // 回到后台时键盘必然关闭：立即清零，避免"隐形的键盘占位"残留
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      lastKb = 0;
      el.style.setProperty('--fd-kb', '0px');
      el.dataset.lgKb = '0';
    } else {
      schedule();
    }
  });
}

/**
 * 底部导航高度实测：布局用 --fd-nav-h 计算内容预留，
 * 不再硬编码 96px（字体 130%/150% 时导航会变高，硬编码必然遮挡）。
 */
export function trackNavHeight(node: HTMLElement | null): () => void {
  if (!node) return () => undefined;
  const el = root();
  const write = () => {
    const h = Math.round(node.getBoundingClientRect().height);
    if (h > 0) {
      el.style.setProperty('--fd-nav-h', `${h}px`);
      el.dataset.fdNavH = String(h);
    }
  };
  write();
  let ro: ResizeObserver | null = null;
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(write);
    ro.observe(node);
  }
  window.addEventListener('resize', write, { passive: true });
  window.addEventListener('orientationchange', write, { passive: true });
  return () => {
    ro?.disconnect();
    window.removeEventListener('resize', write);
    window.removeEventListener('orientationchange', write);
  };
}

/** 启动时调用一次（幂等）。 */
export function installInsets(): void {
  if (typeof window === 'undefined') return;
  if (window.__lgApplyInsets) return;

  window.__lgApplyInsets = applyInsets;
  window.__fdInsetsState = () => ({
    ...state,
    navHeight: Math.round(parseFloat(getComputedStyle(root()).getPropertyValue('--fd-nav-h')) || 0),
    vvh: Math.round(parseFloat(getComputedStyle(root()).getPropertyValue('--fd-vvh')) || 0),
  });

  installViewportMetrics();
  scheduleRetries();

  // 页面重载 / 前后台切换 / 旋转：重新拉取一次，避免原生侧去重导致的安全区"冻结"
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') requestInsets();
  });
  window.addEventListener('pageshow', () => requestInsets(), { passive: true });
  window.addEventListener('orientationchange', () => requestInsets(), { passive: true });
}
