import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Task } from '../../types';
import { projectStats, projectTasks, resolveProject, uncategorizedTaskCount } from '../../lib/projects';
import { sortTasks } from '../../lib/selectors';
import { useApp } from '../../store/AppStore';
import { useTaskEditor } from '../../components/AppShell';
import { EmptyState, ProgressRing, useToast } from '../../components/UI';
import { Icon } from '../../components/Icons';
import { TaskRows } from '../tasks/TaskRows';
import { ProjectEditorModal } from './ProjectEditorModal';
import { DeleteProjectModal } from './DeleteProjectModal';

/**
 * 项目详情页（D2）：
 * - 概览：完成率环、未完成/已完成、本周进度
 * - 任务：未完成 / 已完成两组，复用 TaskRows（含虚拟滚动），保证大数据量下不退化为全量渲染
 * - 操作：编辑、归档/恢复、删除（删除仅解除任务关联）
 * - 未知项目 id：渲染「项目不存在」空态而不是崩溃或静默跳转
 */
export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, dispatch } = useApp();
  const { openTaskEditor } = useTaskEditor();
  const { toast } = useToast();
  const [editorOpen, setEditorOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const project = useMemo(() => resolveProject(data.projects, id), [data.projects, id]);
  const stats = useMemo(() => (project ? projectStats(data, project.id) : null), [data, project]);
  const groups = useMemo((): { open: Task[]; done: Task[] } => {
    if (!project) return { open: [], done: [] };
    const tasks = projectTasks(data, project.id);
    return { open: sortTasks(tasks.filter((t) => !t.completed)), done: sortTasks(tasks.filter((t) => t.completed)) };
  }, [data, project]);
  const orphanCount = useMemo(() => uncategorizedTaskCount(data), [data]);

  if (!project || !stats) {
    return (
      <div className="space-y-4" data-fd-project-missing="1">
        <Link to="/projects" className="inline-flex items-center gap-1 text-xs text-ink-2 hover:text-ink">
          <Icon name="left" size={13} />
          返回项目列表
        </Link>
        <section className="fd-card">
          <EmptyState
            icon="flag"
            title="项目不存在或已被删除"
            description="它可能已被删除，或链接来自旧数据。项目被删除时任务会保留并移动到「未分类」，不会丢失。"
            action={
              <Link to="/projects" className="fd-btn-primary px-3 py-1.5 text-xs">
                查看全部项目
              </Link>
            }
          />
        </section>
      </div>
    );
  }

  const archived = project.archived === true;
  const toggleArchive = () => {
    dispatch({ type: 'project/archive', id: project.id, archived: !archived });
    toast(archived ? `已恢复「${project.name}」` : `已归档「${project.name}」`, 'info');
  };

  return (
    <div className="space-y-4" data-fd-project-detail={project.id}>
      <div className="flex items-center gap-2 text-xs text-ink-2">
        <Link to="/projects" className="inline-flex items-center gap-1 hover:text-ink">
          <Icon name="left" size={13} />
          项目
        </Link>
        <span className="text-ink-3">/</span>
        <span className="truncate text-ink">{project.name}</span>
      </div>

      {archived ? (
        <section className="fd-card flex flex-wrap items-center justify-between gap-2" data-fd-project-archived-banner="1">
          <p className="text-[11px] leading-5 text-ink-2">
            该项目已归档：仍可查看历史任务，但不能在此新建任务。恢复后可继续使用。
          </p>
          <button type="button" className="fd-btn-soft px-3 py-1 text-xs" onClick={toggleArchive}>
            <Icon name="refresh" size={13} />
            恢复项目
          </button>
        </section>
      ) : null}

      <section className="fd-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: project.color }} aria-hidden="true" />
            <h2 className="truncate text-base font-semibold text-ink">{project.name}</h2>
            {archived ? <span className="fd-chip text-[10px]">已归档</span> : null}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              className="fd-btn-soft px-2.5 py-1 text-xs"
              onClick={() => openTaskEditor({ projectId: project.id, date: new Date().toISOString().slice(0, 10) })}
              disabled={archived}
              title={archived ? '归档项目不能新建任务' : undefined}
              data-fd-project-add-task="1"
            >
              <Icon name="plus" size={13} />
              新建任务
            </button>
            <button type="button" className="fd-btn-ghost rounded-lg p-1.5" aria-label="编辑项目" onClick={() => setEditorOpen(true)}>
              <Icon name="pencil" size={14} />
            </button>
            <button
              type="button"
              className="fd-btn-ghost rounded-lg p-1.5"
              aria-label={archived ? '恢复项目' : '归档项目'}
              onClick={toggleArchive}
            >
              <Icon name="archive" size={14} />
            </button>
            <button
              type="button"
              className="fd-btn-ghost rounded-lg p-1.5 hover:text-danger"
              aria-label="删除项目"
              onClick={() => setDeleteOpen(true)}
            >
              <Icon name="trash" size={14} />
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-5">
          <div className="flex items-center gap-3">
            <ProgressRing percent={stats.percent} size={64} stroke={7} />
            <div>
              <p className="text-[11px] text-ink-3">完成率</p>
              <p className="fd-num text-lg font-semibold text-ink" data-fd-project-percent={stats.percent}>
                {stats.percent}%
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
            <p className="text-ink-3">
              未完成 <span className="fd-num font-medium text-ink" data-fd-project-open={stats.open}>{stats.open}</span>
            </p>
            <p className="text-ink-3">
              已完成 <span className="fd-num font-medium text-ink" data-fd-project-done={stats.done}>{stats.done}</span>
            </p>
            <p className="text-ink-3">
              本周 <span className="fd-num font-medium text-ink" data-fd-project-week={`${stats.weekDone}/${stats.weekTotal}`}>{stats.weekDone}/{stats.weekTotal}</span>
            </p>
            <p className="text-ink-3">
              总计 <span className="fd-num font-medium text-ink">{stats.total}</span>
            </p>
          </div>
        </div>
        {orphanCount > 0 ? (
          <p className="mt-3 text-[11px] text-ink-3">
            另有 {orphanCount} 个未分类任务；可在任务列表中把它们归入本项目。
          </p>
        ) : null}
      </section>

      {stats.total === 0 ? (
        <section className="fd-card">
          <EmptyState
            icon="tasks"
            title="这个项目还没有任务"
            description="把要推进的事拆成任务放进来，完成率与本周进度会自动更新。"
            action={
              <button
                type="button"
                className="fd-btn-primary px-3 py-1.5 text-xs"
                onClick={() => openTaskEditor({ projectId: project.id })}
                disabled={archived}
              >
                <Icon name="plus" size={14} />
                在该项目下新建任务
              </button>
            }
          />
        </section>
      ) : (
        <>
          <section className="fd-card" data-fd-project-open-group="1">
            <div className="mb-1 flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                未完成
                <span className="fd-num rounded-full bg-sunken px-1.5 text-[10px] font-normal text-ink-3">{groups.open.length}</span>
              </h3>
            </div>
            {groups.open.length === 0 ? (
              <p className="fd-t-micro py-3 text-center">该项目没有未完成任务 🎉</p>
            ) : (
              <TaskRows tasks={groups.open} showDate onEdit={(task) => openTaskEditor(task)} projects={data.projects} />
            )}
          </section>

          {groups.done.length > 0 ? (
            <section className="fd-card" data-fd-project-done-group="1">
              <div className="mb-1 flex items-center justify-between">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                  已完成
                  <span className="fd-num rounded-full bg-sunken px-1.5 text-[10px] font-normal text-ink-3">{groups.done.length}</span>
                </h3>
              </div>
              <TaskRows tasks={groups.done} showDate onEdit={(task) => openTaskEditor(task)} projects={data.projects} />
            </section>
          ) : null}
        </>
      )}

      <ProjectEditorModal open={editorOpen} project={project} onClose={() => setEditorOpen(false)} />
      <DeleteProjectModal
        open={deleteOpen}
        project={project}
        taskCount={stats.total}
        onClose={() => setDeleteOpen(false)}
      />
    </div>
  );
}
