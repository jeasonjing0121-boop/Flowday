import { memo } from 'react';
import type { Project, Task } from '../../types';
import { PRIORITY_META } from '../../types';
import { relativeLabel, timeToMinutes } from '../../lib/date';
import { useAppDispatch } from '../../store/AppStore';
import { useUndoDelete } from '../../store/undoStore';
import { Icon } from '../../components/Icons';
import { useConfirm, useToast } from '../../components/UI';

/**
 * 单条任务行：
 * - React.memo：仅当 task / onEdit / showDate / projects 引用变化时重渲染
 * - 不再订阅 AppData 上下文（改用稳定的 dispatch 上下文），避免"一条任务变化 → 全部行重渲染"
 * - 开发态渲染计数器（生产构建会被 import.meta.env.DEV 死代码消除）
 */
export const TaskRow = memo(function TaskRow({
  task,
  onEdit,
  showDate = false,
  projects,
}: {
  task: Task;
  onEdit?: (task: Task) => void;
  showDate?: boolean;
  projects: Project[];
}) {
  if (import.meta.env.DEV) {
    const w = window as unknown as Record<string, number>;
    w.__FD_ROW_RENDERS__ = (w.__FD_ROW_RENDERS__ || 0) + 1;
  }
  const dispatch = useAppDispatch();
  const { confirm } = useConfirm();
  const { toast } = useToast();
  const { deleteTaskWithUndo } = useUndoDelete();
  const meta = PRIORITY_META[task.priority];
  const project = task.projectId ? projects.find((p) => p.id === task.projectId) : undefined;

  return (
    <div
      data-task-id={task.id}
      className={`group flex items-start gap-3 rounded-xl px-1.5 py-2.5 transition-colors hover:bg-sunken/60 ${
        task.completed ? 'fd-row-done' : ''
      }`}
    >
      <button
        type="button"
        aria-label={task.completed ? '标记为未完成' : '标记为已完成'}
        aria-pressed={task.completed}
        data-testid="task-toggle"
        onClick={() => {
          dispatch({ type: 'task/toggle', id: task.id });
          toast(task.completed ? '已恢复为待办' : '任务已完成', task.completed ? 'info' : 'success');
        }}
        className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md"
      >
        <span className={`fd-checkbox ${task.completed ? 'border-transparent bg-accent text-white' : 'hover:border-accent'}`}>
          {task.completed ? <Icon name="check" size={12} strokeWidth={2.6} className="fd-check-pop" /> : null}
        </span>
      </button>

      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => onEdit?.(task)}
          className={`block min-h-[24px] w-full truncate py-0.5 text-left text-sm ${
            task.completed ? 'text-ink-3 line-through' : 'text-ink'
          }`}
        >
          {task.title}
        </button>
        {task.notes ? (
          <p className="mt-0.5 truncate text-[11px] leading-4 text-ink-3">{task.notes}</p>
        ) : null}
        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-ink-3">
          <span className={`inline-flex items-center gap-1 ${meta.className}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
            P{task.priority} {meta.label}
          </span>
          {showDate ? <span>{relativeLabel(task.date)}</span> : null}
          {task.time ? (
            <span className="inline-flex items-center gap-1">
              <Icon name="clock" size={11} />
              {task.time}
            </span>
          ) : null}
          {project ? (
            <span className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: project.color }} />
              {project.name}
              {project.archived ? <span className="text-[10px] text-ink-3">（已归档）</span> : null}
            </span>
          ) : null}
        </div>
      </div>

      <div className="fd-row-actions flex shrink-0 items-center gap-0.5 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
        {onEdit ? (
          <button className="fd-btn-ghost rounded-lg p-1.5" aria-label="编辑任务" onClick={() => onEdit(task)}>
            <Icon name="pencil" size={14} />
          </button>
        ) : null}
        <button
          className="fd-btn-ghost rounded-lg p-1.5 hover:text-danger"
          aria-label="删除任务"
          onClick={async () => {
            const ok = await confirm({
              title: '删除任务？',
              description: `「${task.title}」将被删除，删除后无法恢复。`,
              confirmText: '删除',
              danger: true,
            });
            if (!ok) return;
            // Phase 5.0-a D3：删除立即生效，并在 8 秒内提供撤销（补偿恢复）
            deleteTaskWithUndo(task);
          }}
        >
          <Icon name="trash" size={14} />
        </button>
      </div>
    </div>
  );
});

export function TaskEmpty({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="fd-glass fd-glass-soft flex flex-col items-center justify-center rounded-[20px] px-4 py-8 text-center">
      <span className="fd-gradient-bg mb-2 inline-flex h-8 w-8 items-center justify-center rounded-lg text-white">
        <Icon name="tasks" size={16} />
      </span>
      <p className="text-sm font-medium text-ink">这里还没有任务</p>
      <button className="fd-btn-primary mt-3 px-3 py-1.5 text-xs" onClick={onCreate}>
        <Icon name="plus" size={14} />
        新建一个
      </button>
    </div>
  );
}

export function sortByTime(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time) || a.priority - b.priority);
}
