import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Icon } from './Icons';

/* ---------------- 弹窗焦点管理（统一实现，Modal 与 Confirm 共用） ----------------
   规则：
   - 打开：记录触发元素 → 记录当前弹窗栈 → 初始焦点（[data-autofocus] > 第一个表单控件 > 弹窗容器）
   - 打开期间：Tab / Shift+Tab 在弹窗内循环；焦点逃逸自动拉回；仅最顶层弹窗处理按键与逃逸
   - 关闭：优先恢复到原触发元素；若已卸载/不可见 → 回退到 [data-fd-main]
   - 焦点变化时 scrollIntoView(nearest)，保证移动端虚拟键盘不遮挡
   ---------------------------------------------------------------------------- */

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function getFocusable(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.getClientRects().length > 0 && el.getAttribute('aria-hidden') !== 'true'
  );
}

let dialogSeq = 0;
const dialogStack: string[] = [];
const isTopDialog = (id: string) => dialogStack[dialogStack.length - 1] === id;
const syncBodyDialogState = () => {
  if (dialogStack.length) document.body.dataset.dialogOpen = String(dialogStack.length);
  else delete document.body.dataset.dialogOpen;
};

/** 统一的弹窗焦点陷阱与恢复逻辑；返回需要挂在弹窗面板上的 ref。 */
export function useDialogFocus({
  open,
  onClose,
  fallbackSelector = '[data-fd-main]',
}: {
  open: boolean;
  onClose: () => void;
  fallbackSelector?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const idRef = useRef(`fd-dialog-${++dialogSeq}`);
  // onClose 使用 ref 转发：避免父组件每次渲染产生新函数导致焦点副作用重跑
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const id = idRef.current;
    const panel = ref.current;
    restoreRef.current = (document.activeElement as HTMLElement | null) ?? null;
    dialogStack.push(id);
    syncBodyDialogState();

    const preferred =
      panel?.querySelector<HTMLElement>('[data-autofocus]') ??
      panel?.querySelector<HTMLElement>('input:not([disabled]),select:not([disabled]),textarea:not([disabled])') ??
      null;
    (preferred ?? panel)?.focus({ preventScroll: true });

    const onKeyDown = (e: KeyboardEvent) => {
      if (!isTopDialog(id)) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const list = getFocusable(panel);
      if (!list.length) {
        e.preventDefault();
        panel?.focus({ preventScroll: true });
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !panel?.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !panel?.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };

    const onFocusIn = (e: FocusEvent) => {
      if (!isTopDialog(id) || !panel) return;
      const target = e.target as HTMLElement | null;
      if (target && !panel.contains(target)) {
        const list = getFocusable(panel);
        (list[0] ?? panel).focus({ preventScroll: true });
        return;
      }
      // 键盘/虚拟键盘弹出时保证聚焦元素在视口内
      if (target && typeof target.scrollIntoView === 'function') {
        const r = target.getBoundingClientRect();
        if (r.top < 0 || r.bottom > window.innerHeight) target.scrollIntoView({ block: 'nearest' });
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusin', onFocusIn);
      const idx = dialogStack.lastIndexOf(id);
      if (idx >= 0) dialogStack.splice(idx, 1);
      syncBodyDialogState();
      const saved = restoreRef.current;
      restoreRef.current = null;
      const focusFallback = () => {
        const fallback = document.querySelector<HTMLElement>(fallbackSelector);
        if (!fallback) return;
        if (!fallback.hasAttribute('tabindex')) fallback.setAttribute('tabindex', '-1');
        fallback.focus({ preventScroll: true });
      };
      const topDialog = () => {
        const list = document.querySelectorAll<HTMLElement>('[data-fd-dialog]');
        return list[list.length - 1] ?? null;
      };
      const focusTopDialog = () => {
        const top = topDialog();
        if (!top) return false;
        const list = getFocusable(top);
        (list[0] ?? top).focus({ preventScroll: true });
        return true;
      };
      const tryRestore = (): 'ok' | 'dialog' | 'retry' => {
        // body/html 等非交互容器不算有效恢复目标（按钮被禁用时焦点会先掉到 body）
        const isContainer = !saved || saved === document.body || saved === document.documentElement;
        const usable = !isContainer && saved && saved.isConnected && saved.getClientRects().length > 0 && !saved.hasAttribute('disabled');
        if (usable) {
          if (document.activeElement !== saved) saved.focus({ preventScroll: true });
          return 'ok';
        }
        if (focusTopDialog()) return 'dialog';
        return 'retry';
      };
      // 落地后复核：删除等操作会在下一帧卸载触发元素，需要回退焦点并避免焦点落到 body
      let attempts = 0;
      const settle = () => {
        const state = tryRestore();
        if (state === 'ok') {
          window.setTimeout(() => {
            if (saved && !saved.isConnected) {
              if (!focusTopDialog()) focusFallback();
            }
          }, 140);
          return;
        }
        if (state === 'retry' && attempts < 3) {
          attempts += 1;
          window.setTimeout(settle, 80);
          return;
        }
        if (state === 'retry') focusFallback();
      };
      if (!saved) {
        window.setTimeout(() => {
          if (!focusTopDialog()) focusFallback();
        }, 0);
        return;
      }
      window.setTimeout(settle, 0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onClose 经 ref 转发，仅随 open/fallback 变化重挂
  }, [open, fallbackSelector]);

  return ref;
}

/* ---------------- Modal ---------------- */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const titleId = useId();
  // 退出动画：关闭时先播放回缩，再卸载（保持焦点归还时机不变）
  const [mounted, setMounted] = useState(open);
  const [exiting, setExiting] = useState(false);
  useEffect(() => {
    if (open) {
      setMounted(true);
      setExiting(false);
      return;
    }
    if (!mounted) return;
    setExiting(true);
    const timer = window.setTimeout(() => {
      setMounted(false);
      setExiting(false);
    }, 190);
    return () => window.clearTimeout(timer);
  }, [open, mounted]);

  const panelRef = useDialogFocus({ open: open && mounted && !exiting, onClose });

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // B3 keyboard: keep the focused field visible inside the scrolling body
  useEffect(() => {
    if (!open || exiting) return;
    const panel = panelRef.current;
    const body = panel?.querySelector<HTMLElement>('[data-fd-modal-body]');
    if (!panel || !body) return;

    const ensureVisible = (target: HTMLElement) => {
      const panelRect = panel.getBoundingClientRect();
      const footRect = panel.querySelector<HTMLElement>('.fd-modal-foot')?.getBoundingClientRect();
      const visibleTop = panelRect.top + 4;
      const visibleBottom = Math.min(panelRect.bottom, window.innerHeight) - (footRect ? footRect.height : 0) - 12;
      const rect = target.getBoundingClientRect();
      if (rect.top < visibleTop || rect.bottom > visibleBottom) {
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    };

    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target || !body.contains(target)) return;
      ensureVisible(target);
      window.setTimeout(() => {
        if (document.activeElement === target) ensureVisible(target);
      }, 320);
    };

    body.addEventListener('focusin', onFocusIn);
    return () => body.removeEventListener('focusin', onFocusIn);
  }, [open, exiting, panelRef]);

  if (!mounted) return null;
  // 退出动画期间：仅保留视觉层，移除对话框语义与交互，
  // 避免短暂存在的“幽灵模态”抢占焦点/遮挡后续浮层（a11y 与键盘流程必须立即生效）。
  const ghost = exiting;
  return (
    <div
      className={`${ghost ? 'pointer-events-none' : ''} fd-modal-overlay`}
      aria-hidden={ghost ? 'true' : undefined}
      inert={ghost ? true : undefined}
    >
      <div
        className={`fd-fade-in lg-scrim-liquid absolute inset-0 ${ghost ? 'pointer-events-none' : ''}`}
        onClick={ghost ? undefined : onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        {...(ghost ? {} : { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, 'data-fd-dialog': 'modal' })}
        className={`lg-l1 lg-l3 glass-modal-liquid lg-sheet fd-modal-panel ${ghost ? 'lg-sheet-exit pointer-events-none' : ''} outline-none`}
      >
        <div className="fd-modal-head">
          <h2 id={titleId} className="fd-t-h2 text-ink">
            {title}
          </h2>
          <button
            className="fd-btn-ghost -mr-1 -mt-1 rounded-full p-1.5"
            onClick={ghost ? undefined : onClose}
            aria-label="关闭"
            tabIndex={ghost ? -1 : undefined}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="fd-modal-body" data-fd-modal-body="1">
          <div className="space-y-4">{children}</div>
        </div>
        {footer ? <div className="fd-modal-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

/* ---------------- Segmented（分段选择组） ---------------- */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  className = '',
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  /** 分组的可访问名称（屏幕阅读器读作「<label> 分组」） */
  label?: string;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [indicator, setIndicator] = useState<{ x: number; w: number; on: boolean }>({ x: 0, w: 0, on: false });

  // 真实测量选中项位置 → indicator 用 transform/width 位移（形态变化，而非透明度切换）
  const measure = useCallback(() => {
    const host = hostRef.current;
    if (!host) return;
    const index = options.findIndex((opt) => opt.value === value);
    const button = index >= 0 ? host.querySelectorAll<HTMLButtonElement>('button')[index] : null;
    if (!button) return;
    setIndicator({ x: button.offsetLeft, w: button.offsetWidth, on: true });
  }, [options, value]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);
  useEffect(() => {
    const onResize = () => measure();
    window.addEventListener('resize', onResize, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null;
    if (hostRef.current && ro) ro.observe(hostRef.current);
    return () => {
      window.removeEventListener('resize', onResize);
      ro?.disconnect();
    };
  }, [measure]);

  return (
    <div
      ref={hostRef}
      role="group"
      aria-label={label}
      data-lg-seg="1"
      className={`fd-seg inline-flex items-center gap-0.5 rounded-xl border border-line bg-sunken p-0.5 ${className}`}
    >
      <span
        aria-hidden="true"
        className="fd-seg-ind"
        style={{ transform: `translate3d(${indicator.x}px, 0, 0)`, width: `${indicator.w}px`, opacity: indicator.on ? 1 : 0 }}
      />
      {options.map((opt) => (
        <button
          key={String(opt.value)}
          type="button"
          aria-pressed={value === opt.value}
          onClick={() => onChange(opt.value)}
          className={`rounded-[10px] px-2.5 py-1 text-xs transition-colors ${
            value === opt.value ? 'bg-surface font-medium text-ink shadow-sm ring-1 ring-line' : 'text-ink-2 hover:text-ink'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function ProgressRing({ percent, size = 92, stroke = 8 }: { percent: number; size?: number; stroke?: number }) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`完成进度 ${clamped}%`}>
      <defs>
        <linearGradient id="fd-ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#F2A45C" />
          <stop offset="52%" stopColor="#C9668F" />
          <stop offset="100%" stopColor="#5B5CBF" />
        </linearGradient>
      </defs>
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--fd-sunken-2)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="url(#fd-ring)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - clamped / 100)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset 400ms ease' }}
      />
    </svg>
  );
}

export function EmptyState({ icon = 'sparkles', title, description, action }: { icon?: Parameters<typeof Icon>[0]['name']; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="fd-glass fd-glass-soft flex flex-col items-center justify-center rounded-[20px] px-6 py-10 text-center">
      <span className="fd-gradient-bg mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl text-white" aria-hidden="true">
        <Icon name={icon} size={20} />
      </span>
      <p className="text-sm font-medium text-ink">{title}</p>
      {description ? <p className="fd-t-cap mt-1 max-w-[320px]">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function DemoBanner({ onClear }: { onClear: () => void }) {
  return (
    <div className="mb-4 flex flex-col gap-2 rounded-xl border border-p2/25 bg-p2/8 px-3 py-2 text-xs text-ink-2 sm:flex-row sm:items-center sm:justify-between">
      <span className="flex items-start gap-1.5 leading-5">
        <Icon name="sparkles" size={14} className="mt-0.5 shrink-0 text-p2" />
        <span>
          当前展示的是<strong className="font-medium text-ink">示例数据</strong>
          ，用于体验界面；你的真实数据请直接新建。
        </span>
      </span>
      <button
        type="button"
        className="fd-btn-ghost shrink-0 self-start rounded-lg px-2 py-1 text-xs text-ink-2 hover:text-ink sm:self-auto"
        onClick={onClear}
      >
        清空示例数据
      </button>
    </div>
  );
}

/* ---------------- Toast 轻提示 ---------------- */
type ToastTone = 'success' | 'error' | 'info';

interface ToastActionOptions {
  actionLabel: string;
  onAction: () => void;
  /** 展示时长（毫秒）；动作型提示默认 8000ms，普通提示 2400ms */
  duration?: number;
  tone?: ToastTone;
  /**
   * 去重键：相同 key 的新动作提示会替换旧提示（避免连续删除时堆叠多个撤销按钮）。
   */
  key?: string;
}

interface ToastApi {
  toast: (text: string, tone?: ToastTone) => void;
  /** Phase 5.0-a D3：带动作按钮的长时提示（用于「删除 → 撤销」） */
  toastAction: (text: string, options: ToastActionOptions) => void;
}

const ToastCtx = createContext<ToastApi | null>(null);

interface ToastItem {
  id: number;
  text: string;
  tone: ToastTone;
  leaving?: boolean;
  actionLabel?: string;
  onAction?: () => void;
  key?: string;
}

const TOAST_PLAIN_MS = 2400;
const TOAST_ACTION_MS = 8000;
const TOAST_EXIT_MS = 220;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef<number[]>([]);

  const remove = useCallback((itemId: number) => {
    setItems((prev) => prev.filter((i) => i.id !== itemId));
  }, []);

  const enqueue = useCallback(
    (
      text: string,
      tone: ToastTone,
      duration: number,
      action?: { actionLabel: string; onAction: () => void; key?: string }
    ) => {
      const id = Date.now() + Math.random();
      setItems((prev) => {
        // 相同去重键：替换旧提示，保证同类动作提示始终只有一个（连续删除场景）
        const base = action?.key ? prev.filter((i) => i.key !== action.key) : prev;
        return [...base, { id, text, tone, actionLabel: action?.actionLabel, onAction: action?.onAction, key: action?.key }];
      });
      const leaveAt = window.setTimeout(
        () => setItems((prev) => prev.map((i) => (i.id === id ? { ...i, leaving: true } : i))),
        duration
      );
      const removeAt = window.setTimeout(() => remove(id), duration + TOAST_EXIT_MS);
      timers.current.push(leaveAt, removeAt);
    },
    [remove]
  );

  // 卸载时清理计时器，避免定时器泄漏（页面刷新/关闭时不会报错）
  useEffect(
    () => () => {
      for (const t of timers.current) window.clearTimeout(t);
      timers.current = [];
    },
    []
  );

  const toast = useCallback((text: string, tone: ToastTone = 'success') => enqueue(text, tone, TOAST_PLAIN_MS), [enqueue]);
  const toastAction = useCallback(
    (text: string, options: ToastActionOptions) =>
      enqueue(text, options.tone ?? 'info', options.duration ?? TOAST_ACTION_MS, {
        actionLabel: options.actionLabel,
        onAction: options.onAction,
        key: options.key,
      }),
    [enqueue]
  );

  const toastApi = useMemo(() => ({ toast, toastAction }), [toast, toastAction]);
  return (
    <ToastCtx.Provider value={toastApi}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-24 z-[80] flex flex-col items-center gap-2 px-4 md:bottom-6"
        aria-live="polite"
        data-fd-toast-root="1"
      >
        {items.map((item) => (
          <div
            key={item.id}
            role="status"
            data-fd-toast={item.tone}
            className={`lg-l1 lg-l1-heavy toast-liquid fd-toast-${item.tone} lg-toast-out-liquid relative pointer-events-auto flex items-center gap-2 rounded-full px-4 py-2 text-xs font-medium text-ink ${item.leaving ? 'fd-toast-out' : ''}`}
          >
            <span
              className={`grid h-4 w-4 place-items-center rounded-full text-white ${
                item.tone === 'error' ? 'bg-danger' : item.tone === 'info' ? 'bg-accent' : 'bg-success'
              }`}
              aria-hidden="true"
            >
              <Icon name={item.tone === 'error' ? 'close' : 'check'} size={10} strokeWidth={3} />
            </span>
            <span>{item.text}</span>
            {item.actionLabel && item.onAction ? (
              <button
                type="button"
                data-fd-toast-action="1"
                className="ml-1 rounded-full px-2 py-0.5 text-[11px] font-semibold text-accent-ink underline underline-offset-2 hover:bg-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fd-focus-ring)]"
                onClick={() => {
                  item.onAction?.();
                  remove(item.id);
                }}
              >
                {item.actionLabel}
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast 必须在 ToastProvider 内使用');
  return ctx;
}

/* ---------------- Confirm 玻璃确认框（alertdialog：需要明确确认） ---------------- */
interface ConfirmOptions {
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

interface ConfirmApi {
  confirm: (opt: ConfirmOptions) => Promise<boolean>;
}

const ConfirmCtx = createContext<ConfirmApi | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ opt: ConfirmOptions; resolve: (v: boolean) => void } | null>(null);
  const titleId = useId();
  const descId = useId();
  const close = useCallback(
    (v: boolean) => {
      setState((cur) => {
        cur?.resolve(v);
        return null;
      });
    },
    []
  );
  const confirm = useCallback(
    (opt: ConfirmOptions) => new Promise<boolean>((resolve) => setState({ opt, resolve })),
    []
  );
  const panelRef = useDialogFocus({ open: Boolean(state), onClose: () => close(false) });
  const confirmApi = useMemo(() => ({ confirm }), [confirm]);

  return (
    <ConfirmCtx.Provider value={confirmApi}>
      {children}
      {state ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-6">
          <div className="fd-fade-in lg-scrim-liquid absolute inset-0" onClick={() => close(false)} aria-hidden="true" />
          <div
            ref={panelRef}
            tabIndex={-1}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={state.opt.description ? descId : undefined}
            data-fd-confirm="1"
            data-fd-dialog="confirm"
            className="lg-l1 lg-l1-heavy lg-l3 glass-modal-liquid lg-sheet fd-confirm-panel relative z-10 w-full max-w-[380px] rounded-[24px] p-5 outline-none"
          >
            <h3 id={titleId} className="fd-t-h2 text-ink">
              {state.opt.title}
            </h3>
            {state.opt.description ? (
              <p id={descId} className="mt-2 text-xs leading-5 text-ink-2">
                {state.opt.description}
              </p>
            ) : null}
            <div className="mt-5 flex items-center justify-end gap-2">
              <button className="fd-btn-ghost" data-autofocus="true" onClick={() => close(false)}>
                {state.opt.cancelText ?? '取消'}
              </button>
              <button
                data-fd-confirm-ok="1"
                className={`fd-btn px-3.5 py-2 text-paper ${state.opt.danger ? 'bg-p1 hover:opacity-90' : 'bg-ink hover:opacity-85'}`}
                onClick={() => close(true)}
              >
                {state.opt.confirmText ?? '确认'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </ConfirmCtx.Provider>
  );
}

export function useConfirm(): ConfirmApi {
  const ctx = useContext(ConfirmCtx);
  if (!ctx) throw new Error('useConfirm 必须在 ConfirmProvider 内使用');
  return ctx;
}
