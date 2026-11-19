import { useEffect, useState } from 'react';
import type { Project } from '../../types';
import { PROJECT_COLORS } from '../../types';
import { uid } from '../../lib/data';
import { normalizeProjectColor, normalizeProjectName } from '../../lib/projects';
import { useApp } from '../../store/AppStore';
import { Modal, useToast } from '../../components/UI';

/**
 * 项目新建/编辑弹窗（D2）。
 * - 名称必填（≤64），颜色从既有 8 色调色板选择
 * - 键盘：Enter 提交、Esc 关闭（Modal 提供）；打开时聚焦名称输入
 * - 无障碍：名称错误使用 aria-invalid + aria-describedby + role="alert"
 */
export function ProjectEditorModal({
  open,
  project,
  onClose,
  onCreated,
}: {
  open: boolean;
  project?: Project;
  onClose: () => void;
  /** 新建成功后回调（用于任务编辑器内「快速建项目」自动回填） */
  onCreated?: (project: Project) => void;
}) {
  const { dispatch } = useApp();
  const { toast } = useToast();
  const isEdit = Boolean(project?.id);
  const [name, setName] = useState('');
  const [color, setColor] = useState(PROJECT_COLORS[0]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setName(project?.name ?? '');
    setColor(normalizeProjectColor(project?.color ?? PROJECT_COLORS[0]));
    setError('');
    // 仅在打开时初始化，避免编辑过程中被外部数据覆盖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = () => {
    const normalized = normalizeProjectName(name);
    if (!normalized) {
      setError('请先写一个项目名称');
      requestAnimationFrame(() => document.getElementById('project-name')?.focus());
      return;
    }
    if (isEdit && project) {
      dispatch({ type: 'project/update', id: project.id, patch: { name: normalized, color } });
      toast('项目已更新');
    } else {
      const created: Project = {
        id: uid('p'),
        name: normalized,
        color,
        archived: false,
        createdAt: new Date().toISOString(),
      };
      dispatch({ type: 'project/add', project: created });
      toast('项目已创建');
      onCreated?.(created);
    }
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? '编辑项目' : '新建项目'}
      footer={
        <>
          <button type="button" className="fd-btn-ghost" onClick={onClose}>
            取消
          </button>
          <button type="button" className="fd-btn-primary" onClick={submit} data-fd-project-save="1">
            {isEdit ? '保存修改' : '创建项目'}
          </button>
        </>
      }
    >
      <div data-fd-project-editor={isEdit ? 'edit' : 'create'}>
        <label className="fd-label" htmlFor="project-name">
          项目名称
        </label>
        <input
          id="project-name"
          className={`fd-input${error ? ' fd-input-error' : ''}`}
          placeholder="例如：工作、家庭、学习计划"
          aria-required="true"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'project-name-error' : undefined}
          maxLength={64}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        />
        {error ? (
          <p id="project-name-error" role="alert" className="fd-field-error">
            {error}
          </p>
        ) : null}
      </div>

      <div>
        <span className="fd-label" id="project-color-label">
          颜色
        </span>
        <div role="radiogroup" aria-labelledby="project-color-label" className="flex flex-wrap gap-2">
          {PROJECT_COLORS.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={normalizeProjectColor(color) === normalizeProjectColor(option)}
              aria-label={`颜色 ${option}`}
              data-project-color={option}
              onClick={() => setColor(option)}
              className={`h-7 w-7 rounded-full border-2 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fd-focus-ring)] ${
                normalizeProjectColor(color) === normalizeProjectColor(option) ? 'scale-110 border-ink' : 'border-transparent hover:scale-105'
              }`}
              style={{ background: option }}
            >
              <span className="sr-only">{option}</span>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
