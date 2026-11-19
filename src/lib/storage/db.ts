import type { AppData } from '../../types';
import {
  CURRENT_SCHEMA_VERSION,
  isSyncInfo,
  revisionOf,
  type StoredState,
  type SyncInfo,
} from './schema';

export const DB_NAME = 'flowday-db';
export const DB_VERSION = 1;
export const APP_STORE = 'app';
export const META_STORE = 'meta';
export const STATE_KEY = 'state';
/** 同步元信息记录键（权威 revision 来源，几十字节，避免每次保存读取整份数据） */
export const SYNC_META_KEY = 'sync:v1';

const OPEN_TIMEOUT_MS = 8000;
let dbPromise: Promise<IDBDatabase> | null = null;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        window.clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/** 打开（并在首次使用时创建）数据库；失败时抛错，由上层提示用户。 */
export function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前环境不支持 IndexedDB'));
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      reject(err instanceof Error ? err : new Error('无法打开本地数据库'));
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(APP_STORE)) db.createObjectStore(APP_STORE);
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error('本地数据库打开失败'));
    request.onblocked = () => reject(new Error('本地数据库被其他标签页占用，请关闭其他 FlowDay 页面后重试'));
  });
  dbPromise = withTimeout(opening, OPEN_TIMEOUT_MS, '本地数据库打开超时').catch((err) => {
    dbPromise = null;
    throw err;
  });
  return dbPromise;
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('数据库事务失败'));
    tx.onabort = () => reject(tx.error ?? new Error('数据库事务已中止'));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('数据库读取失败'));
  });
}

async function store(mode: IDBTransactionMode, name: string): Promise<{ tx: IDBTransaction; os: IDBObjectStore }> {
  const db = await openDatabase();
  const tx = db.transaction(name, mode);
  return { tx, os: tx.objectStore(name) };
}

/** 读取整份应用状态记录（含 schemaVersion 包装）。 */
export async function getState(): Promise<StoredState | null> {
  const { os } = await store('readonly', APP_STORE);
  const value = await requestResult<StoredState | undefined>(os.get(STATE_KEY));
  return value ?? null;
}

/** 原样读取记录（用于诊断/测试，不做规范化）。 */
export async function getRawState(): Promise<unknown> {
  return getState();
}

function deriveSync(record: StoredState | undefined | null): SyncInfo {
  if (!record) return { revision: 0, updatedAt: '' };
  return { revision: revisionOf(record), updatedAt: record.updatedAt ?? '', writerId: record.writerId };
}

/**
 * 读取权威同步版本：优先 meta 的 sync:v1 小记录；旧库没有时从 state 记录推导。
 * 使用只读事务回调链，避免 await 中间态导致事务提前提交。
 */
export function readSyncInfo(): Promise<SyncInfo> {
  return openDatabase().then(
    (db) =>
      new Promise<SyncInfo>((resolve, reject) => {
        let result: SyncInfo | null = null;
        let failed = false;
        let tx: IDBTransaction;
        try {
          tx = db.transaction([META_STORE, APP_STORE], 'readonly');
        } catch (err) {
          reject(err instanceof Error ? err : new Error('无法读取同步版本'));
          return;
        }
        const metaStore = tx.objectStore(META_STORE);
        const appStore = tx.objectStore(APP_STORE);
        const fail = (err: unknown) => {
          failed = true;
          reject(err instanceof Error ? err : new Error('读取同步版本失败'));
        };
        const readMeta = metaStore.get(SYNC_META_KEY);
        readMeta.onsuccess = () => {
          const raw = readMeta.result;
          if (isSyncInfo(raw)) {
            result = raw;
            return;
          }
          const readState = appStore.get(STATE_KEY);
          readState.onsuccess = () => {
            result = deriveSync(readState.result as StoredState | undefined);
          };
          readState.onerror = () => fail(readState.error);
        };
        readMeta.onerror = () => fail(readMeta.error);
        tx.oncomplete = () => {
          if (failed) return;
          if (result) resolve(result);
          else reject(new Error('无法读取当前数据版本'));
        };
        tx.onabort = () => {
          if (!failed) reject(tx.error ?? new Error('读取同步版本事务已中止'));
        };
      })
  );
}

/**
 * 单事务一致读：在同一条 readonly 事务中读取 state 与 sync 元信息，
 * 避免并发写入时"revision 与数据跨版本"的混合读（loadSnapshot/forceSave 依赖一致性）。
 */
export function readStateWithSync(): Promise<{ state: StoredState | null; sync: SyncInfo | null }> {
  return openDatabase().then(
    (db) =>
      new Promise<{ state: StoredState | null; sync: SyncInfo | null }>((resolve, reject) => {
        let state: StoredState | null = null;
        let sync: SyncInfo | null = null;
        let failed = false;
        let tx: IDBTransaction;
        try {
          tx = db.transaction([APP_STORE, META_STORE], 'readonly');
        } catch (err) {
          reject(err instanceof Error ? err : new Error('无法开始读取事务'));
          return;
        }
        const fail = (err: unknown) => {
          failed = true;
          reject(err instanceof Error ? err : new Error('读取事务失败'));
        };
        const stateReq = tx.objectStore(APP_STORE).get(STATE_KEY);
        const metaReq = tx.objectStore(META_STORE).get(SYNC_META_KEY);
        stateReq.onsuccess = () => {
          state = (stateReq.result as StoredState | undefined) ?? null;
        };
        stateReq.onerror = () => fail(stateReq.error);
        metaReq.onsuccess = () => {
          const raw = metaReq.result;
          sync = isSyncInfo(raw) ? raw : null;
        };
        metaReq.onerror = () => fail(metaReq.error);
        tx.oncomplete = () => {
          if (failed) return;
          resolve({ state, sync });
        };
        tx.onabort = () => {
          if (!failed) reject(tx.error ?? new Error('读取事务已中止'));
        };
      })
  );
}

export interface SaveSuccess {
  ok: true;
  revision: number;
  updatedAt: string;
  writerId: string;
}

export interface SaveConflict {
  ok: false;
  conflict: SyncInfo;
}

export type SaveOutcome = SaveSuccess | SaveConflict;

/**
 * 原子 CAS 写入（唯一写入口）：
 * 在同一个 readwrite 事务中读取 meta revision → 与 baseRevision 比较 → 写整份 state + 新 revision。
 * IndexedDB 对同 scope 的 readwrite 事务串行执行，因此"比较 + 写入"是原子的，两个标签页只有一个能成功。
 * 冲突时不写入任何数据，返回库中最新版本供上层提示。
 */
export function saveStateWithRevision(data: AppData, baseRevision: number, writerId: string): Promise<SaveOutcome> {
  return openDatabase().then(
    (db) =>
      new Promise<SaveOutcome>((resolve, reject) => {
        let outcome: SaveOutcome | null = null;
        let failure: Error | null = null;
        let tx: IDBTransaction;
        try {
          tx = db.transaction([APP_STORE, META_STORE], 'readwrite');
        } catch (err) {
          reject(err instanceof Error ? err : new Error('无法开始写入事务'));
          return;
        }
        const appStore = tx.objectStore(APP_STORE);
        const metaStore = tx.objectStore(META_STORE);

        const fail = (err: unknown) => {
          failure = err instanceof Error ? err : new Error('写入事务失败');
          try {
            tx.abort();
          } catch {
            /* 事务可能已结束 */
          }
        };

        const writeWith = (current: SyncInfo | null) => {
          if (!current) {
            fail(new Error('无法读取当前数据版本'));
            return;
          }
          if (current.revision !== baseRevision) {
            outcome = { ok: false, conflict: current };
            try {
              tx.abort();
            } catch {
              /* 事务可能已结束 */
            }
            return;
          }
          const revision = current.revision + 1;
          const updatedAt = new Date().toISOString();
          try {
            appStore.put(
              {
                schemaVersion: CURRENT_SCHEMA_VERSION,
                updatedAt,
                revision,
                writerId,
                data,
              } satisfies StoredState,
              STATE_KEY
            );
            metaStore.put({ revision, updatedAt, writerId } satisfies SyncInfo, SYNC_META_KEY);
          } catch (err) {
            fail(err);
            return;
          }
          outcome = { ok: true, revision, updatedAt, writerId };
        };

        const readMeta = metaStore.get(SYNC_META_KEY);
        readMeta.onsuccess = () => {
          const raw = readMeta.result;
          if (isSyncInfo(raw)) {
            writeWith(raw);
            return;
          }
          const readState = appStore.get(STATE_KEY);
          readState.onsuccess = () => writeWith(deriveSync(readState.result as StoredState | undefined));
          readState.onerror = () => fail(readState.error);
        };
        readMeta.onerror = () => fail(readMeta.error);

        tx.oncomplete = () => {
          if (outcome) resolve(outcome);
          else reject(failure ?? new Error('写入事务完成但没有结果'));
        };
        tx.onabort = () => {
          if (outcome && !outcome.ok) resolve(outcome);
          else reject(failure ?? new Error('写入已取消'));
        };
      })
  );
}

export async function getMeta<T = unknown>(key: string): Promise<T | undefined> {
  const { os } = await store('readonly', META_STORE);
  return requestResult<T | undefined>(os.get(key));
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  const { tx, os } = await store('readwrite', META_STORE);
  os.put(value, key);
  await txDone(tx);
}

/** 清空数据与元信息（不删除数据库本身）。 */
export async function clearAllStores(): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction([APP_STORE, META_STORE], 'readwrite');
  tx.objectStore(APP_STORE).clear();
  tx.objectStore(META_STORE).clear();
  await txDone(tx);
}

/** 删除整个数据库（仅测试/重置使用）。 */
export function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const cached = dbPromise;
    dbPromise = null;
    const finish = () => resolve();
    const removing = indexedDB.deleteDatabase(DB_NAME);
    removing.onsuccess = finish;
    removing.onerror = () => reject(removing.error ?? new Error('删除数据库失败'));
    removing.onblocked = finish;
    if (cached) cached.then((db) => db.close()).catch(() => undefined);
  });
}
