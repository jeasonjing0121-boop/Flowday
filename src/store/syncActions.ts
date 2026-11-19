import type { Dispatch } from 'react';
import type { AppData } from '../types';
import type { Action } from './reducer';
import { loadSnapshot, readSyncInfo, saveAppData, type SyncInfo } from '../lib/storage';
import { clearDraft, saveDraft, type ConflictDraft } from '../lib/storage/recovery';
import { downloadBackup } from '../lib/storage/backup';
import { emitNotice } from './notices';
import type { PersistenceController } from './persistence';
import type { SyncMachine } from './syncMachine';
import type { SyncUiState } from './syncTypes';

export interface SyncActionDeps {
  controller: () => PersistenceController;
  machine: () => SyncMachine;
  latestData: () => AppData;
  dispatch: Dispatch<Action>;
  setSync: (updater: (prev: SyncUiState) => SyncUiState) => void;
  setRevision: (revision: number) => void;
}

export interface SyncInternals {
  pauseWithConflict: (info: SyncInfo, reason: 'conflict' | 'external-update') => void;
  applySnapshot: (reason: 'remote' | 'manual') => Promise<boolean>;
  reloadFromRemote: () => void;
  overwriteRemote: () => void;
  exportLocal: () => void;
  restoreDraftWith: (draft: ConflictDraft | null) => void;
  discardDraft: () => void;
}

/**
 * 同步相关的 UI 动作与冲突处理（纯 TS 工厂，不依赖 React 组件）：
 * - pauseWithConflict：暂停保存 + 立即写草稿 + 通知（草稿在冲突发生时写入，不依赖关闭事件）
 * - applySnapshot：读取权威快照替换内存数据（跨标签自动同步 / 手动重载共用）
 * - 五个用户动作：重新加载 / 以本页覆盖 / 导出副本 / 恢复草稿 / 丢弃草稿
 * 所有写入仍经由 storage 层 CAS，本模块不实现任何 IndexedDB 写入逻辑。
 */
export function createSyncActions(deps: SyncActionDeps): SyncInternals {
  const idle = (prev: SyncUiState): SyncUiState => ({ ...prev, status: 'idle', info: null, draft: null, draftError: null });

  const pauseWithConflict = (info: SyncInfo, reason: 'conflict' | 'external-update') => {
    const controller = deps.controller();
    deps.setSync((prev) => ({ ...prev, status: reason, info }));
    const draft: ConflictDraft = {
      version: 1,
      savedAt: new Date().toISOString(),
      baseRevision: controller.baseRevision,
      writerId: controller.writerId,
      reason,
      data: deps.latestData(),
    };
    const result = saveDraft(draft);
    deps.setSync((prev) => ({ ...prev, draftError: result.ok ? null : result.reason }));
    emitNotice(
      'error',
      reason === 'conflict'
        ? '检测到其他标签页的修改，已暂停自动保存并保存草稿'
        : '其他标签页已更新数据，请选择如何处理本地修改'
    );
  };

  const applySnapshot = (reason: 'remote' | 'manual'): Promise<boolean> => {
    return loadSnapshot()
      .then((snapshot) => {
        if (!snapshot) return false;
        deps.controller().markExternalReplace(snapshot.revision);
        deps.setRevision(snapshot.revision);
        deps.dispatch({ type: 'data/replace', data: snapshot.data });
        deps.setSync(idle);
        if (reason === 'manual') emitNotice('info', '已同步其他标签页的修改');
        return true;
      })
      .catch(() => false);
  };

  const reloadFromRemote = () => {
    void applySnapshot('manual').then((ok) => {
      if (ok) clearDraft();
      else emitNotice('error', '读取最新数据失败，请稍后重试');
    });
  };

  const overwriteRemote = () => {
    void deps
      .controller()
      .forceOverwrite(deps.latestData())
      .then((outcome) => {
        if (outcome.ok) {
          clearDraft();
          deps.setSync(idle);
          emitNotice('info', '已以本页数据覆盖其他标签页的修改');
        }
      });
  };

  const exportLocal = () => {
    downloadBackup(deps.latestData());
    emitNotice('info', '已导出本页数据副本');
  };

  const restoreDraftWith = (draft: ConflictDraft | null) => {
    if (!draft) return;
    void (async () => {
      const controller = deps.controller();
      try {
        const info = await readSyncInfo();
        const outcome = await saveAppData(draft.data, { baseRevision: info.revision, writerId: controller.writerId });
        if (outcome.ok) {
          controller.markExternalReplace(outcome.revision);
          deps.setRevision(outcome.revision);
          clearDraft();
          deps.setSync(idle);
          deps.dispatch({ type: 'data/replace', data: draft.data });
          deps.machine().broadcastSaved({
            type: 'saved',
            revision: outcome.revision,
            updatedAt: outcome.updatedAt,
            writerId: controller.writerId,
          });
          emitNotice('info', '已恢复未保存的修改');
        } else {
          pauseWithConflict(outcome.conflict, 'conflict');
        }
      } catch {
        emitNotice('error', '恢复草稿失败，请稍后重试');
      }
    })();
  };

  const discardDraft = () => {
    clearDraft();
    deps.setSync(idle);
    emitNotice('info', '已丢弃草稿');
  };

  return { pauseWithConflict, applySnapshot, reloadFromRemote, overwriteRemote, exportLocal, restoreDraftWith, discardDraft };
}
