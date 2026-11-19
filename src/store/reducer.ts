import type { AppData, Habit, Project, Task } from '../types';
import { nowIso } from '../lib/date';
import { makeProject, normalizeProjectColor, normalizeProjectName } from '../lib/projects';

export type Action =
  | { type: 'task/add'; task: Task }
  | { type: 'task/update'; id: string; patch: Partial<Task> }
  | { type: 'task/toggle'; id: string }
  | { type: 'task/delete'; id: string }
  | { type: 'habit/add'; habit: Habit }
  | { type: 'habit/delete'; id: string }
  | { type: 'habit/toggle'; habitId: string; date: string }
  | { type: 'settings/update'; patch: Partial<AppData['settings']> }
  | { type: 'project/add'; project: Project }
  | { type: 'project/update'; id: string; patch: Partial<Pick<Project, 'name' | 'color'>> }
  | { type: 'project/archive'; id: string; archived: boolean }
  /** 删除项目：仅解除任务关联（任务本身永不删除），单次状态更新 → 单次 CAS 保存 */
  | { type: 'project/delete'; id: string }
  /** 维护：把指向已不存在项目的任务引用清空（未知 id 的安全降级） */
  | { type: 'data/repairOrphanProjects' }
  | { type: 'data/replace'; data: AppData }
  | { type: 'data/clear-demo' };

export function reducer(state: AppData, action: Action): AppData {
  switch (action.type) {
    case 'task/add':
      return { ...state, tasks: [action.task, ...state.tasks] };

    case 'task/update':
      return {
        ...state,
        tasks: state.tasks.map((t) => (t.id === action.id ? { ...t, ...action.patch } : t)),
      };

    case 'task/toggle':
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          t.id === action.id
            ? { ...t, completed: !t.completed, completedAt: t.completed ? undefined : nowIso() }
            : t
        ),
      };

    case 'task/delete':
      return { ...state, tasks: state.tasks.filter((t) => t.id !== action.id) };

    case 'habit/add':
      return { ...state, habits: [...state.habits, action.habit] };

    case 'habit/delete':
      return {
        ...state,
        habits: state.habits.filter((h) => h.id !== action.id),
        habitLogs: state.habitLogs.filter((l) => l.habitId !== action.id),
      };

    case 'habit/toggle': {
      const exists = state.habitLogs.some((l) => l.habitId === action.habitId && l.date === action.date);
      return {
        ...state,
        habitLogs: exists
          ? state.habitLogs.filter((l) => !(l.habitId === action.habitId && l.date === action.date))
          : [...state.habitLogs, { habitId: action.habitId, date: action.date }],
      };
    }

    case 'settings/update':
      return { ...state, settings: { ...state.settings, ...action.patch } };

    case 'project/add': {
      const incoming = action.project;
      if (!incoming || typeof incoming.id !== 'string' || !incoming.id) return state;
      if (state.projects.some((p) => p.id === incoming.id)) return state;
      const name = normalizeProjectName(incoming.name);
      if (!name) return state;
      const project: Project =
        incoming.createdAt !== undefined || incoming.archived !== undefined
          ? { ...incoming, name, color: normalizeProjectColor(incoming.color) }
          : makeProject({ id: incoming.id, name, color: incoming.color });
      return { ...state, projects: [...state.projects, project] };
    }

    case 'project/update': {
      const index = state.projects.findIndex((p) => p.id === action.id);
      if (index < 0) return state;
      const current = state.projects[index];
      const nextName = action.patch.name !== undefined ? normalizeProjectName(action.patch.name) : current.name;
      const nextColor = action.patch.color !== undefined ? normalizeProjectColor(action.patch.color) : current.color;
      // 空名称忽略（不产生无名项目）；无实际变化时返回原引用，避免无意义保存
      const name = nextName || current.name;
      if (name === current.name && nextColor === current.color) return state;
      const projects = state.projects.map((p, i) => (i === index ? { ...p, name, color: nextColor } : p));
      return { ...state, projects };
    }

    case 'project/archive': {
      const current = state.projects.find((p) => p.id === action.id);
      if (!current) return state;
      const nextArchived = action.archived === true;
      if ((current.archived === true) === nextArchived) return state;
      const projects = state.projects.map((p) => (p.id === action.id ? { ...p, archived: nextArchived } : p));
      return { ...state, projects };
    }

    case 'project/delete': {
      const exists = state.projects.some((p) => p.id === action.id);
      if (!exists) return state;
      const projects = state.projects.filter((p) => p.id !== action.id);
      const hasReferences = state.tasks.some((t) => t.projectId === action.id);
      // 删除项目绝不删除任务：仅把这些任务移入「未分类」（清空 projectId）
      const tasks = hasReferences
        ? state.tasks.map((t) => (t.projectId === action.id ? { ...t, projectId: undefined } : t))
        : state.tasks;
      return { ...state, projects, tasks };
    }

    case 'data/repairOrphanProjects': {
      const ids = new Set(state.projects.map((p) => p.id));
      const hasOrphan = state.tasks.some((t) => t.projectId && !ids.has(t.projectId));
      if (!hasOrphan) return state;
      return {
        ...state,
        tasks: state.tasks.map((t) => (t.projectId && !ids.has(t.projectId) ? { ...t, projectId: undefined } : t)),
      };
    }

    case 'data/replace':
      return action.data;

    case 'data/clear-demo':
      return {
        ...state,
        settings: { ...state.settings, demoData: false },
      };

    default:
      return state;
  }
}
