import type { AppData } from '../../types';

/** 冲突草稿：冲突发生时立即写入 localStorage（不依赖 pagehide/关闭事件）。
 *  恢复前不删除；恢复/丢弃由用户显式操作。 */

export const DRAFT_KEY = 'flowday.conflict-draft.v1';
/** 草稿上限（UTF-16 字符数近似；10k 任务约 2MB，留有余量） */
export const DRAFT_MAX_CHARS = 3 * 1024 * 1024;

export type DraftReason = 'conflict' | 'external-update';

export interface ConflictDraft {
  version: 1;
  savedAt: string;
  baseRevision: number;
  writerId: string;
  reason: DraftReason;
  data: AppData;
}

export type DraftSaveResult = { ok: true } | { ok: false; reason: 'too-large' | 'storage' };

function hasAppDataShape(value: unknown): value is AppData {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<AppData>;
  return Array.isArray(data.tasks) && Array.isArray(data.habits);
}

/** 校验草稿 JSON（损坏、字段缺失、版本不符、超限均返回 null）。 */
export function validateDraftRaw(raw: string | null | undefined): ConflictDraft | null {
  if (!raw) return null;
  if (raw.length > DRAFT_MAX_CHARS) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const draft = parsed as Partial<ConflictDraft>;
  if (draft.version !== 1) return null;
  if (typeof draft.savedAt !== 'string') return null;
  if (typeof draft.baseRevision !== 'number' || !Number.isFinite(draft.baseRevision) || draft.baseRevision < 0) return null;
  if (typeof draft.writerId !== 'string' || !draft.writerId) return null;
  if (draft.reason !== 'conflict' && draft.reason !== 'external-update') return null;
  if (!hasAppDataShape(draft.data)) return null;
  return {
    version: 1,
    savedAt: draft.savedAt,
    baseRevision: draft.baseRevision,
    writerId: draft.writerId,
    reason: draft.reason,
    data: draft.data as AppData,
  };
}

/** 立即保存草稿：处理超限与存储异常，返回结果供 UI 提示。 */
export function saveDraft(draft: ConflictDraft): DraftSaveResult {
  let raw: string;
  try {
    raw = JSON.stringify(draft);
  } catch {
    return { ok: false, reason: 'too-large' };
  }
  if (raw.length > DRAFT_MAX_CHARS) return { ok: false, reason: 'too-large' };
  try {
    localStorage.setItem(DRAFT_KEY, raw);
    return { ok: true };
  } catch {
    return { ok: false, reason: 'storage' };
  }
}

export function readDraft(): ConflictDraft | null {
  try {
    return validateDraftRaw(localStorage.getItem(DRAFT_KEY));
  } catch {
    return null;
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}
