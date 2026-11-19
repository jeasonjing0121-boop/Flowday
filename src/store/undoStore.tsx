import { createContext, useCallback, useContext, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import type { Task } from '../types';
import { useApp } from './AppStore';
import { useToast } from '../components/UI';

/**
 * 删除撤销（Phase 5.0-a D3）。
 *
 * 设计要点（与既有 CAS / revision 机制兼容）：
 * - 删除**立即生效**并正常落库（不延迟提交），因此刷新/关闭标签页后删除结果确定；
 * - 撤销是**补偿动作**：把删除前的任务快照重新 `task/add`，产生一次新的 CAS 写入；
 * - 多标签并发：撤销写入带着当前 baseRevision 走 CAS；若其他标签页已推进版本，
 *   会走既有冲突横幅流程，**不会静默覆盖**；
 * - 幂等：若同一 id 已存在（例如其他标签页已恢复），跳过写入并提示；
 * - 连续删除：仅最后一次可撤销（新删除会替换待撤销快照）。
 */
export const UNDO_WINDOW_MS = 8000;

interface UndoApi {
  /** 删除任务并展示 8 秒撤销入口 */
  deleteTaskWithUndo: (task: Task) => void;
  /** 当前是否有可撤销的删除（调试/测试用途） */
  hasPendingUndo: () => boolean;
}

const UndoCtx = createContext<UndoApi | null>(null);

export function UndoProvider({ children }: { children: ReactNode }) {
  const { data, dispatch } = useApp();
  const { toast, toastAction } = useToast();
  const dataRef = useRef(data);
  dataRef.current = data;
  const pendingIdRef = useRef<string | null>(null);

  const deleteTaskWithUndo = useCallback(
    (task: Task) => {
      // 快照完整任务（含完成态/项目/备注），撤销时原样恢复
      const snapshot: Task = { ...task };
      pendingIdRef.current = snapshot.id;
      dispatch({ type: 'task/delete', id: snapshot.id });
      toastAction(`已删除「${snapshot.title}」`, {
        actionLabel: '撤销',
        duration: UNDO_WINDOW_MS,
        tone: 'info',
        // 去重键：连续删除时只保留最新一个撤销入口，避免堆叠多个按钮
        key: 'fd-undo-delete',
        onAction: () => {
          if (pendingIdRef.current !== snapshot.id) return;
          pendingIdRef.current = null;
          const exists = dataRef.current.tasks.some((t) => t.id === snapshot.id);
          if (exists) {
            toast('任务已存在，无需恢复', 'info');
            return;
          }
          dispatch({ type: 'task/add', task: snapshot });
          toast('已恢复任务');
        },
      });
    },
    [dispatch, toast, toastAction]
  );

  const hasPendingUndo = useCallback(() => pendingIdRef.current !== null, []);
  const value = useMemo(() => ({ deleteTaskWithUndo, hasPendingUndo }), [deleteTaskWithUndo, hasPendingUndo]);
  return <UndoCtx.Provider value={value}>{children}</UndoCtx.Provider>;
}

export function useUndoDelete(): UndoApi {
  const ctx = useContext(UndoCtx);
  if (!ctx) throw new Error('useUndoDelete 必须在 UndoProvider 内使用');
  return ctx;
}
