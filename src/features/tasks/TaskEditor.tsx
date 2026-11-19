import { useEffect, useState } from 'react';
import type { Priority, Project, Task } from '../../types';
import { PRIORITY_META } from '../../types';
import { uid } from '../../lib/data';
import { todayKey } from '../../lib/date';
import { useApp } from '../../store/AppStore';
import { Modal, Segmented, useToast } from '../../components/UI';
import { Icon } from '../../components/Icons';
import { ProjectEditorModal } from '../projects/ProjectEditorModal';

const emptyDraft = () => ({
  title: '',
  notes: '',
  date: todayKey(),
  time: '',
  durationMin: 60,
  priority: 3 as Priority,
  projectId: '',
});

export function TaskEditorModal({
  open,
  initial,
  onClose,
}: {
  open: boolean;
  initial?: Partial<Task>;
  onClose: () => void;
}) {
  const { data, dispatch } = useApp();
  const { toast } = useToast();
  const [draft, setDraft] = useState(emptyDraft);
  const [error, setError] = useState('');
  const [projectModalOpen, setProjectModalOpen] = useState(false);

  // 分类下拉：活动项目 / 已归档项目分组；当前任务指向未知项目时提供安全的占位项
  const currentProject: Project | undefined = draft.projectId
    ? data.projects.find((p) => p.id === draft.projectId)
    : undefined;
  const orphanSelected = Boolean(draft.projectId) && !currentProject;
  const activeProjectsList = data.projects.filter((p) => p.archived !== true);
  const archivedProjectsList = data.projects.filter((p) => p.archived === true);

  useEffect(() => {
    if (!open) return;
    setError('');
    setDraft({
      title: initial?.title ?? '',
      notes: initial?.notes ?? '',
      date: initial?.date ?? todayKey(),
      time: initial?.time ?? '',
      durationMin: initial?.durationMin ?? 60,
      priority: (initial?.priority ?? 3) as Priority,
      projectId: initial?.projectId ?? '',
    });
    // 只在打开时初始化；initial 引用变化不重置用户正在编辑的内容
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const isEdit = Boolean(initial?.id);

  const submit = () => {
    const title = draft.title.trim();
    if (!title) {
      setError('请先写一个任务标题');
      requestAnimationFrame(() => document.getElementById('task-title')?.focus());
      return;
    }
    const payload = {
      title,
      notes: draft.notes.trim() || undefined,
      date: draft.date || todayKey(),
      time: draft.time || undefined,
      durationMin: draft.time ? draft.durationMin : undefined,
      priority: draft.priority,
      projectId: draft.projectId || undefined,
    };
    if (isEdit && initial?.id) {
      dispatch({ type: 'task/update', id: initial.id, patch: payload });
    } else {
      dispatch({
        type: 'task/add',
        task: {
          id: uid('t'),
          completed: false,
          createdAt: new Date().toISOString(),
          source: 'manual',
          ...payload,
        },
      });
    }
    toast(isEdit ? '已保存修改' : '任务已创建');
    onClose();
  };

  return (
    <>
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? '编辑任务' : '新建任务'}
      footer={
        <>
          <button className="fd-btn-ghost" onClick={onClose}>
            取消
          </button>
          <button className="fd-btn-primary" onClick={submit}>
            {isEdit ? '保存修改' : '添加任务'}
          </button>
        </>
      }
    >
      <div>
        <label className="fd-label" htmlFor="task-title">
          任务标题
        </label>
        <input
          id="task-title"
          className={`fd-input${error ? ' fd-input-error' : ''}`}
          placeholder="例如：写本周周报"
          aria-required="true"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'task-title-error' : undefined}
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        />
        {error ? (
          <p id="task-title-error" role="alert" className="fd-field-error">
            {error}
          </p>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div>
          <label className="fd-label" htmlFor="task-date">
            截止日期
          </label>
          <input
            id="task-date"
            type="date"
            className="fd-input"
            value={draft.date}
            onChange={(e) => setDraft({ ...draft, date: e.target.value })}
          />
        </div>
        <div>
          <label className="fd-label" htmlFor="task-time">
            时间（可选）
          </label>
          <input
            id="task-time"
            type="time"
            className="fd-input"
            value={draft.time}
            onChange={(e) => setDraft({ ...draft, time: e.target.value })}
          />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label className="fd-label" htmlFor="task-duration">
            排程时长
          </label>
          <select
            id="task-duration"
            className="fd-input"
            value={draft.durationMin}
            disabled={!draft.time}
            onChange={(e) => setDraft({ ...draft, durationMin: Number(e.target.value) })}
          >
            {[30, 45, 60, 90, 120].map((m) => (
              <option key={m} value={m}>
                {m} 分钟
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <span className="fd-label">优先级</span>
        <Segmented label="优先级"
          value={draft.priority}
          onChange={(v) => setDraft({ ...draft, priority: v })}
          options={[1, 2, 3].map((p) => ({ value: p as Priority, label: `P${p} ${PRIORITY_META[p as Priority].label}` }))}
        />
      </div>

      <div>
        <label className="fd-label" htmlFor="task-project">
          分类
        </label>
        <select
          id="task-project"
          className="fd-input"
          value={draft.projectId}
          onChange={(e) => setDraft({ ...draft, projectId: e.target.value })}
        >
          <option value="">未分类</option>
          {orphanSelected ? <option value={draft.projectId}>未分类（原项目已删除）</option> : null}
          {activeProjectsList.length > 0 ? (
            <optgroup label="活动项目">
              {activeProjectsList.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          ) : null}
          {archivedProjectsList.length > 0 ? (
            <optgroup label="已归档项目">
              {archivedProjectsList.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}（已归档）
                </option>
              ))}
            </optgroup>
          ) : null}
        </select>
        <button
          type="button"
          className="fd-btn-ghost mt-1.5 rounded-lg px-2 py-1 text-[11px]"
          onClick={() => setProjectModalOpen(true)}
          data-fd-task-quick-project="1"
        >
          <Icon name="plus" size={12} />
          新建项目
        </button>
      </div>

      <div>
        <label className="fd-label" htmlFor="task-notes">
          备注（可选）
        </label>
        <textarea
          id="task-notes"
          className="fd-input min-h-[76px] resize-y"
          placeholder="补充说明、链接或下一步动作"
          value={draft.notes}
          onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
        />
      </div>
    </Modal>
      {/* 任务编辑器内快速新建项目：创建后自动回填到当前草稿，不关闭任务弹窗 */}
      <ProjectEditorModal
        open={projectModalOpen}
        onClose={() => setProjectModalOpen(false)}
        onCreated={(created) => setDraft((prev) => ({ ...prev, projectId: created.id }))}
      />
    </>
  );
}
