import type { SyncInfo } from '../lib/storage';
import { decideSyncAction } from '../lib/storage/schema';
import type { SyncChannel, SyncMessage, SyncMode } from '../lib/storage/sync';

/**
 * 多标签同步状态机（纯 TS，不依赖 React/UI）：
 * - 持有 BroadcastChannel/降级通道订阅（通道只作通知，权威以 IndexedDB revision 为准）
 * - revision 变化处理：clean → 应用快照；dirty → 上报外部更新（由上层暂停保存并提示）
 * - 生命周期监听（visibilitychange/focus/pageshow）统一注册/清理，重复 start 不产生重复监听器
 * - 不创建第二套权威状态：baseRevision/dirty/paused 全部从 PersistenceController 读取（依赖注入）
 */
export interface SyncMachineDeps {
  createChannel: (onRemote: () => void) => SyncChannel | null;
  syncInfo: () => Promise<SyncInfo>;
  /** clean 且版本变化时调用：读取最新快照并替换内存数据；返回是否成功 */
  applySnapshot: (reason: 'remote' | 'manual') => Promise<boolean>;
  /** dirty 且版本变化时调用：上层负责暂停保存、写草稿、展示冲突 UI */
  onExternalUpdate: (info: SyncInfo) => void;
  isDirty: () => boolean;
  isPaused: () => boolean;
  isReady: () => boolean;
  baseRevision: () => number;
  /** 生命周期监听注入点（默认 window/document；测试可替换） */
  addLifecycleListener?: (type: string, handler: () => void) => () => void;
}

export class SyncMachine {
  mode: SyncMode = 'none';
  private channel: SyncChannel | null = null;
  private detachLifecycle: (() => void) | null = null;
  private checking = false;

  constructor(private deps: SyncMachineDeps) {}

  get started(): boolean {
    return this.channel !== null || this.detachLifecycle !== null;
  }

  /** 幂等启动：重复调用不会注册第二套监听器。 */
  start(): void {
    if (this.started) return;
    this.channel = this.deps.createChannel(() => {
      void this.check('remote');
    });
    this.mode = this.channel?.mode ?? 'none';
    const add =
      this.deps.addLifecycleListener ??
      ((type: string, handler: () => void) => {
        if (typeof window === 'undefined' || typeof document === 'undefined') return () => undefined;
        const target: EventTarget = type === 'visibilitychange' ? document : window;
        target.addEventListener(type, handler);
        return () => target.removeEventListener(type, handler);
      });
    const offs: (() => void)[] = [];
    const onVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') void this.check('visible');
    };
    const onActivate = () => {
      void this.check('focus');
    };
    offs.push(add('visibilitychange', onVisible));
    offs.push(add('focus', onActivate));
    offs.push(add('pageshow', onActivate));
    this.detachLifecycle = () => {
      for (const off of offs) off();
    };
  }

  /** 读取权威 revision 并决策；消息内容不作为数据依据。 */
  async check(reason: string): Promise<'none' | 'sync' | 'prompt' | 'skip'> {
    if (!this.deps.isReady()) return 'skip';
    if (this.checking) return 'skip';
    this.checking = true;
    try {
      const info = await this.deps.syncInfo();
      const decision = decideSyncAction({
        baseRevision: this.deps.baseRevision(),
        currentRevision: info.revision,
        dirty: this.deps.isDirty() || this.deps.isPaused(),
      });
      if (decision === 'none') return 'none';
      if (decision === 'sync') {
        await this.deps.applySnapshot(reason === 'manual' ? 'manual' : 'remote');
        return 'sync';
      }
      this.deps.onExternalUpdate(info);
      return 'prompt';
    } catch {
      return 'skip';
    } finally {
      this.checking = false;
    }
  }

  broadcastSaved(message: SyncMessage): void {
    this.channel?.send(message);
  }

  /** 清理通道与生命周期监听；可再次 start。 */
  dispose(): void {
    this.channel?.close();
    this.channel = null;
    this.mode = 'none';
    this.detachLifecycle?.();
    this.detachLifecycle = null;
  }
}
