import type { AppData } from '../types';
import type { BootBlocked, InitResult, SaveOutcome, Snapshot, SyncInfo } from '../lib/storage';

/**
 * 持久化控制器（纯 TS，不依赖 React/UI）：
 * - 启动初始化（含旧数据迁移结果上报、安全阻断判定）
 * - 防抖保存（默认 180ms），保存走 storage 层既有 CAS 单事务机制（本模块不实现任何写入逻辑）
 * - 保存冲突 → 暂停自动保存并上报冲突（草稿由上层/同步状态机流程写入）
 * - 存储失败 → 关闭持久化并上报错误
 * - pagehide 补写（attachFlush/detachFlush）
 * 所有状态可通过字段读取，便于单元测试注入假 storage。
 *
 * Phase 5.0-a D0（数据安全）：
 * - initialize 报告 blocked 时：不写入种子数据、不写入任何数据，持久化永久关闭
 * - 全新安装写入种子失败（例如其他标签页抢先写入）时：优先加载库中快照，绝不覆盖
 * - 任何失败路径都不会把「空数据 + 成功」当成正常状态
 */
export interface PersistenceDeps {
  initialize: () => Promise<InitResult>;
  save: (data: AppData, opts: { baseRevision: number; writerId: string }) => Promise<SaveOutcome>;
  forceSave: (data: AppData, writerId: string) => Promise<SaveOutcome>;
  snapshot: () => Promise<Snapshot | null>;
  syncInfo: () => Promise<SyncInfo>;
}

export interface PersistenceEvents {
  onLoaded?: (result: InitResult) => void;
  onSaved?: (outcome: Extract<SaveOutcome, { ok: true }>) => void;
  onConflict?: (info: SyncInfo) => void;
  onStorageError?: (message: string) => void;
  /** 新增：进入安全阻断状态（调用方必须停止写入并展示阻断界面） */
  onBlocked?: (info: BootBlocked) => void;
}

export class PersistenceController {
  baseRevision = 0;
  dirty = false;
  paused = false;
  persistenceOk = true;
  /** 安全阻断信息：非空时本实例拒绝一切写入（第二道防线） */
  blocked: BootBlocked | null = null;
  writerId: string;

  private timer: number | undefined;
  private latest: AppData | null = null;
  private skipNext = false;
  private flushHandler: (() => void) | null = null;

  constructor(
    private deps: PersistenceDeps,
    private events: PersistenceEvents = {},
    private debounceMs = 180,
    writerId = 'tab-default'
  ) {
    this.writerId = writerId;
  }

  private enterBlocked(info: BootBlocked): void {
    this.blocked = info;
    this.persistenceOk = false;
    this.dirty = false;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.events.onBlocked?.(info);
  }

  /**
   * 启动初始化；seedData 仅用于「真正的首次安装」首次落库（仍走 CAS）。
   * 返回 InitResult 供上层决策；blocked 非空即代表禁止写入。
   */
  async init(seedData: AppData): Promise<InitResult> {
    let result: InitResult;
    try {
      result = await this.deps.initialize();
    } catch (err) {
      // 初始化抛错（例如 IndexedDB 打不开）：绝不写入种子数据
      this.enterBlocked({
        reason: 'unavailable',
        message: `本地数据库初始化失败：${err instanceof Error ? err.message : '未知错误'}（未写入任何数据）`,
        rawAvailable: false,
      });
      const blockedResult: InitResult = {
        data: null,
        source: 'empty',
        migrated: false,
        error: this.blocked?.message,
        schemaVersion: 0,
        revision: 0,
        updatedAt: '',
        blocked: this.blocked,
      };
      this.events.onStorageError?.(this.blocked?.message ?? '本地数据库初始化失败');
      this.events.onLoaded?.(blockedResult);
      return blockedResult;
    }

    // 1) 安全阻断：不写入任何数据（包括种子数据）
    if (result.blocked) {
      this.baseRevision = result.revision;
      this.enterBlocked(result.blocked);
      this.events.onStorageError?.(result.blocked.message);
      this.events.onLoaded?.(result);
      return result;
    }

    this.baseRevision = result.revision;

    // 2) 已加载（含旧数据迁移成功）
    if (result.data) {
      this.skipNext = true;
      this.dirty = false;
      this.events.onLoaded?.(result);
      return result;
    }

    // 3) 旧式错误（无 blocked 字段但带 error）：保守处理为不写入
    if (result.error) {
      this.persistenceOk = false;
      this.events.onStorageError?.(result.error);
      this.events.onLoaded?.(result);
      return result;
    }

    // 4) 真正的首次安装：写入种子数据（仍走 CAS）
    try {
      const outcome = await this.deps.save(seedData, { baseRevision: 0, writerId: this.writerId });
      if (outcome.ok) {
        this.baseRevision = outcome.revision;
        this.dirty = false;
        this.events.onSaved?.(outcome);
        // 首次安装：返回已落库的种子数据，供上层渲染；seeded 标记让上层跳过回声保存
        const seeded: InitResult = {
          ...result,
          data: seedData,
          source: 'indexeddb',
          revision: outcome.revision,
          updatedAt: outcome.updatedAt,
          seeded: true,
        };
        this.events.onLoaded?.(seeded);
        return seeded;
      }
      // 其他标签页已抢先写入：加载库中快照，绝不覆盖
      const snap = await this.deps.snapshot();
      if (snap) {
        this.baseRevision = snap.revision;
        this.skipNext = true;
        this.dirty = false;
        const loaded: InitResult = {
          ...result,
          data: snap.data,
          source: 'indexeddb',
          revision: snap.revision,
          updatedAt: snap.updatedAt,
        };
        this.events.onLoaded?.(loaded);
        return loaded;
      }
      this.enterBlocked({
        reason: 'migration-conflict',
        message: '首次初始化时检测到并发写入，且无法读取快照；为避免覆盖已有数据，已停止写入',
        rawAvailable: false,
      });
      this.events.onLoaded?.(result);
      return { ...result, blocked: this.blocked, error: this.blocked?.message };
    } catch (err) {
      this.enterBlocked({
        reason: 'read-failed',
        message: `写入初始数据失败：${err instanceof Error ? err.message : '未知错误'}（未覆盖任何已有数据）`,
        rawAvailable: false,
      });
      this.events.onStorageError?.(this.blocked?.message ?? '写入初始数据失败');
      this.events.onLoaded?.(result);
      return { ...result, blocked: this.blocked, error: this.blocked?.message };
    }
  }

  /** 数据变化时调用：标记 dirty 并安排防抖保存。 */
  requestSave(data: AppData): void {
    this.latest = data;
    // 吸收"外部替换/启动加载"引发的回声保存（与旧实现调度点消费语义一致）；
    // 用户后续编辑不会被吞掉，flush 也不受 skip 影响。
    if (this.skipNext) {
      this.skipNext = false;
      return;
    }
    if (!this.persistenceOk || this.paused || this.blocked) return;
    this.dirty = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, this.debounceMs) as unknown as number;
  }

  /** 立即尝试保存（pagehide/测试用）。返回是否成功落库或无需保存。 */
  async flush(): Promise<boolean> {
    if (!this.dirty || this.paused || !this.persistenceOk || this.blocked) return true;
    const data = this.latest;
    if (!data) return true;
    try {
      const outcome = await this.deps.save(data, { baseRevision: this.baseRevision, writerId: this.writerId });
      if (outcome.ok) {
        this.baseRevision = outcome.revision;
        this.dirty = false;
        this.events.onSaved?.(outcome);
        return true;
      }
      this.pause();
      this.events.onConflict?.(outcome.conflict);
      return false;
    } catch {
      this.persistenceOk = false;
      this.events.onStorageError?.('保存到本地数据库失败，请检查浏览器存储空间');
      return false;
    }
  }

  pause(): void {
    this.paused = true;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  resume(): void {
    this.paused = false;
  }

  /** 外部替换数据（同步/恢复/导入）后调用：下一次保存周期跳过，避免把刚加载的数据再写一遍。 */
  markExternalReplace(baseRevision: number): void {
    this.baseRevision = baseRevision;
    this.skipNext = true;
    this.dirty = false;
    this.paused = false;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  /** 「以本页覆盖」：仍走 storage 层 forceSave（先读最新 revision 再 CAS），不绕过版本校验。 */
  async forceOverwrite(data: AppData): Promise<SaveOutcome> {
    const outcome = await this.deps.forceSave(data, this.writerId);
    if (outcome.ok) {
      this.baseRevision = outcome.revision;
      this.dirty = false;
      this.paused = false;
      this.events.onSaved?.(outcome);
    } else {
      this.pause();
      this.events.onConflict?.(outcome.conflict);
    }
    return outcome;
  }

  /** 注册 pagehide 补写；返回清理函数。 */
  attachFlush(): () => void {
    if (this.flushHandler || typeof window === 'undefined') return () => undefined;
    this.flushHandler = () => {
      void this.flush();
    };
    window.addEventListener('pagehide', this.flushHandler);
    return () => this.detachFlush();
  }

  detachFlush(): void {
    if (this.flushHandler && typeof window !== 'undefined') {
      window.removeEventListener('pagehide', this.flushHandler);
    }
    this.flushHandler = null;
  }

  dispose(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.detachFlush();
  }
}
