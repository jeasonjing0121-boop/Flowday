import type { AppData } from '../../types';
import { sanitizeImportedDataDetailed, type SanitizeStats } from '../data';
import { CURRENT_SCHEMA_VERSION, LEGACY_APP_VERSION } from './schema';

/** 备份信封格式版本（与 AppData 的 schemaVersion 独立） */
export const BACKUP_FORMAT_VERSION = 1;
/** 导入文件大小上限（UTF-8 字节） */
export const BACKUP_MAX_BYTES = 20 * 1024 * 1024;
export const CHECKSUM_ALG_NAME = 'sha-256';

export interface BackupChecksum {
  alg: 'sha-256';
  value: string;
}

export interface BackupCounts {
  tasks: number;
  projects: number;
  habits: number;
  habitLogs: number;
}

export interface BackupFile {
  app: 'FlowDay';
  formatVersion: number;
  schemaVersion: number;
  exportedAt: string;
  counts: BackupCounts;
  checksum: BackupChecksum | null;
  data: AppData;
}

export type ChecksumStatus = 'verified' | 'absent' | 'unverified-legacy';
export type ImportStats = SanitizeStats;

export type BackupValidation =
  | {
      ok: true;
      data: AppData;
      schemaVersion: number;
      format: 'backup' | 'legacy';
      formatVersion: number;
      checksumStatus: ChecksumStatus;
      stats: ImportStats;
      warnings: string[];
      exportedAt?: string;
    }
  | { ok: false; error: string };

/**
 * 校验和的计算范围与规范化规则（生成与验证必须使用同一函数）：
 * - 范围：仅 `data` 字段（不含 app/formatVersion/schemaVersion/exportedAt/counts/checksum）
 * - 规范化：`JSON.stringify(data)` 紧凑序列化（无空白、键序按对象插入顺序、数组顺序保持原样）
 * - 摘要：对上述字符串做 UTF-8 编码后计算 SHA-256，输出小写 hex
 */
export function canonicalBackupPayload(data: unknown): string {
  return JSON.stringify(data);
}

/** 计算 SHA-256；运行环境不支持 crypto.subtle 时返回 null（调用方不得视为校验通过）。 */
export async function sha256Hex(input: string): Promise<string | null> {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return null;
    const bytes = new TextEncoder().encode(input);
    const digest = await subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

export function countData(data: AppData): BackupCounts {
  return {
    tasks: data.tasks.length,
    projects: data.projects.length,
    habits: data.habits.length,
    habitLogs: data.habitLogs.length,
  };
}

/** 生成带格式版本与 SHA-256 校验和的备份对象。 */
export async function createBackup(data: AppData): Promise<BackupFile> {
  const checksumHex = await sha256Hex(canonicalBackupPayload(data));
  return {
    app: 'FlowDay',
    formatVersion: BACKUP_FORMAT_VERSION,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    counts: countData(data),
    checksum: checksumHex ? { alg: 'sha-256', value: checksumHex } : null,
    data,
  };
}

function byteLength(raw: string): number {
  return new TextEncoder().encode(raw).length;
}

/** 读取并校验备份时间：仅接受可解析的 ISO 字符串，缺失/非法一律返回 undefined（UI 做兜底文案）。 */
export function readExportedAt(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  if (!Number.isFinite(Date.parse(value))) return undefined;
  return value;
}

function readRawCounts(data: unknown): BackupCounts {
  const obj = (data && typeof data === 'object' ? data : {}) as Partial<AppData>;
  return {
    tasks: Array.isArray(obj.tasks) ? obj.tasks.length : 0,
    projects: Array.isArray(obj.projects) ? obj.projects.length : 0,
    habits: Array.isArray(obj.habits) ? obj.habits.length : 0,
    habitLogs: Array.isArray(obj.habitLogs) ? obj.habitLogs.length : 0,
  };
}

/**
 * 详细校验（备份导入使用）：
 * 1) 文件大小（UTF-8 字节）≤ BACKUP_MAX_BYTES，超限不解析
 * 2) JSON 合法、必须是 FlowDay 备份或旧版裸 AppData
 * 3) formatVersion 必须是 1..BACKUP_FORMAT_VERSION（缺失视为旧版信封 0；高于当前直接拒绝）
 * 4) schemaVersion 不得高于当前支持版本
 * 5) 校验和存在时必须验证：不匹配 → 拒绝；环境不支持 SHA-256 → 拒绝（绝不标记为校验通过）
 * 6) 数据经 sanitizeImportedDataDetailed 规范化，所有修正进入 stats/warnings
 */
export async function validateBackupDetailed(raw: string): Promise<BackupValidation> {
  const bytes = byteLength(raw);
  if (bytes > BACKUP_MAX_BYTES) {
    return { ok: false, error: `备份文件过大（${(bytes / 1024 / 1024).toFixed(1)} MB，上限 ${BACKUP_MAX_BYTES / 1024 / 1024} MB）` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: '文件不是合法的 JSON' };
  }
  if (!parsed || typeof parsed !== 'object') return { ok: false, error: '备份内容不是有效对象' };
  const obj = parsed as Record<string, unknown>;

  const wrappedLike = obj.app !== undefined || obj.formatVersion !== undefined || typeof obj.schemaVersion === 'number';
  if (!wrappedLike) {
    // 旧版：直接导出的 AppData（version: 1）
    const result = sanitizeImportedDataDetailed(obj);
    if (!result.data) return { ok: false, error: '无法识别的备份格式（缺少版本信息与有效数据结构）' };
    return {
      ok: true,
      data: result.data,
      schemaVersion: LEGACY_APP_VERSION,
      format: 'legacy',
      formatVersion: 0,
      checksumStatus: 'unverified-legacy',
      stats: result.stats,
      warnings: ['旧版格式：无格式版本与校验和，未做完整性校验', ...result.warnings],
      exportedAt: readExportedAt(obj.exportedAt),
    };
  }

  if (obj.app !== 'FlowDay') {
    return { ok: false, error: '不是 FlowDay 备份文件（缺少 app=FlowDay 标记）' };
  }

  // 格式版本
  let formatVersion = 0;
  if (obj.formatVersion !== undefined) {
    const version = Number(obj.formatVersion);
    if (!Number.isInteger(version) || version < 1) return { ok: false, error: '备份格式版本信息无效' };
    if (version > BACKUP_FORMAT_VERSION) {
      return { ok: false, error: `备份格式版本 v${version} 高于当前应用支持的 v${BACKUP_FORMAT_VERSION}，请升级应用后再导入` };
    }
    formatVersion = version;
  }

  // 数据结构版本
  const schemaVersion = Number(obj.schemaVersion);
  if (!Number.isFinite(schemaVersion) || schemaVersion < 1) return { ok: false, error: '备份缺少有效的版本信息' };
  if (schemaVersion > CURRENT_SCHEMA_VERSION) {
    return { ok: false, error: `备份版本 v${schemaVersion} 高于当前应用支持的 v${CURRENT_SCHEMA_VERSION}，请升级应用后再导入` };
  }

  const warnings: string[] = [];
  let checksumStatus: ChecksumStatus = formatVersion === 0 ? 'unverified-legacy' : 'absent';
  if (formatVersion === 0) warnings.push('旧版备份格式：无格式版本与校验和，未做完整性校验');

  // 校验和
  if (obj.checksum !== undefined && obj.checksum !== null) {
    const checksum = obj.checksum as Partial<BackupChecksum> | null;
    if (
      !checksum ||
      typeof checksum !== 'object' ||
      checksum.alg !== CHECKSUM_ALG_NAME ||
      typeof checksum.value !== 'string' ||
      !/^[0-9a-fA-F]{64}$/.test(checksum.value)
    ) {
      return { ok: false, error: '备份校验和字段无效' };
    }
    const expected = checksum.value.toLowerCase();
    const actual = await sha256Hex(canonicalBackupPayload(obj.data));
    if (!actual) {
      return { ok: false, error: '当前环境不支持 SHA-256 校验，无法验证该备份的完整性（请在 localhost 或 HTTPS 下导入）' };
    }
    if (actual !== expected) {
      return { ok: false, error: '备份校验和不匹配：文件可能被修改或已损坏，已拒绝导入' };
    }
    checksumStatus = 'verified';
  } else if (formatVersion >= 1) {
    warnings.push('该备份未包含校验和，未做完整性校验');
  }

  // 计数字段与实际内容一致性（信息性告警，不阻断）
  if (obj.counts && typeof obj.counts === 'object') {
    const declared = obj.counts as Partial<BackupCounts>;
    const actual = readRawCounts(obj.data);
    const mismatch =
      (typeof declared.tasks === 'number' && declared.tasks !== actual.tasks) ||
      (typeof declared.projects === 'number' && declared.projects !== actual.projects) ||
      (typeof declared.habits === 'number' && declared.habits !== actual.habits) ||
      (typeof declared.habitLogs === 'number' && declared.habitLogs !== actual.habitLogs);
    if (mismatch) warnings.push('备份计数字段与实际内容不一致（已按实际内容校验）');
  }

  const result = sanitizeImportedDataDetailed(obj.data);
  if (!result.data) return { ok: false, error: '备份数据结构不完整（缺少 tasks/habits 或字段损坏）' };

  return {
    ok: true,
    data: result.data,
    schemaVersion,
    format: 'backup',
    formatVersion,
    checksumStatus,
    stats: result.stats,
    warnings: [...warnings, ...result.warnings],
    exportedAt: readExportedAt(obj.exportedAt),
  };
}

/** 兼容旧调用：返回 {ok,data,schemaVersion,format}。 */
export async function validateBackup(
  raw: string
): Promise<{ ok: true; data: AppData; schemaVersion: number; format: 'backup' | 'legacy' } | { ok: false; error: string }> {
  const result = await validateBackupDetailed(raw);
  if (!result.ok) return result;
  return { ok: true, data: result.data, schemaVersion: result.schemaVersion, format: result.format };
}

/**
 * 触发浏览器下载备份文件。
 * 返回校验和状态：'verified' 表示已附带 SHA-256；'unverified' 表示当前环境不支持 crypto.subtle（文件未附加校验和）。
 */
export async function downloadBackup(data: AppData): Promise<'verified' | 'unverified'> {
  const backup = await createBackup(data);
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `flowday-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  return backup.checksum ? 'verified' : 'unverified';
}
