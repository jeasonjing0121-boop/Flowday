/** 跨标签页通知通道：BroadcastChannel 优先，localStorage + storage 事件降级。
 *  注意：通知只用于"提示去校验"，revision 以 IndexedDB 为准，消息内容不可作为数据依据。 */

export const SYNC_CHANNEL_NAME = 'flowday-sync';
export const SYNC_STORAGE_KEY = 'flowday.sync.v1';

export interface SyncMessage {
  type: 'saved';
  revision: number;
  updatedAt: string;
  writerId: string;
}

export type SyncMode = 'broadcast' | 'storage' | 'none';

export interface SyncChannel {
  mode: SyncMode;
  send(message: SyncMessage): void;
  close(): void;
}

function isFiniteRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1;
}

/** 严格校验远端消息，非法负载直接丢弃（同源页面也可伪造消息，故只当通知使用）。 */
export function validateSyncMessage(value: unknown): SyncMessage | null {
  if (!value || typeof value !== 'object') return null;
  const msg = value as Partial<SyncMessage>;
  if (msg.type !== 'saved') return null;
  if (!isFiniteRevision(msg.revision)) return null;
  if (typeof msg.updatedAt !== 'string') return null;
  if (typeof msg.writerId !== 'string' || !msg.writerId) return null;
  return { type: 'saved', revision: msg.revision, updatedAt: msg.updatedAt, writerId: msg.writerId };
}

export function createSyncChannel(onRemote: (message: SyncMessage) => void): SyncChannel {
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(SYNC_CHANNEL_NAME);
      channel.onmessage = (event: MessageEvent) => {
        const message = validateSyncMessage(event.data);
        if (message) onRemote(message);
      };
      return {
        mode: 'broadcast',
        send: (message) => {
          try {
            channel.postMessage(message);
          } catch {
            /* 通道已关闭等异常：忽略，仅依赖 revision 校验兜底 */
          }
        },
        close: () => {
          try {
            channel.close();
          } catch {
            /* ignore */
          }
        },
      };
    }
  } catch {
    /* 不支持或被禁用：走降级 */
  }

  if (typeof window === 'undefined') {
    return { mode: 'none', send: () => undefined, close: () => undefined };
  }

  const onStorage = (event: StorageEvent) => {
    if (event.key !== SYNC_STORAGE_KEY || !event.newValue) return;
    try {
      const message = validateSyncMessage(JSON.parse(event.newValue));
      if (message) onRemote(message);
    } catch {
      /* 损坏消息忽略 */
    }
  };
  window.addEventListener('storage', onStorage);
  return {
    mode: 'storage',
    send: (message) => {
      try {
        localStorage.setItem(
          SYNC_STORAGE_KEY,
          JSON.stringify({ ...message, nonce: Math.random().toString(36).slice(2) })
        );
      } catch {
        /* localStorage 不可用/配额不足：忽略，依赖可见性校验兜底 */
      }
    },
    close: () => window.removeEventListener('storage', onStorage),
  };
}
