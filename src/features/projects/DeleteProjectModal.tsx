import type { Project } from '../../types';
import { useApp } from '../../store/AppStore';
import { Modal, useToast } from '../../components/UI';
import { Icon } from '../../components/Icons';

/**
 * 删除项目确认（D2）。
 *
 * 安全策略（Phase 5.0-a Q2 决策）：
 * - **绝不删除任务**：只把该项目的任务移入「未分类」（清空 projectId）
 * - 明确展示影响范围（任务数量），避免用户误以为任务会一起消失
 */
export function DeleteProjectModal({
  open,
  project,
  taskCount,
  onClose,
}: {
  open: boolean;
  project?: Project;
  taskCount: number;
  onClose: () => void;
}) {
  const { dispatch } = useApp();
  const { toast } = useToast();
  if (!project) return null;

  const confirmDelete = () => {
    dispatch({ type: 'project/delete', id: project.id });
    toast(taskCount > 0 ? `项目已删除，${taskCount} 个任务已移到「未分类」` : '项目已删除', 'info');
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="删除项目？"
      footer={
        <>
          <button type="button" className="fd-btn-ghost" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="fd-btn bg-p1 px-3.5 py-2 text-paper hover:opacity-90"
            onClick={confirmDelete}
            data-fd-project-delete-confirm="1"
          >
            删除项目
          </button>
        </>
      }
    >
      <div data-fd-project-delete={project.id} className="space-y-3 text-xs leading-5 text-ink-2">
        <p>
          「<strong className="text-ink">{project.name}</strong>」将被删除。
        </p>
        <div className="flex items-start gap-2 rounded-xl border border-line bg-sunken px-3 py-2.5">
          <Icon name="flag" size={14} className="mt-0.5 shrink-0 text-warn" />
          <p>
            {taskCount > 0
              ? `该项目下的 ${taskCount} 个任务不会被删除，它们会保留并移动到「未分类」，之后可以重新归入其他项目。`
              : '该项目下没有任务，删除后不会影响任何任务数据。'}
          </p>
        </div>
        <p className="text-[11px] text-ink-3">此操作不可撤销；如需保留项目结构，可改用「归档」。</p>
      </div>
    </Modal>
  );
}
