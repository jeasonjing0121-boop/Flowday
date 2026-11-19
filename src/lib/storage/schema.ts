import type { AppData } from '../../types';
import { sanitizeImportedData } from '../data';

/** 当前存储结构版本：每次数据结构升级 +1，并在此登记迁移路径。 */
export const CURRENT_SCHEMA_VERSION = 2;
/** 旧版本（localStorage / 旧备份）中的 AppData.version。 */
export const LEGACY_APP_VERSION = 1;

/** 存储记录：revision / writerId 为 Phase 4.3 新增的可选字段（旧记录缺少时按 revision=0 处理）。 */
export interface StoredState {
  schemaVersion: number;
  updatedAt: string;
  revision?: number;
  writerId?: string;
  data: AppData;
}

/** 同步元信息（权威版本依据，存于 meta store，几十字节）。 */
export interface SyncInfo {
  revision: number;
  updatedAt: string;
  writerId?: string;
}

export const INITIAL_REVISION = 0;

/** 解析失败原因：供上层区分「未来版本」与「结构损坏」，从而阻断写入而不是静默回退空数据。 */
export type SchemaFailureReason = 'too-new' | 'corrupt' | 'unrecognized';

/** 读取记录的 revision（兼容旧数据 / 非法值）。 */
export function revisionOf(record: { revision?: unknown } | null | undefined): number {
  if (!record) return INITIAL_REVISION;
  const value = record.revision;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return INITIAL_REVISION;
  return Math.floor(value);
}

/** 校验任意值是否为合法 SyncInfo。 */
export function isSyncInfo(value: unknown): value is SyncInfo {
  if (!value || typeof value !== 'object') return false;
  const info = value as Partial<SyncInfo>;
  if (typeof info.revision !== 'number' || !Number.isFinite(info.revision) || info.revision < 0) return false;
  if (typeof info.updatedAt !== 'string') return false;
  if (info.writerId !== undefined && typeof info.writerId !== 'string') return false;
  return true;
}

export type StoredParseResult =
  | { ok: true; data: AppData; fromVersion: number }
  | { ok: false; error: string; reason: SchemaFailureReason; storedVersion?: number };

/**
 * 校验并迁移一条已存储记录到当前 schema。
 * - 版本高于当前：拒绝（不降级、不迁移、不覆盖，避免破坏数据）
 * - 旧版本：v1 → v2 通过统一校验器规范化（越界优先级收敛到 1-3 级）
 * - 结构损坏：返回错误与原因码，调用方必须进入安全阻断状态（不得写入）
 */
export function migrateStoredState(raw: unknown): StoredParseResult {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: '数据不是有效对象', reason: 'corrupt' };
  }
  const record = raw as { schemaVersion?: unknown; data?: unknown; version?: unknown; tasks?: unknown };

  if (typeof record.schemaVersion === 'number') {
    if (record.schemaVersion > CURRENT_SCHEMA_VERSION) {
      return {
        ok: false,
        error: `数据版本 v${record.schemaVersion} 高于当前应用支持的 v${CURRENT_SCHEMA_VERSION}`,
        reason: 'too-new',
        storedVersion: record.schemaVersion,
      };
    }
    const data = sanitizeImportedData(record.data);
    if (!data) {
      return { ok: false, error: '已存储的数据结构不完整', reason: 'corrupt', storedVersion: record.schemaVersion };
    }
    return { ok: true, data, fromVersion: record.schemaVersion };
  }

  // 早期直接存储 AppData（version: 1）的记录
  if (record.version === LEGACY_APP_VERSION || Array.isArray(record.tasks)) {
    const data = sanitizeImportedData(record);
    if (!data) return { ok: false, error: '已存储的数据结构不完整', reason: 'corrupt' };
    return { ok: true, data, fromVersion: LEGACY_APP_VERSION };
  }

  return { ok: false, error: '无法识别的数据格式', reason: 'unrecognized' };
}

/** 收到其他标签页通知后应执行的动作（纯函数，便于单测）。 */
export type SyncDecision = 'none' | 'sync' | 'prompt';

export function decideSyncAction(input: {
  baseRevision: number;
  currentRevision: number;
  dirty: boolean;
}): SyncDecision {
  const { baseRevision, currentRevision, dirty } = input;
  if (currentRevision === baseRevision) return 'none';
  if (currentRevision > baseRevision) return dirty ? 'prompt' : 'sync';
  // 库中版本落后于本地基线（例如数据库被清空/回滚）：需要重新加载对齐
  return dirty ? 'prompt' : 'sync';
}
