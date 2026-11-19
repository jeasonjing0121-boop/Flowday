import { Link } from 'react-router-dom';
import type { Project } from '../../types';
import type { ProjectStats } from '../../lib/projects';
import { Icon } from '../../components/Icons';

/**
 * 项目卡片（列表页）：整卡可点击进入详情，右侧提供编辑/归档/删除。
 * 视觉沿用 fd-card + 项目主题色进度条，保持与任务卡片一致的玻璃层级。
 */
export function ProjectCard({
  project,
  stats,
  onEdit,
  onArchive,
  onDelete,
}: {
  project: Project;
  stats: ProjectStats;
  onEdit: (project: Project) => void;
  onArchive: (project: Project) => void;
  onDelete: (project: Project) => void;
}) {
  return (
    <article className="fd-card group" data-project-id={project.id}>
      <div className="flex items-start justify-between gap-2">
        <Link
          to={`/projects/${project.id}`}
          className="min-w-0 flex-1 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fd-focus-ring)]"
          aria-label={`打开项目 ${project.name}`}
        >
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: project.color }} aria-hidden="true" />
            <h3 className="truncate text-sm font-semibold text-ink">{project.name}</h3>
            {project.archived ? <span className="fd-chip text-[10px]">已归档</span> : null}
          </div>
          <p className="mt-1.5 text-[11px] text-ink-3">
            {stats.open} 未完成 · {stats.done} 已完成
          </p>
          <div className="mt-2 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-sunken" aria-hidden="true">
              <div className="h-full rounded-full transition-[width]" style={{ width: `${stats.percent}%`, background: project.color }} />
            </div>
            <span className="fd-num text-[11px] text-ink-3" data-project-percent={stats.percent}>
              {stats.percent}%
            </span>
          </div>
          <p className="mt-1.5 text-[11px] text-ink-3">
            本周 {stats.weekDone}/{stats.weekTotal}
          </p>
        </Link>

        <div className="flex shrink-0 items-center gap-0.5 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100">
          <button
            type="button"
            className="fd-btn-ghost rounded-lg p-1.5"
            aria-label={`编辑项目 ${project.name}`}
            onClick={() => onEdit(project)}
          >
            <Icon name="pencil" size={13} />
          </button>
          <button
            type="button"
            className="fd-btn-ghost rounded-lg p-1.5"
            aria-label={project.archived ? `恢复项目 ${project.name}` : `归档项目 ${project.name}`}
            onClick={() => onArchive(project)}
          >
            <Icon name="archive" size={13} />
          </button>
          <button
            type="button"
            className="fd-btn-ghost rounded-lg p-1.5 hover:text-danger"
            aria-label={`删除项目 ${project.name}`}
            onClick={() => onDelete(project)}
          >
            <Icon name="trash" size={13} />
          </button>
        </div>
      </div>
    </article>
  );
}
