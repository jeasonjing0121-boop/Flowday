/** 浏览器持久化存储状态查询与申请（navigator.storage.persist）。
 *  只展示真实结果：请求返回 true 后仍会重新查询 persisted() 确认授权，
 *  不把"请求成功"当作"已授权"，也不夸大 IndexedDB 的安全保证。 */

export type PersistState = 'granted' | 'not-granted' | 'unsupported';
export type PersistRequestResult = 'granted' | 'denied' | 'unsupported' | 'failed';

function storageManager(): StorageManager | null {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage) return null;
    if (typeof navigator.storage.persisted !== 'function') return null;
    return navigator.storage;
  } catch {
    return null;
  }
}

/** 查询当前真实授权状态。 */
export async function queryPersistState(): Promise<PersistState> {
  const manager = storageManager();
  if (!manager) return 'unsupported';
  try {
    const persisted = await manager.persisted();
    return persisted ? 'granted' : 'not-granted';
  } catch {
    return 'unsupported';
  }
}

/** 申请持久化：调用 persist() 后重新查询确认；异常视为 failed。 */
export async function requestPersist(): Promise<PersistRequestResult> {
  const manager = storageManager();
  if (!manager || typeof manager.persist !== 'function') return 'unsupported';
  try {
    await manager.persist();
  } catch {
    return 'failed';
  }
  const after = await queryPersistState();
  if (after === 'unsupported') return 'failed';
  return after === 'granted' ? 'granted' : 'denied';
}

export const PERSIST_STATE_TEXT: Record<PersistState, string> = {
  granted: '已授权：浏览器通常不会自动清理本站数据（仅本机，不是云备份）',
  'not-granted': '未授权：浏览器在存储紧张时可能清理本站数据，建议定期导出备份',
  unsupported: '当前浏览器不支持持久化存储接口，建议定期导出备份',
};

export const PERSIST_REQUEST_TEXT: Record<PersistRequestResult, string> = {
  granted: '已获得持久化存储授权',
  denied: '浏览器未授予持久化存储（仍可正常使用，建议定期导出备份）',
  unsupported: '当前浏览器不支持持久化存储接口',
  failed: '持久化存储请求失败，请稍后重试',
};
