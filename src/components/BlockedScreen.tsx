import { useState } from 'react';
import type { BootBlocked } from '../lib/storage';
import { exportRawData, resetAllData } from '../lib/storage';
import { Icon } from './Icons';import { useConfirm, useToast } from './UI';

/** 阻断原因 → 用户可读文案（不暴露内部实现细节，只说明「发生了什么 / 我要做什么」）。 */
const REASON_COPY: Record<BootBlocked['reason'], { title: string; detail: string; action: string }> = {
  'schema-too-new': {
    title: '数据版本高于当前应用',
    detail:
      '本地数据库由更高版本的 FlowDay 写入。为避免写入不兼容的数据造成损坏，当前版本不会读取或修改任何数据。请升级到最新版本后再打开。',
    action: '升级应用后重试',
  },
  corrupt: {
    title: '本地数据结构无法识别',
    detail: '读取到的数据无法通过结构校验。为防止覆盖，应用已停止一切写入。建议先导出原始数据，再决定如何处理。',
    action: '导出原始数据后重试',
  },
  'read-failed': {
    title: '读取本地数据失败',
    detail: '读取过程中发生错误。应用已停止一切写入，你的原始数据不会被修改。可尝试重新加载；若持续失败，请先导出原始数据。',
    action: '重新加载',
  },
  unavailable: {
    title: '本地数据库不可用',
    detail: '当前浏览器环境不支持或禁用了 IndexedDB。FlowDay 依赖本地数据库保存数据，因此在修复前不会写入任何内容。',
    action: '更换浏览器或关闭隐私限制后重试',
  },
  'migration-conflict': {
    title: '检测到其他标签页写入',
    detail: '旧数据迁移时发现其他标签页已经写入了更新的数据，迁移已中止，原始数据保持原样。请关闭其他标签页后重试。',
    action: '关闭其他标签页后重试',
  },
};

/**
 * 安全阻断界面（Phase 5.0-a D0）。
 *
 * 设计约束：
 * - 只读：不写入、不清空、不迁移任何数据（清除按钮需要显式二次确认，且明确告知不可恢复）
 * - 明确告知用户「数据未被修改」并提供原始数据导出（证据留存）
 * - 与既有玻璃视觉体系一致
 */
export function BlockedScreen({ blocked }: { blocked: BootBlocked }) {
  const copy = REASON_COPY[blocked.reason];
  const { confirm } = useConfirm();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const onExport = async () => {
    setBusy(true);
    try {
      const bundle = await exportRawData(blocked.reason);
      if (!bundle) {
        toast('没有可导出的原始数据', 'info');
        return;
      }
      const text = JSON.stringify(bundle, null, 2);
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `flowday-raw-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast('已导出原始数据（只读操作，未修改数据库）', 'success');
    } finally {
      setBusy(false);
    }
  };

  const onReload = () => {
    window.location.reload();
  };

  const onReset = async () => {
    const ok = await confirm({
      title: '清除本地数据并重新开始？',
      description:
        '这会删除本机数据库中的任务、项目、习惯与设置，且无法撤销。仅在已导出原始数据、确认不再需要这些数据时执行。',
      confirmText: '确认清除',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await resetAllData();
      window.location.reload();
    } catch (err) {
      toast(`清除失败：${err instanceof Error ? err.message : '未知错误'}`, 'error');
      setBusy(false);
    }
  };

  return (
    <main
      data-fd-blocked={blocked.reason}
      className="flex min-h-dvh items-center justify-center bg-paper px-4 py-10"
      aria-labelledby="fd-blocked-title"
    >
      <div className="fd-glass fd-glass-modal fd-pop w-full max-w-[560px] rounded-[28px] p-6">
        <div className="flex items-start gap-3">
          <span className="fd-gradient-bg mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white" aria-hidden="true">
            <Icon name="flag" size={20} />
          </span>
          <div className="min-w-0">
            <h1 id="fd-blocked-title" className="fd-t-h2 text-ink">
              {copy.title}
            </h1>
            <p className="mt-1.5 text-xs leading-5 text-ink-2">{copy.detail}</p>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-line bg-sunken px-3 py-2.5 text-[11px] leading-5 text-ink-2">
          <p className="font-medium text-ink">数据保护状态</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            <li>应用已停止一切写入：不会覆盖、清空或迁移你的原始数据</li>
            <li>本次启动未写入任何示例数据</li>
            <li>{blocked.rawAvailable ? '仍可导出数据库中的原始记录用于留存' : '当前无法直接读取原始记录，请勿清除浏览器数据'}</li>
          </ul>
        </div>

        {blocked.message ? (
          <p className="mt-3 break-words rounded-lg border border-line-2 px-3 py-2 text-[11px] leading-5 text-ink-3">
            <span className="text-ink-2">技术信息：</span>
            {blocked.message}
            {blocked.storedVersion ? `（数据库版本 v${blocked.storedVersion}）` : ''}
          </p>
        ) : null}

        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[11px] text-ink-3">{copy.action}</p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="fd-btn-ghost" onClick={onReset} disabled={busy}>
              清除本地数据
            </button>
            <button
              type="button"
              className="fd-btn-ghost"
              onClick={onExport}
              disabled={busy || !blocked.rawAvailable}
              data-fd-blocked-export="1"
            >
              <Icon name="download" size={14} />
              导出原始数据
            </button>
            <button type="button" className="fd-btn-primary" onClick={onReload} disabled={busy}>
              <Icon name="refresh" size={14} />
              重新加载
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
