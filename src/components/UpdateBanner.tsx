import { useEffect, useState } from 'react';
import { applyPwaUpdate, isPwaUpdateReady, subscribePwaUpdate } from '../lib/pwa/register';
import { Icon } from './Icons';

/**
 * 新版本提示条（D4）。
 * 只提示、不自动激活：用户点「立即更新」才 skipWaiting；「稍后」本次隐藏。
 */
export function UpdateBanner() {
  const [ready, setReady] = useState(() => isPwaUpdateReady());
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => subscribePwaUpdate(() => setReady(isPwaUpdateReady())), []);

  if (!ready || dismissed) return null;

  return (
    <div
      role="status"
      data-fd-update-banner="1"
      className="fd-glass fd-glass-soft fd-pop mx-3 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl px-3 py-2 text-xs md:mx-6"
    >
      <span className="flex items-center gap-1.5 text-ink-2">
        <Icon name="refresh" size={14} className="text-accent" />
        发现新版本，可安全更新（页面会刷新一次）
      </span>
      <span className="flex items-center gap-1.5">
        <button type="button" className="fd-btn-ghost rounded-lg px-2.5 py-1 text-[11px]" onClick={() => setDismissed(true)}>
          稍后
        </button>
        <button
          type="button"
          className="fd-btn-primary px-3 py-1 text-[11px]"
          data-fd-update-apply="1"
          onClick={() => applyPwaUpdate()}
        >
          立即更新
        </button>
      </span>
    </div>
  );
}
