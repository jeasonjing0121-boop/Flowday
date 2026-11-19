/** 最近一次成功导出时间记录（localStorage，仅本机提示用，不是备份历史）。 */

export const LAST_EXPORT_KEY = 'flowday.lastExportAt.v1';

/** 记录导出成功；存储不可用时返回 false（调用方不更新界面时间）。 */
export function recordExportSuccess(at: string = new Date().toISOString()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T/.test(at)) return false;
  try {
    localStorage.setItem(LAST_EXPORT_KEY, at);
    return true;
  } catch {
    return false;
  }
}

/** 读取上次成功导出时间；无记录/损坏/存储不可用时返回 null。 */
export function readLastExport(): string | null {
  try {
    const raw = localStorage.getItem(LAST_EXPORT_KEY);
    if (!raw) return null;
    if (!/^\d{4}-\d{2}-\d{2}T/.test(raw)) return null;
    if (!Number.isFinite(Date.parse(raw))) return null;
    return raw;
  } catch {
    return null;
  }
}

export function clearLastExport(): void {
  try {
    localStorage.removeItem(LAST_EXPORT_KEY);
  } catch {
    /* ignore */
  }
}
