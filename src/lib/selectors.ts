import type { AppData, Habit, Task } from '../types';
import { addDays, dateKey, parseKey, startOfWeek, timeToMinutes, todayKey, weekDates } from './date';

/**
 * 时间字符串 → 分钟数的缓存（任务对象在 reducer 中是"改动才换引用"的不可变对象，
 * 因此 WeakMap 缓存不会产生脏数据；排序结果与逐次解析完全一致）。
 */
const timeMinutesCache = new WeakMap<Task, number>();

function cachedTimeMinutes(task: Task): number {
  const cached = timeMinutesCache.get(task);
  if (cached !== undefined) return cached;
  const value = timeToMinutes(task.time);
  timeMinutesCache.set(task, value);
  return value;
}

/**
 * 未完成在前：日期升序 → 时间升序 → 优先级数字升序。
 * 实现上先预计算排序键（日期/时间分钟），再排序，避免比较器内重复解析字符串。
 */
export function sortTasks(tasks: Task[]): Task[] {
  const prepared = tasks.map((task) => ({ task, time: cachedTimeMinutes(task) }));
  prepared.sort((a, b) => {
    const ta = a.task;
    const tb = b.task;
    if (ta.completed !== tb.completed) return ta.completed ? 1 : -1;
    if (ta.completed && tb.completed) return (tb.completedAt ?? '').localeCompare(ta.completedAt ?? '');
    if (ta.date !== tb.date) return ta.date.localeCompare(tb.date);
    if (a.time !== b.time) return a.time - b.time;
    return ta.priority - tb.priority;
  });
  return prepared.map((p) => p.task);
}

export function tasksOnDate(tasks: Task[], date: string): Task[] {
  return sortTasks(tasks.filter((t) => t.date === date));
}

export function todayOpenTasks(data: AppData): Task[] {
  const today = todayKey();
  return sortTasks(data.tasks.filter((t) => !t.completed && t.date === today));
}

/** 今日焦点：优先逾期与高优先级，最多 3 条。 */
export function focusTasks(data: AppData, limit = 3): Task[] {
  const today = todayKey();
  return sortTasks(
    data.tasks.filter((t) => !t.completed && t.date <= today)
  ).slice(0, limit);
}

export function todayStats(data: AppData): { total: number; done: number; open: number; percent: number } {
  const today = todayKey();
  const total = data.tasks.filter((t) => t.date <= today).length;
  const done = data.tasks.filter((t) => t.date <= today && t.completed).length;
  return { total, done, open: total - done, percent: total === 0 ? 0 : Math.round((done / total) * 100) };
}

/** 近 7 天每天完成的任务数（用于迷你柱状图）。 */
export function last7DayCompletion(data: AppData): { date: string; count: number }[] {
  const today = todayKey();
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(today, i - 6);
    return { date, count: data.tasks.filter((t) => t.completed && t.completedAt && dateKey(new Date(t.completedAt)) === date).length };
  });
}

export function habitLogsOf(data: AppData, habitId: string): string[] {
  return data.habitLogs.filter((l) => l.habitId === habitId).map((l) => l.date).sort();
}

export function isHabitChecked(data: AppData, habitId: string, date: string): boolean {
  return data.habitLogs.some((l) => l.habitId === habitId && l.date === date);
}

/** 连续打卡天数：从今天（未打卡则从昨天）向前数。 */
export function habitStreak(data: AppData, habitId: string): number {
  const dates = new Set(habitLogsOf(data, habitId));
  let cursor = todayKey();
  if (!dates.has(cursor)) cursor = addDays(cursor, -1);
  let streak = 0;
  while (dates.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/** 本周（按周起始日）打卡次数。 */
export function habitWeekCount(data: AppData, habit: Habit): number {
  const start = startOfWeek(todayKey(), data.settings.weekStart);
  const week = new Set(weekDates(start, data.settings.weekStart));
  return habitLogsOf(data, habit.id).filter((d) => week.has(d)).length;
}

export function habitWeekPercent(data: AppData, habit: Habit): number {
  const target = Math.max(1, Math.min(7, habit.weeklyTarget));
  return Math.min(100, Math.round((habitWeekCount(data, habit) / target) * 100));
}

export function activeHabits(data: AppData): Habit[] {
  return data.habits.filter((h) => !h.archived);
}

export function projectName(data: AppData, projectId?: string): string | undefined {
  return data.projects.find((p) => p.id === projectId)?.name;
}

export function projectColor(data: AppData, projectId?: string): string | undefined {
  return data.projects.find((p) => p.id === projectId)?.color;
}

export interface ConflictPair {
  a: Task;
  b: Task;
}

/** 同一天的时间块重叠检测（只检查未完成任务；首尾相接不算冲突）。 */
export function findConflicts(tasks: Task[]): ConflictPair[] {
  const blocks = tasks
    .filter((t) => t.time && !t.completed)
    .map((t) => ({
      t,
      s: timeToMinutes(t.time),
      e: timeToMinutes(t.time) + (t.durationMin ?? 60),
    }))
    .sort((x, y) => x.s - y.s);
  const out: ConflictPair[] = [];
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      if (blocks[j].s < blocks[i].e) out.push({ a: blocks[i].t, b: blocks[j].t });
      else break;
    }
  }
  return out;
}

export type TaskStatusFilter = 'all' | 'open' | 'done';
export type TaskDateFilter = 'all' | 'today' | 'week' | 'overdue' | 'upcoming';

export interface TaskFilters {
  query?: string;
  status?: TaskStatusFilter;
  priority?: 'all' | 1 | 2 | 3;
  date?: TaskDateFilter;
  weekStart?: 0 | 1;
}

/** 任务列表统一筛选：关键词（标题/备注）、状态、优先级、日期范围。 */
export function filterTasks(tasks: Task[], filters: TaskFilters = {}): Task[] {
  const q = (filters.query ?? '').trim().toLowerCase();
  const status = filters.status ?? 'all';
  const priority = filters.priority ?? 'all';
  const date = filters.date ?? 'all';
  const weekStart = filters.weekStart ?? 1;
  const today = todayKey();
  const weekFrom = startOfWeek(today, weekStart);
  const weekTo = addDays(weekFrom, 6);
  return sortTasks(
    tasks.filter((t) => {
      if (q) {
        const hay = `${t.title} ${t.notes ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (status === 'open' && t.completed) return false;
      if (status === 'done' && !t.completed) return false;
      if (priority !== 'all' && t.priority !== priority) return false;
      if (date === 'today' && t.date !== today) return false;
      if (date === 'week' && (t.date < weekFrom || t.date > weekTo)) return false;
      if (date === 'overdue' && (t.completed || t.date >= today)) return false;
      if (date === 'upcoming' && t.date <= today) return false;
      return true;
    })
  );
}

function sortByTimeLocal(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time) || a.priority - b.priority);
}

export interface DashboardAggregate {
  today: string;
  total: number;
  done: number;
  open: number;
  percent: number;
  week: { date: string; count: number }[];
  weekTotal: number;
  focus: Task[];
  timeline: Task[];
  habitTotal: number;
  habitChecked: number;
  /** 本次聚合对 tasks 的遍历次数（恒为 1，用于测试与报告校验） */
  scans: number;
}

/**
 * Dashboard 单遍聚合：一次遍历 tasks，同时产出
 * 今日统计（date <= today）、近 7 日完成数（completedAt 落在 [today-6, today]）、
 * 焦点候选（!completed && date <= today）、时间线候选（!completed && date === today && 有 time）。
 * 业务口径与旧 selectors 完全一致；旧实现保留作为测试参照。
 */
export function dashboardAggregate(data: AppData, today: string, focusLimit = 3): DashboardAggregate {
  const weekKeys = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  const weekFrom = weekKeys[0];
  const weekTo = weekKeys[6];
  const counts = new Map<string, number>();
  const focusCandidates: Task[] = [];
  const timelineCandidates: Task[] = [];
  let total = 0;
  let done = 0;

  for (const task of data.tasks) {
    if (task.date <= today) {
      total += 1;
      if (task.completed) done += 1;
    }
    if (!task.completed && task.date <= today) focusCandidates.push(task);
    if (!task.completed && task.date === today && task.time) timelineCandidates.push(task);
    if (task.completed && task.completedAt) {
      const key = dateKey(new Date(task.completedAt));
      if (key >= weekFrom && key <= weekTo) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  const week = weekKeys.map((date) => ({ date, count: counts.get(date) ?? 0 }));
  const focus = sortTasks(focusCandidates).slice(0, focusLimit);
  // 与 Dashboard 原实现一致：先按任务顺序排序，再按时间/优先级稳定排序
  const timeline = sortByTimeLocal(sortTasks(timelineCandidates));

  const active = activeHabits(data);
  const checkedToday = new Set<string>();
  for (const log of data.habitLogs) {
    if (log.date === today) checkedToday.add(log.habitId);
  }
  let habitChecked = 0;
  for (const habit of active) {
    if (checkedToday.has(habit.id)) habitChecked += 1;
  }

  return {
    today,
    total,
    done,
    open: total - done,
    percent: total === 0 ? 0 : Math.round((done / total) * 100),
    week,
    weekTotal: week.reduce((sum, day) => sum + day.count, 0),
    focus,
    timeline,
    habitTotal: active.length,
    habitChecked,
    scans: 1,
  };
}

export { parseKey };
