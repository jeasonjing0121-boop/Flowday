import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Project } from '../../types';
import { activeProjects, allProjectStats, archivedProjects, orphanProjectTaskCount } from '../../lib/projects';
import { useApp } from '../../store/AppStore';
import { EmptyState } from '../../components/UI';
import { Icon } from '../../components/Icons';
import { useToast } from '../../components/UI';
import { ProjectCard } from './ProjectCard';
import { ProjectEditorModal } from './ProjectEditorModal';
import { DeleteProjectModal } from './DeleteProjectModal';

/**
 * 项目列表页（D2）：
 * - 活动项目卡片（进度、完成率、本周进度）
 * - 已归档项目折叠区（可恢复）
 * - 空状态引导（没有任何项目时）
 * - 孤儿引用维护入口（任务指向已删除项目时）
 */
export function ProjectsPage() {
  const { data, dispatch } = useApp();
  const { toast } = useToast();
  const [editor, setEditor] = useState<{ open: boolean; project?: Project }>({ open: false });
  const [deleting, setDeleting] = useState<Project | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const active = useMemo(() => activeProjects(data), [data]);
  const archived = useMemo(() => archivedProjects(data), [data]);
  const statsMap = useMemo(() => allProjectStats(data), [data]);
  const taskCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const task of data.tasks) {
      if (!task.projectId) continue;
      map.set(task.projectId, (map.get(task.projectId) ?? 0) + 1);
    }
    return map;
  }, [data]);
  const orphans = useMemo(() => orphanProjectTaskCount(data), [data]);

  const toggleArchive = (project: Project) => {
    const nextArchived = project.archived !== true;
    dispatch({ type: 'project/archive', id: project.id, archived: nextArchived });
    toast(nextArchived ? `已归档「${project.name}」` : `已恢复「${project.name}」`, 'info');
  };

  return (
    <div className="space-y-4" data-fd-projects-page="1">
      <section className="fd-card">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-ink">项目</h2>
            <p className="mt-0.5 text-[11px] text-ink-3">
              用项目把任务分组，查看每个目标的完成率与本周进度。
            </p>
          </div>
          <button
            type="button"
            className="fd-btn-primary px-3 py-1.5 text-xs"
            onClick={() => setEditor({ open: true })}
            data-fd-project-create="1"
          >
            <Icon name="plus" size={14} />
            新建项目
          </button>
        </div>
      </section>

      {orphans > 0 ? (
        <section className="fd-card" data-fd-orphan-card="1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] leading-5 text-ink-2">
              发现 <strong className="text-ink">{orphans}</strong> 个任务指向已不存在的项目（可能来自旧数据或导入）。
            </p>
            <button
              type="button"
              className="fd-btn-soft px-3 py-1 text-xs"
              onClick={() => {
                dispatch({ type: 'data/repairOrphanProjects' });
                toast('已把这些任务归为「未分类」', 'info');
              }}
            >
              归为未分类
            </button>
          </div>
        </section>
      ) : null}

      {active.length === 0 && archived.length === 0 ? (
        <section className="fd-card">
          <EmptyState
            icon="tasks"
            title="还没有项目"
            description="先创建一个项目（例如「工作」「生活」），再把任务归进去，就能看到每个目标的推进情况。"
            action={
              <button className="fd-btn-primary px-3 py-1.5 text-xs" onClick={() => setEditor({ open: true })}>
                <Icon name="plus" size={14} />
                创建第一个项目
              </button>
            }
          />
        </section>
      ) : (
        <section className="space-y-3" aria-label="活动项目列表">
          {active.length === 0 ? (
            <p className="fd-t-micro rounded-xl border border-line px-3 py-3 text-center">所有项目都已归档</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {active.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  stats={statsMap.get(project.id) ?? { total: 0, open: 0, done: 0, percent: 0, weekTotal: 0, weekDone: 0 }}
                  onEdit={(p) => setEditor({ open: true, project: p })}
                  onArchive={toggleArchive}
                  onDelete={(p) => setDeleting(p)}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {archived.length > 0 ? (
        <section className="fd-card" data-fd-archived-section="1">
          <button
            type="button"
            className="flex w-full items-center justify-between text-left"
            aria-expanded={showArchived}
            onClick={() => setShowArchived((v) => !v)}
          >
            <span className="text-sm font-semibold text-ink">已归档项目（{archived.length}）</span>
            <span className="text-ink-3">{showArchived ? '收起' : '展开'}</span>
          </button>
          {showArchived ? (
            <ul className="mt-3 space-y-2">
              {archived.map((project) => (
                <li
                  key={project.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line px-3 py-2"
                  data-archived-project={project.id}
                >
                  <Link to={`/projects/${project.id}`} className="flex min-w-0 items-center gap-2">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: project.color }} aria-hidden="true" />
                    <span className="truncate text-xs text-ink">{project.name}</span>
                    <span className="text-[11px] text-ink-3">{taskCounts.get(project.id) ?? 0} 个任务</span>
                  </Link>
                  <button
                    type="button"
                    className="fd-btn-soft px-2.5 py-1 text-[11px]"
                    onClick={() => toggleArchive(project)}
                  >
                    恢复
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <ProjectEditorModal
        open={editor.open}
        project={editor.project}
        onClose={() => setEditor({ open: false, project: undefined })}
      />
      <DeleteProjectModal
        open={Boolean(deleting)}
        project={deleting ?? undefined}
        taskCount={deleting ? taskCounts.get(deleting.id) ?? 0 : 0}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
