import { useApp } from '../store/AppStore';
import { Icon } from './Icons';

/**
 * 跨标签页同步 / 冲突提示横幅。
 * - conflict：本页保存时发现库版本已前进（CAS 失败）→ 冲突三选一
 * - external-update：本页脏数据期间收到其他标签页更新 → 冲突三选一（不静默覆盖）
 * - recovering：启动时发现上次未保存的冲突草稿 → 恢复/导出/丢弃
 */
export function SyncBanner() {
  const { sync } = useApp();
  if (sync.status === 'idle') return null;

  const recovering = sync.status === 'recovering';
  const info = sync.info;
  const title = recovering ? '发现上次未保存的修改' : '检测到其他标签页的修改';
  const description = recovering
    ? `上次关闭时有未保存的修改（${sync.draft ? new Date(sync.draft.savedAt).toLocaleString() : ''}）。恢复前不会删除草稿。`
    : '本页有尚未保存的修改，已暂停自动保存并保存了草稿。请选择如何处理，避免覆盖其他标签页的数据。';

  return (
    <div
      className="fixed left-1/2 top-[80px] z-[60] w-[min(94vw,660px)] -translate-x-1/2 md:top-[88px]"
      data-fd-sync-banner={sync.status}
      role="status"
      aria-live="polite"
    >
      <div className="fd-glass fd-glass-soft fd-pop rounded-[20px] p-3.5">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-p2/15 text-p2">
            <Icon name={recovering ? 'refresh' : 'flag'} size={12} strokeWidth={2.4} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-ink">{title}</p>
            <p className="mt-0.5 text-[11px] leading-5 text-ink-2">{description}</p>
            {!recovering && info ? (
              <p className="mt-0.5 text-[10px] text-ink-3">
                库版本 v{info.revision}
                {info.updatedAt ? ` · ${new Date(info.updatedAt).toLocaleTimeString()}` : ''}
              </p>
            ) : null}
            {sync.draftError ? (
              <p className="mt-1 text-[10px] text-danger-ink">
                草稿保存失败（{sync.draftError === 'too-large' ? '数据过大' : '本地存储不可用'}），请先导出本页副本再处理。
              </p>
            ) : null}
          </div>
        </div>
        <div className="mt-2.5 flex flex-wrap items-center justify-end gap-2">
          {recovering ? (
            <>
              <button className="fd-btn-ghost rounded-full px-2.5 min-h-[24px] py-1 text-[11px]" data-fd-sync-action="discard-draft" onClick={sync.discardDraft}>
                丢弃草稿
              </button>
              <button className="fd-btn-soft rounded-full px-2.5 min-h-[24px] py-1 text-[11px]" data-fd-sync-action="export-local" onClick={sync.exportLocal}>
                导出副本
              </button>
              <button className="fd-btn-primary px-3 min-h-[24px] py-1 text-[11px]" data-fd-sync-action="restore-draft" onClick={sync.restoreDraft}>
                恢复修改
              </button>
            </>
          ) : (
            <>
              <button className="fd-btn-soft rounded-full px-2.5 min-h-[24px] py-1 text-[11px]" data-fd-sync-action="export-local" onClick={sync.exportLocal}>
                导出本页副本
              </button>
              <button
                className="fd-btn-ghost rounded-full px-2.5 min-h-[24px] py-1 text-[11px] text-danger-ink hover:bg-danger/10"
                data-fd-sync-action="overwrite-remote"
                onClick={sync.overwriteRemote}
              >
                以本页覆盖
              </button>
              <button className="fd-btn-primary px-3 min-h-[24px] py-1 text-[11px]" data-fd-sync-action="reload-remote" onClick={sync.reloadFromRemote}>
                重新加载（推荐）
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
