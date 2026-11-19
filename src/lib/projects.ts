import type { AppData, Project, Task } from '../types';
import { addDays, nowIso, startOfWeek, todayKey, weekDates } from './date';

/**
 * 项目（分类）领域纯函数（Phase 5.0-a D1）：
 * - 名称/颜色规范化（reducer 与导入校验共用，避免两套规则）
 * - 激活/归档分组与稳定排序
 * - 项目统计（单遍聚合；列表页使用批量版本避免 O(项目数 × 任务数)）
 * - 未知 projectId 的安全解析与孤儿引用修复
 *
 * 约束：本模块只依赖 types 与 date，不依赖 store/UI，便于单元测试。
 */

export const MAX_PROJECT_NAME = 64;
/** 非法/缺失颜色时的兜底色（与既有导入规范化保持一致） */
export const DEFAULT_PROJECT_COLOR = '#6E6A64';
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** 规范化项目名称：去首尾空白并截断；空字符串返回 ''（由调用方决定是否忽略）。 */
export function normalizeProjectName(name: unknown): string {
  if (typeof name !== 'string') return '';
  return name.trim().slice(0, MAX_PROJECT_NAME);
}

/** 规范化颜色：合法 #RRGGBB 原样返回（统一小写），否则回落到兜底色。 */
export function normalizeProjectColor(color: unknown): string {
  if (typeof color === 'string' && COLOR_RE.test(color)) return color.toLowerCase();
  return DEFAULT_PROJECT_COLOR;
}

/** 是否合法颜色（供表单校验使用，不改变输入）。 */
export function isValidProjectColor(color: unknown): color is string {
  return typeof color === 'string' && COLOR_RE.test(color);
}

function createdAtOf(project: Project): string {
  return typeof project.createdAt === 'string' && project.createdAt ? project.createdAt : '';
}

/**
 * 稳定排序：createdAt 倒序（新项目在前）→ 名称本地化比较 → id 兜底（保证确定性）。
 * 缺少 createdAt 的旧数据排在后面，但仍保持确定性。
 */
export function sortProjects(projects: Project[]): Project[] {
  return [...projects].sort((a, b) => {
    const ca = createdAtOf(a);
    const cb = createdAtOf(b);
    if (ca !== cb) return ca < cb ? 1 : -1;
    const byName = a.name.localeCompare(b.name, 'zh-Hans-CN');
    if (byName !== 0) return byName;
    return a.id.localeCompare(b.id);
  });
}

export function activeProjects(data: AppData): Project[] {
  return sortProjects(data.projects.filter((p) => p.archived !== true));
}

export function archivedProjects(data: AppData): Project[] {
  return sortProjects(data.projects.filter((p) => p.archived === true));
}

/** 解析项目引用；未知 id 或空值返回 undefined（UI 必须降级为「未分类」而不是崩溃）。 */
export function resolveProject(projects: Project[], projectId?: string): Project | undefined {
  if (!projectId) return undefined;
  return projects.find((p) => p.id === projectId);
}

export interface ProjectStats {
  /** 项目内任务总数 */
  total: number;
  /** 未完成数 */
  open: number;
  /** 已完成数 */
  done: number;
  /** 完成率（0-100 整数；无任务为 0） */
  percent: number;
  /** 本周排期的任务数（按 settings.weekStart 计算周范围） */
  weekTotal: number;
  /** 本周排期任务中已完成的数量 */
  weekDone: number;
}

function emptyProjectStats(): ProjectStats {
  return { total: 0, open: 0, done: 0, percent: 0, weekTotal: 0, weekDone: 0 };
}

function withPercent(stats: ProjectStats): ProjectStats {
  stats.percent = stats.total === 0 ? 0 : Math.round((stats.done / stats.total) * 100);
  return stats;
}

/** 单个项目的统计（单遍遍历该项目任务）。 */
export function projectStats(data: AppData, projectId: string): ProjectStats {
  const week = new Set(weekDates(todayKey(), data.settings.weekStart));
  const stats = emptyProjectStats();
  for (const task of data.tasks) {
    if (task.projectId !== projectId) continue;
    stats.total += 1;
    if (task.completed) stats.done += 1;
    if (week.has(task.date)) {
      stats.weekTotal += 1;
      if (task.completed) stats.weekDone += 1;
    }
  }
  stats.open = stats.total - stats.done;
  return withPercent(stats);
}

/**
 * 所有项目的统计（单遍聚合并把未分类任务计入 'uncategorized' 之外跳过）。
 * 列表页使用本函数，避免「每个项目遍历一次全部任务」的 O(P×N)。
 */
export function allProjectStats(data: AppData): Map<string, ProjectStats> {
  const week = new Set(weekDates(todayKey(), data.settings.weekStart));
  const map = new Map<string, ProjectStats>();
  for (const project of data.projects) map.set(project.id, emptyProjectStats());
  for (const task of data.tasks) {
    if (!task.projectId) continue;
    const stats = map.get(task.projectId);
    if (!stats) continue; // 孤儿引用不计入任何项目（由修复入口处理）
    stats.total += 1;
    if (task.completed) stats.done += 1;
    if (week.has(task.date)) {
      stats.weekTotal += 1;
      if (task.completed) stats.weekDone += 1;
    }
  }
  for (const stats of map.values()) {
    stats.open = stats.total - stats.done;
    withPercent(stats);
  }
  return map;
}

/** 项目内任务（未排序；调用方使用既有 sortTasks 排序，保持与任务页一致的顺序）。 */
export function projectTasks(data: AppData, projectId: string): Task[] {
  return data.tasks.filter((t) => t.projectId === projectId);
}

/** 指向不存在项目的任务 id 列表（用于维护入口与降级提示）。 */
export function orphanProjectTaskIds(data: AppData): string[] {
  const ids = new Set(data.projects.map((p) => p.id));
  const out: string[] = [];
  for (const task of data.tasks) {
    if (task.projectId && !ids.has(task.projectId)) out.push(task.id);
  }
  return out;
}

export function orphanProjectTaskCount(data: AppData): number {
  return orphanProjectTaskIds(data).length;
}

/** 未分类任务数（无项目引用） */
export function uncategorizedTaskCount(data: AppData): number {
  return data.tasks.reduce((n, t) => (t.projectId ? n : n + 1), 0);
}

/** 本周区间（供页面标题与统计展示复用）。 */
export function projectWeekRange(data: AppData): { start: string; end: string; days: string[] } {
  const days = weekDates(todayKey(), data.settings.weekStart);
  return { start: days[0], end: days[6], days };
}

/** 便捷：本周起始日（用于与既有日历一致的口径）。 */
export function currentWeekStart(data: AppData): string {
  return startOfWeek(todayKey(), data.settings.weekStart);
}

/** 调试/测试辅助：明天（避免测试直接依赖 Date 构造）。 */
export function tomorrowKey(): string {
  return addDays(todayKey(), 1);
}

/** 创建项目时统一生成的默认值（reducer 使用，保证 id/时间戳一致）。 */
export function makeProject(input: { id: string; name: string; color?: string }): Project {
  return {
    id: input.id,
    name: normalizeProjectName(input.name),
    color: normalizeProjectColor(input.color),
    archived: false,
    createdAt: nowIso(),
  };
}
