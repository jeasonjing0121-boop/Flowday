import type { AppData } from '../../types';
import { sanitizeImportedData } from '../data';

/** 旧版应用使用的 localStorage 键（v0.x）。 */
export const LEGACY_STORAGE_KEY = 'flowday.v1';
/** 迁移后保留的回滚副本键（不参与日常读写）。 */
export const LEGACY_BACKUP_KEY = 'flowday.legacy-backup.v1';

export type LegacyParseResult = { ok: true; data: AppData } | { ok: false; error: string };

/** 解析旧版 localStorage 原始 JSON：校验失败返回错误，绝不抛异常。 */
export function parseLegacyRaw(raw: string): LegacyParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: '旧数据不是合法 JSON' };
  }
  const record = parsed as { tasks?: unknown; habits?: unknown; data?: unknown } | null;
  if (!record || typeof record !== 'object') return { ok: false, error: '旧数据不是有效对象' };
  // 兼容「直接存 AppData」与「{version,data}」两种历史结构
  const candidate = Array.isArray(record.tasks) && Array.isArray(record.habits) ? record : record.data;
  const data = sanitizeImportedData(candidate);
  if (!data) return { ok: false, error: '旧数据结构不完整（缺少 tasks/habits）' };
  return { ok: true, data };
}

/** 读取旧版 localStorage；访问受限（隐私模式等）时返回 null。 */
export function readLegacyRaw(): string | null {
  try {
    return localStorage.getItem(LEGACY_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** 迁移成功后保留一份回滚副本（已存在则不覆盖）。 */
export function keepLegacyRollbackCopy(raw: string): void {
  try {
    if (!localStorage.getItem(LEGACY_BACKUP_KEY)) {
      localStorage.setItem(LEGACY_BACKUP_KEY, raw);
    }
  } catch {
    // 回滚副本写入失败不影响迁移结果
  }
}

/** 用户显式清空数据时，一并清除旧数据与回滚副本，避免被再次迁移。 */
export function clearLegacyCopies(): void {
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    localStorage.removeItem(LEGACY_BACKUP_KEY);
  } catch {
    // ignore
  }
}

export function hasLegacyRollbackCopy(): boolean {
  try {
    return Boolean(localStorage.getItem(LEGACY_BACKUP_KEY));
  } catch {
    return false;
  }
}
