import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Dispatch, ReactNode } from 'react';
import type { AppData } from '../types';
import { demoData, emptyData } from '../lib/data';
import {
  CURRENT_SCHEMA_VERSION,
  forceSaveAppData,
  initializeStorage,
  loadSnapshot,
  readSyncInfo,
  saveAppData,
  type BootBlocked,
} from '../lib/storage';
import { createSyncChannel } from '../lib/storage/sync';
import { readDraft, type ConflictDraft } from '../lib/storage/recovery';
import { reducer, type Action } from './reducer';
import { emitNotice } from './notices';
import { PersistenceController } from './persistence';
import { SyncMachine } from './syncMachine';
import { createSyncActions, type SyncInternals } from './syncActions';

interface StorageStatus {
  engine: 'indexeddb';
  schemaVersion: number;
  persistence: boolean;
  revision: number;
  writerId: string;
  ready: boolean;
  /** Phase 5.0-a D0：安全阻断信息（非空时应用处于只读保护态，禁止写入） */
  blocked: BootBlocked | null;
}

export type { SyncStatus, SyncUiState, SyncActions } from './syncTypes';
import type { SyncActions, SyncStatus, SyncUiState } from './syncTypes';

interface AppContextValue {
  data: AppData;
  dispatch: Dispatch<Action>;
  storage: StorageStatus;
  sync: SyncUiState & SyncActions;
  hasUnsavedChanges: () => boolean;
}

const AppContext = createContext<AppContextValue | null>(null);
const DispatchContext = createContext<Dispatch<Action> | null>(null);

function createWriterId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    /* ignore */
  }
  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * AppProvider：统一入口与状态协调（不含持久化/同步实现细节）：
 * - PersistenceController：防抖保存、CAS 冲突、补写、失败降级（store/persistence.ts）
 * - SyncMachine：通道订阅、revision 决策、生命周期监听（store/syncMachine.ts）
 * - createSyncActions：冲突处理与五个用户动作（store/syncActions.ts）
 * - 通知经 notices 总线交给 UI 层；启动屏由 App 层按 storage.ready 渲染
 *
 * Phase 5.0-a D0（数据安全）：
 * - 初始状态是**空数据**（不再用 demoData 作为初始 state），避免任何失败路径把示例数据当作用户数据渲染
 * - 初始化返回 blocked 时进入阻断态：不写种子数据、不启动通道监听、不允许自动保存
 */
export function AppProvider({ children }: { children: ReactNode }) {
  const [data, dispatch] = useReducer(reducer, undefined, () => emptyData());
  const [ready, setReady] = useState(false);
  const [persistence, setPersistence] = useState(true);
  const [revision, setRevision] = useState(0);
  const [blocked, setBlocked] = useState<BootBlocked | null>(null);
  const [sync, setSync] = useState<SyncUiState>({
    status: 'idle',
    info: null,
    draft: null,
    draftError: null,
    channelMode: 'none',
  });

  const latestData = useRef(data);
  latestData.current = data;
  const readyRef = useRef(false);
  const persistenceRef = useRef(true);
  const statusRef = useRef<SyncStatus>('idle');
  const draftRef = useRef<ConflictDraft | null>(null);
  const ctrlRef = useRef<PersistenceController | null>(null);
  const machineRef = useRef<SyncMachine | null>(null);
  const actionsRef = useRef<SyncInternals | null>(null);
  // StrictMode 双挂载共享同一次初始化：避免第二次 init 撞上第一次的迁移写入而误报冲突
  const bootRef = useRef<Promise<import('../lib/storage').InitResult> | null>(null);

  useEffect(() => {
    readyRef.current = ready;
  }, [ready]);
  useEffect(() => {
    persistenceRef.current = persistence;
  }, [persistence]);
  useEffect(() => {
    statusRef.current = sync.status;
    draftRef.current = sync.draft;
  }, [sync.status, sync.draft]);

  // 控制器 / 状态机 / 动作集合只创建一次（StrictMode 重挂载复用，避免重复监听器与重复初始化）
  if (!ctrlRef.current) {
    const controller = new PersistenceController(
      {
        initialize: initializeStorage,
        save: saveAppData,
        forceSave: forceSaveAppData,
        snapshot: loadSnapshot,
        syncInfo: readSyncInfo,
      },
      {
        onSaved: (outcome) => {
          setRevision(outcome.revision);
          machineRef.current?.broadcastSaved({
            type: 'saved',
            revision: outcome.revision,
            updatedAt: outcome.updatedAt,
            writerId: controller.writerId,
          });
        },
        onConflict: (info) => actionsRef.current?.pauseWithConflict(info, 'conflict'),
        onStorageError: (message) => {
          setPersistence(false);
          emitNotice('error', message);
        },
        onBlocked: (info) => {
          setBlocked(info);
          setPersistence(false);
        },
      },
      180,
      createWriterId()
    );
    ctrlRef.current = controller;
    machineRef.current = new SyncMachine({
      createChannel: (onRemote) => createSyncChannel(onRemote),
      syncInfo: readSyncInfo,
      applySnapshot: (reason) => (actionsRef.current ? actionsRef.current.applySnapshot(reason) : Promise.resolve(false)),
      onExternalUpdate: (info) => {
        if (statusRef.current === 'idle') actionsRef.current?.pauseWithConflict(info, 'external-update');
        else setSync((prev) => ({ ...prev, info }));
      },
      isDirty: () => controller.dirty,
      isPaused: () => controller.paused,
      isReady: () => readyRef.current && persistenceRef.current,
      baseRevision: () => controller.baseRevision,
    });
    actionsRef.current = createSyncActions({
      controller: () => controller,
      machine: () => machineRef.current as SyncMachine,
      latestData: () => latestData.current,
      dispatch,
      setSync,
      setRevision,
    });
  }
  const controller = ctrlRef.current;
  const machine = machineRef.current as SyncMachine;
  const actions = actionsRef.current as SyncInternals;

  // 启动：初始化（含迁移/首落库）→ 安全阻断判定 → 草稿检测 → 通道与生命周期监听 → 启动校验
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!bootRef.current) bootRef.current = controller.init(demoData());
        const result = await bootRef.current;
        if (!alive) return;

        // 安全阻断：只读保护态。不 dispatch 数据、不启动同步、不保存
        if (result.blocked) {
          setBlocked(result.blocked);
          setPersistence(false);
          setReady(true);
          readyRef.current = true;
          return;
        }

        if (result.data) dispatch({ type: 'data/replace', data: result.data });
        // 首次安装的种子数据已落库：标记为「外部替换」，避免 dispatch 回声再写一次（多标签首启一致性）
        if (result.seeded) controller.markExternalReplace(result.revision);
        if (result.migrated) emitNotice('info', '旧数据已迁移到 IndexedDB（原 localStorage 数据已保留副本）');
        setRevision(controller.baseRevision);
        setReady(true);
        readyRef.current = true;
        const draft = readDraft();
        if (draft) setSync((prev) => ({ ...prev, status: 'recovering', draft }));
        machine.start();
        setSync((prev) => ({ ...prev, channelMode: machine.mode }));
        controller.attachFlush();
        void machine.check('startup');
      } catch (err) {
        // 未知异常同样进入安全阻断：绝不写入任何数据
        if (!alive) return;
        setBlocked({
          reason: 'unavailable',
          message: `本地数据库初始化失败：${err instanceof Error ? err.message : '未知错误'}（未写入任何数据）`,
          rawAvailable: false,
        });
        setPersistence(false);
        setReady(true);
        readyRef.current = true;
      }
    })();
    return () => {
      alive = false;
    };
  }, [controller, machine]);

  // 自动保存：防抖 + CAS（控制器内部）；冲突/暂停/安全阻断期间不下发
  useEffect(() => {
    if (!ready || !persistence || blocked) return;
    controller.requestSave(data);
  }, [data, ready, persistence, blocked, controller]);

  // 主题：浅色 / 深色 / 跟随系统
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const theme = data.settings.theme === 'system' ? (mq.matches ? 'dark' : 'light') : data.settings.theme;
      document.documentElement.dataset.theme = theme;
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', theme === 'dark' ? '#000000' : '#FAF7F2');
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [data.settings.theme]);

  // 开发/测试环境的只读调试桥（生产构建不注入）
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as Record<string, unknown>;
    w.__FD_STATE__ = data;
    w.__FD_STORAGE__ = {
      engine: 'indexeddb',
      schemaVersion: CURRENT_SCHEMA_VERSION,
      ready,
      persistence,
      revision,
      syncStatus: sync.status,
      channelMode: sync.channelMode,
      baseRevision: controller.baseRevision,
      dirty: controller.dirty,
      blocked: blocked ? { reason: blocked.reason, rawAvailable: blocked.rawAvailable } : null,
    };
    w.__FD_SYNC_CHECK__ = () => machine.check('manual');
  }, [data, ready, persistence, revision, sync.status, sync.channelMode, blocked, controller, machine]);

  const reloadFromRemote = useCallback(() => actions.reloadFromRemote(), [actions]);
  const overwriteRemote = useCallback(() => actions.overwriteRemote(), [actions]);
  const exportLocal = useCallback(() => actions.exportLocal(), [actions]);
  const restoreDraft = useCallback(() => actions.restoreDraftWith(draftRef.current), [actions]);
  const discardDraft = useCallback(() => actions.discardDraft(), [actions]);
  const hasUnsavedChanges = useCallback(
    () => !blocked && (controller.dirty || statusRef.current !== 'idle'),
    [controller, blocked]
  );

  const syncValue = useMemo(
    () => ({ ...sync, reloadFromRemote, overwriteRemote, exportLocal, restoreDraft, discardDraft }),
    [sync, reloadFromRemote, overwriteRemote, exportLocal, restoreDraft, discardDraft]
  );

  const value = useMemo(
    () => ({
      data,
      dispatch,
      storage: {
        engine: 'indexeddb' as const,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        persistence,
        revision,
        writerId: controller.writerId,
        ready,
        blocked,
      },
      sync: syncValue,
      hasUnsavedChanges,
    }),
    [data, persistence, revision, ready, blocked, controller, syncValue, hasUnsavedChanges]
  );

  return (
    <AppContext.Provider value={value}>
      <DispatchContext.Provider value={dispatch}>{children}</DispatchContext.Provider>
    </AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp 必须在 AppProvider 内使用');
  return ctx;
}

/** 只订阅 dispatch（引用稳定）的 hook：任务行等高频组件用它，避免数据变化导致全部重渲染。 */
export function useAppDispatch(): Dispatch<Action> {
  const ctx = useContext(DispatchContext);
  if (!ctx) throw new Error('useAppDispatch 必须在 AppProvider 内使用');
  return ctx;
}
