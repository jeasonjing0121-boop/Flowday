import type { SyncInfo } from '../lib/storage';
import type { ConflictDraft } from '../lib/storage/recovery';
import type { SyncMode } from '../lib/storage/sync';

/** 同步 UI 状态与动作的共享类型（独立于 AppStore，避免 store 内部循环引用）。 */
export type SyncStatus = 'idle' | 'conflict' | 'external-update' | 'recovering';

export interface SyncUiState {
  status: SyncStatus;
  info: SyncInfo | null;
  draft: ConflictDraft | null;
  draftError: 'too-large' | 'storage' | null;
  channelMode: SyncMode;
}

export interface SyncActions {
  reloadFromRemote: () => void;
  overwriteRemote: () => void;
  exportLocal: () => void;
  restoreDraft: () => void;
  discardDraft: () => void;
}
