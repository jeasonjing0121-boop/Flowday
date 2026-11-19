import { Modal } from './UI';
import { Icon } from './Icons';
import type { BackupValidation } from '../lib/storage/backup';
import { hasSanitizeChanges, summarizeSanitize } from '../lib/storage/importGuard';

export interface ImportPreviewInfo {
  fileName: string;
  fileSize: number;
  validation: BackupValidation;
  /** 打开预览时库中的权威 revision */
  baseRevision: number;
  /** 打开预览时本页是否存在未保存修改 */
  dirtyAtOpen: boolean;
}

const CHECKSUM_META: Record<string, { label: string; cls: string; icon: 'check' | 'flag' | 'close' }> = {
  verified: { label: 'SHA-256 校验通过', cls: 'text-success-ink', icon: 'check' },
  absent: { label: '未包含校验和（未做完整性校验）', cls: 'text-ink-3', icon: 'flag' },
  'unverified-legacy': { label: '旧格式：无校验和（未做完整性校验）', cls: 'text-p2', icon: 'flag' },
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 备份时间展示：合法 ISO → 本地时区时间；缺失 → 区分旧格式；非法（理论上已被校验层过滤）→ 明确文案。绝不显示 Invalid Date/NaN。 */
function formatExportedAt(value: string | undefined, legacy: boolean): string {
  if (!value) return legacy ? '未记录（旧格式）' : '未记录';
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return '无效时间';
  return new Date(parsed).toLocaleString();
}

/**
 * 导入预览弹窗（液态玻璃 Modal）：
 * - 展示备份时间 / 格式 / 校验状态 / 数量对比 / 清洗摘要与告警
 * - 校验失败：红色原因 + 禁止继续
 * - 预览期间数据版本变化：琥珀色冲突提示 + 禁用确认
 * - 存在未保存修改：琥珀色警告（确认时由调用方二次确认）
 */
export function ImportPreviewModal({
  preview,
  currentRevision,
  stale,
  exportedAt,
  busy = false,
  onClose,
  onConfirm,
}: {
  preview: ImportPreviewInfo;
  currentRevision: number;
  stale: boolean;
  exportedAt?: string;
  /** 导入进行中：禁用确认按钮并显示加载文案，防止重复提交 */
  busy?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const validation = preview.validation;
  const failed = !validation.ok;

  const checksumMeta = validation.ok ? CHECKSUM_META[validation.checksumStatus] : null;
  const formatLabel = failed
    ? '—'
    : validation.format === 'legacy'
      ? `旧版裸数据（无信封）· schema v${validation.schemaVersion}`
      : validation.formatVersion === 0
        ? `旧版信封 · schema v${validation.schemaVersion}`
        : `格式 v${validation.formatVersion} · schema v${validation.schemaVersion}`;

  const sanitizeLines = validation.ok && hasSanitizeChanges(validation.stats) ? summarizeSanitize(validation.stats) : [];

  return (
    <Modal
      open
      onClose={onClose}
      title="导入备份预览"
      footer={
        <>
          <button className="fd-btn-ghost" onClick={onClose}>
            取消
          </button>
          <button
            className={`fd-btn px-3.5 py-2 text-paper bg-p1 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40${busy ? ' fd-btn-loading' : ''}`}
            data-fd-import-confirm="1"
            disabled={failed || stale || busy}
            onClick={onConfirm}
          >
            {busy ? '导入中…' : '覆盖导入'}
          </button>
        </>
      }
    >
      <div data-fd-import-preview="1" className="space-y-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-3">
          <span className="truncate font-medium text-ink-2">{preview.fileName}</span>
          <span>{formatBytes(preview.fileSize)}</span>
          <span>格式：{formatLabel}</span>
          <span data-fd-import-exportedat={exportedAt ?? ''}>
            备份时间：{formatExportedAt(exportedAt, !validation.ok ? false : validation.format === 'legacy' || validation.formatVersion === 0)}
          </span>
        </div>

        {validation.ok && checksumMeta ? (
          <p className={`flex items-center gap-1.5 text-[11px] ${checksumMeta.cls}`} data-fd-import-checksum={validation.checksumStatus}>
            <Icon name={checksumMeta.icon} size={12} strokeWidth={2.4} />
            {checksumMeta.label}
          </p>
        ) : null}

        {failed ? (
          <div className="rounded-xl border border-p1/30 bg-p1/8 px-3 py-2" data-fd-import-error="1">
            <p className="flex items-start gap-1.5 text-[11px] leading-5 text-p1">
              <Icon name="close" size={12} strokeWidth={2.6} className="mt-0.5 shrink-0" />
              <span>校验失败，已禁止导入：{validation.error}</span>
            </p>
          </div>
        ) : null}

        {stale ? (
          <div className="rounded-xl border border-p2/30 bg-p2/8 px-3 py-2" data-fd-import-conflict="1">
            <p className="flex items-start gap-1.5 text-[11px] leading-5 text-p2">
              <Icon name="flag" size={12} strokeWidth={2.4} className="mt-0.5 shrink-0" />
              <span>
                预览之后数据已发生变化（版本 v{preview.baseRevision} → v{currentRevision}）。为避免覆盖最新修改，已禁用确认导入；请关闭后重新选择文件。
              </span>
            </p>
          </div>
        ) : null}

        {preview.dirtyAtOpen ? (
          <div className="rounded-xl border border-p2/30 bg-p2/8 px-3 py-2" data-fd-import-dirty="1">
            <p className="flex items-start gap-1.5 text-[11px] leading-5 text-p2">
              <Icon name="flag" size={12} strokeWidth={2.4} className="mt-0.5 shrink-0" />
              <span>本页存在尚未保存的修改，继续导入将丢弃这些修改（确认时会再次询问）。</span>
            </p>
          </div>
        ) : null}

        {validation.ok ? (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(
                [
                  ['任务', validation.stats.tasks],
                  ['项目', validation.stats.projects],
                  ['习惯', validation.stats.habits],
                  ['打卡', validation.stats.habitLogs],
                ] as [string, number][]
              ).map(([label, count]) => (
                <div key={label} className="rounded-xl border border-line bg-paper px-2.5 py-2 text-center">
                  <p className="fd-num text-base font-semibold text-ink">{count}</p>
                  <p className="text-[10px] text-ink-3">备份{label}</p>
                </div>
              ))}
            </div>
            <p className="text-[11px] leading-5 text-ink-3">
              导入将用备份内容整体替换当前数据（当前任务/习惯会被覆盖）。此操作通过版本校验原子写入，失败不会留下部分数据。
            </p>
            {sanitizeLines.length ? (
              <div className="rounded-xl border border-line bg-sunken/60 px-3 py-2">
                <p className="mb-1 text-[11px] font-medium text-ink-2">数据清洗摘要</p>
                <ul className="space-y-0.5 text-[11px] leading-5 text-ink-3">
                  {sanitizeLines.map((line) => (
                    <li key={line}>· {line}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {validation.warnings.length ? (
              <div className="max-h-[120px] overflow-y-auto rounded-xl border border-p2/25 bg-p2/6 px-3 py-2">
                <ul className="space-y-0.5 text-[11px] leading-5 text-ink-2">
                  {validation.warnings.map((w) => (
                    <li key={w}>· {w}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </Modal>
  );
}
