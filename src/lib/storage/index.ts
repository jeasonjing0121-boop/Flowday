import type { AppData } from '../../types';
import {
  clearAllStores,
  getMeta,
  getState,
  readStateWithSync,
  readSyncInfo,
  saveStateWithRevision,
  setMeta,
  SYNC_META_KEY,
  type SaveOutcome,
} from './db';
import { clearLegacyCopies, keepLegacyRollbackCopy, parseLegacyRaw, readLegacyRaw } from './legacy';
import {
  CURRENT_SCHEMA_VERSION,
  migrateStoredState,
  revisionOf,
  type StoredState,
  type SyncInfo,
  type SchemaFailureReason,
} from './schema';

const MIGRATION_META_KEY = 'legacyMigration:v1';
const MIGRATION_WRITER_ID = 'legacy-migration';

export type LoadSource = 'indexeddb' | 'legacy-migrated' | 'empty';

/**
 * 安全阻断原因：出现以下任一情况时，应用**不得写入、不得清空、不得重建**数据库，
 * 只允许读取原始记录用于导出与人工恢复。
 */
export type BootBlockReason =
  | 'schema-too-new' // 数据库由更高版本应用写入
  | 'corrupt' // 结构损坏 / 无法识别
  | 'read-failed' // 读取过程中抛出异常
  | 'unavailable' // 当前环境不支持或禁用 IndexedDB
  | 'migration-conflict'; // 旧数据迁移期间检测到其他标签页已写入

/** 安全阻断信息（Phase 5.0-a D0）：一旦存在，调用方必须进入阻断 UI 并停止一切写入。 */
export interface BootBlocked {
  reason: BootBlockReason;
  message: string;
  /** 是否仍能读取原始记录（决定「导出原始数据」是否可用） */
  rawAvailable: boolean;
  /** 原始记录中声明的 schemaVersion（用于「请升级应用」提示） */
  storedVersion?: number;
}

/**
 * 初始化结果。
 *
 * 保持 Phase 4.3 以来的既有字段（data/source/migrated/error/revision/updatedAt/schemaVersion）不变，
 * 以便既有测试与调用方零改动；新增 blocked 字段表达「必须阻断写入」的语义。
 *
 * 约定：
 * - data 非空 → 正常加载（indexeddb 或 legacy-migrated）
 * - data 为空且 error 为空且 blocked 为空 → 真正的首次安装（允许写入种子数据）
 * - blocked 非空 → 安全阻断（禁止任何写入）
 */
export interface InitResult {
  data: AppData | null;
  source: LoadSource;
  /** 旧数据迁移是否发生（用于弹 Toast） */
  migrated: boolean;
  /** 初始化异常信息（不覆盖原数据，调用方回退示例数据并提示） */
  error?: string;
  schemaVersion: number;
  /** 当前数据版本（权威 revision） */
  revision: number;
  updatedAt: string;
  /** Phase 5.0-a 新增：安全阻断信息（存在即禁止写入） */
  blocked?: BootBlocked | null;
  /** Phase 5.0-a 新增：本次是否为「首次安装写入种子数据」（用于上层跳过回声保存） */
  seeded?: boolean;
}

export interface Snapshot {
  data: AppData;
  revision: number;
  updatedAt: string;
  writerId?: string;
}

/** 原始数据导出包（阻断时供用户保留证据；内容为数据库原始记录，未经规范化）。 */
export interface RawExportBundle {
  app: 'flowday-raw-export';
  exportedAt: string;
  schemaVersion: number;
  storedVersion?: number;
  blockReason?: BootBlockReason;
  state: unknown;
  syncMeta: unknown;
  legacy: unknown;
}

function emptyInit(partial: Partial<InitResult> = {}): InitResult {
  return {
    data: null,
    source: 'empty',
    migrated: false,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    revision: 0,
    updatedAt: '',
    ...partial,
  };
}

function blockedInit(blocked: BootBlocked, partial: Partial<InitResult> = {}): InitResult {
  return emptyInit({ error: blocked.message, blocked, ...partial });
}

function blockFromSchema(reason: SchemaFailureReason, message: string, storedVersion?: number): BootBlocked {
  const mapped: BootBlockReason = reason === 'too-new' ? 'schema-too-new' : 'corrupt';
  return { reason: mapped, message, rawAvailable: true, storedVersion };
}

async function currentSync(stored: StoredState): Promise<SyncInfo> {
  try {
    return await readSyncInfo();
  } catch {
    return { revision: revisionOf(stored), updatedAt: stored.updatedAt ?? '', writerId: stored.writerId };
  }
}

/**
 * 初始化数据层（应用启动调用一次）：
 * 1. 打开 IndexedDB → 读取 state（含 revision）→ 规范化/结构迁移
 * 2. 无 state 且存在旧 localStorage → 以 revision=0 做一次 CAS 写入后迁移（防止多标签重复迁移）
 * 3. 迁移过但 state 缺失（用户清空过）→ 不再重复迁移
 *
 * Phase 5.0-a D0（数据安全）：
 * - 任何保存失败/版本不兼容/读取异常都返回 blocked，调用方必须停止一切写入
 * - 绝不返回「空数据 + 成功」来掩盖错误（区分 fresh / blocked）
 * - 绝不自动清空、迁移或重建已有数据库
 */
export async function initializeStorage(): Promise<InitResult> {
  if (typeof indexedDB === 'undefined') {
    return blockedInit({
      reason: 'unavailable',
      message: '当前浏览器环境不支持或禁用了 IndexedDB 本地数据库，FlowDay 无法安全保存数据',
      rawAvailable: false,
    });
  }

  let stored: StoredState | null;
  try {
    stored = await getState();
  } catch (err) {
    // 读取失败：数据库可能仍存有用户数据 → 阻断写入，保留原数据
    return blockedInit({
      reason: 'read-failed',
      message: `读取本地数据库失败：${err instanceof Error ? err.message : '未知错误'}（原始数据未被修改）`,
      rawAvailable: false,
    });
  }

  if (stored) {
    const parsed = migrateStoredState(stored);
    if (!parsed.ok) {
      // 未来版本 / 结构损坏：不降级、不迁移、不覆盖
      const revision = revisionOf(stored);
      return blockedInit(blockFromSchema(parsed.reason, parsed.error, parsed.storedVersion), {
        revision,
        updatedAt: stored.updatedAt ?? '',
      });
    }
    const info = await currentSync(stored);
    return {
      data: parsed.data,
      source: 'indexeddb',
      migrated: false,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      revision: info.revision,
      updatedAt: info.updatedAt,
      blocked: null,
    };
  }

  let migrationMeta: { at: string } | undefined;
  try {
    migrationMeta = await getMeta<{ at: string }>(MIGRATION_META_KEY);
  } catch (err) {
    return blockedInit({
      reason: 'read-failed',
      message: `读取迁移元信息失败：${err instanceof Error ? err.message : '未知错误'}`,
      rawAvailable: false,
    });
  }
  if (migrationMeta) {
    // 已迁移过，但当前数据库为空（用户主动清空过）：不再回灌旧数据
    return emptyInit();
  }

  const legacyRaw = readLegacyRaw();
  if (!legacyRaw) {
    // 真正的首次安装：允许调用方写入种子数据
    return emptyInit();
  }

  const parsed = parseLegacyRaw(legacyRaw);
  if (!parsed.ok) {
    return blockedInit({
      reason: 'corrupt',
      message: `旧数据迁移失败：${parsed.error}（原始数据已保留，未做任何修改）`,
      rawAvailable: true,
    });
  }

  try {
    const outcome = await saveStateWithRevision(parsed.data, 0, MIGRATION_WRITER_ID);
    if (!outcome.ok) {
      return blockedInit(
        {
          reason: 'migration-conflict',
          message: `旧数据迁移时检测到其他标签页已写入数据（当前版本 ${outcome.conflict.revision}），原始数据已保留`,
          rawAvailable: true,
        },
        { revision: outcome.conflict.revision, updatedAt: outcome.conflict.updatedAt }
      );
    }
    await setMeta(MIGRATION_META_KEY, { at: new Date().toISOString(), from: 'localStorage', revision: outcome.revision });
    keepLegacyRollbackCopy(legacyRaw);
    return {
      data: parsed.data,
      source: 'legacy-migrated',
      migrated: true,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      revision: outcome.revision,
      updatedAt: outcome.updatedAt,
      blocked: null,
    };
  } catch (err) {
    return blockedInit({
      reason: 'read-failed',
      message: `旧数据迁移失败：${err instanceof Error ? err.message : '写入数据库失败'}（原始数据已保留）`,
      rawAvailable: true,
    });
  }
}

/** 读取最新快照（含权威 revision），用于跨标签同步/冲突恢复。 */
export async function loadSnapshot(): Promise<Snapshot | null> {
  // 单事务一致读：revision 与 data 来自同一版本，避免并发写入下的混合读
  const { state, sync } = await readStateWithSync();
  if (!state) return null;
  const parsed = migrateStoredState(state);
  if (!parsed.ok) throw new Error(`本地数据异常：${parsed.error}`);
  const info = sync ?? { revision: revisionOf(state), updatedAt: state.updatedAt ?? '', writerId: state.writerId };
  return { data: parsed.data, revision: info.revision, updatedAt: info.updatedAt, writerId: state.writerId };
}

/** 读取当前状态（不含初始化/迁移逻辑，用于校验与调试）。 */
export async function readStoredState(): Promise<StoredState | null> {
  return getState();
}

/**
 * Phase 5.0-a D0：导出数据库原始记录（未经规范化），供安全阻断时的证据留存。
 * 只读：不写入、不清空、不迁移。
 */
export async function exportRawData(reason?: BootBlockReason): Promise<RawExportBundle | null> {
  let state: unknown = null;
  let syncMeta: unknown = null;
  let legacy: unknown = null;
  try {
    state = await getState();
  } catch {
    /* 读取失败时保持 null，仍尝试其余来源 */
  }
  try {
    syncMeta = await getMeta<unknown>(SYNC_META_KEY);
  } catch {
    /* 忽略 */
  }
  const legacyRaw = readLegacyRaw();
  if (legacyRaw) {
    try {
      legacy = JSON.parse(legacyRaw);
    } catch {
      legacy = legacyRaw;
    }
  }
  if (!state && !legacy) return null;
  const storedVersion =
    state && typeof state === 'object' && typeof (state as { schemaVersion?: unknown }).schemaVersion === 'number'
      ? (state as { schemaVersion: number }).schemaVersion
      : undefined;
  return {
    app: 'flowday-raw-export',
    exportedAt: new Date().toISOString(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    storedVersion,
    blockReason: reason,
    state,
    syncMeta,
    legacy,
  };
}

/**
 * 保存整份状态（唯一写入口）：CAS 比对 baseRevision，冲突时返回库中最新版本，不写入任何数据。
 */
export async function saveAppData(
  data: AppData,
  options: { baseRevision: number; writerId: string }
): Promise<SaveOutcome> {
  return saveStateWithRevision(data, options.baseRevision, options.writerId);
}

/**
 * 以本页覆盖：先读取最新 revision，再以该 revision 为基线做一次 CAS。
 * 不使用无条件写入；若读取后又被其他标签页抢先写入，仍会返回冲突（不会静默覆盖）。
 */
export async function forceSaveAppData(data: AppData, writerId: string): Promise<SaveOutcome> {
  const info = await readSyncInfo();
  return saveStateWithRevision(data, info.revision, writerId);
}

export { readSyncInfo };
export type { SaveOutcome, SyncInfo };

/** 重置：清空数据库内容、元信息、旧数据与回滚副本。仅允许由用户在阻断页/设置页显式确认后调用。 */
export async function resetAllData(): Promise<void> {
  await clearAllStores();
  clearLegacyCopies();
}

export interface StorageInfo {
  engine: 'indexeddb';
  schemaVersion: number;
  updatedAt?: string;
  revision?: number;
}

export async function getStorageInfo(): Promise<StorageInfo> {
  const stored = await getState();
  const info = await readSyncInfo().catch(() => null);
  return {
    engine: 'indexeddb',
    schemaVersion: stored?.schemaVersion ?? CURRENT_SCHEMA_VERSION,
    updatedAt: info?.updatedAt ?? stored?.updatedAt,
    revision: info?.revision,
  };
}

export { CURRENT_SCHEMA_VERSION };
export type { StoredState, SchemaFailureReason };
