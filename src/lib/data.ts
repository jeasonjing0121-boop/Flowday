import type { AppData, Habit, HabitLog, Project, Settings, Task } from '../types';
import { addDays, nowIso, todayKey } from './date';
import { normalizeProjectColor, normalizeProjectName } from './projects';

export function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function defaultSettings(): Settings {
  return { name: '', theme: 'light', weekStart: 1, aiEnabled: true, demoData: false, onboarded: false };
}

export function emptyData(): AppData {
  return { version: 1, tasks: [], projects: [], habits: [], habitLogs: [], settings: defaultSettings() };
}

/** 示例数据：仅在用户首次打开或手动载入时使用，界面会明确标注「示例数据」。 */
export function demoData(): AppData {
  const today = todayKey();
  const projects: Project[] = [
    { id: 'p_work', name: '工作', color: '#4A5B8C', archived: false, createdAt: nowIso() },
    { id: 'p_study', name: '学习', color: '#2F7477', archived: false, createdAt: nowIso() },
    { id: 'p_life', name: '生活', color: '#B0724A', archived: false, createdAt: nowIso() },
  ];
  const task = (t: Partial<Task> & Pick<Task, 'title' | 'date'>): Task => ({
    id: uid('t'),
    notes: '',
    time: undefined,
    priority: 3,
    projectId: undefined,
    completed: false,
    createdAt: nowIso(),
    source: 'manual',
    ...t,
  });
  const tasks: Task[] = [
    task({ title: '写本周周报', date: today, time: '09:30', priority: 2, projectId: 'p_work' }),
    task({ title: '产品评审会', date: today, time: '11:00', priority: 1, projectId: 'p_work' }),
    task({ title: '整理需求池', date: today, time: '14:00', priority: 3, projectId: 'p_work' }),
    task({ title: '阅读 30 分钟', date: today, time: '20:00', priority: 3, projectId: 'p_study' }),
    task({ title: '回复客户邮件', date: today, priority: 3, projectId: 'p_work', completed: true, completedAt: nowIso() }),
    task({ title: '提交月度总结', date: addDays(today, 1), priority: 2, projectId: 'p_work' }),
    task({ title: '背单词 100 个', date: addDays(today, 1), priority: 3, projectId: 'p_study' }),
    task({ title: '跑步 5 公里', date: addDays(today, 2), priority: 3, projectId: 'p_life' }),
    task({ title: '交报销单', date: addDays(today, -1), priority: 1, projectId: 'p_work', completed: true, completedAt: nowIso() }),
  ];
  const habits: Habit[] = [
    { id: 'h_early', name: '早起', emoji: '🌱', weeklyTarget: 7, createdAt: nowIso(), archived: false },
    { id: 'h_read', name: '阅读', emoji: '📖', weeklyTarget: 7, createdAt: nowIso(), archived: false },
    { id: 'h_run', name: '跑步', emoji: '🏃', weeklyTarget: 3, createdAt: nowIso(), archived: false },
  ];
  const habitLogs: HabitLog[] = [];
  const seedLogs = (habitId: string, offsets: number[]) => {
    for (const off of offsets) habitLogs.push({ habitId, date: addDays(today, off) });
  };
  seedLogs('h_early', [-1, -2, -3, -4]);
  seedLogs('h_read', [-1, -2, -4]);
  seedLogs('h_run', [-2, -4]);
  return { version: 1, tasks, projects, habits, habitLogs, settings: { ...defaultSettings(), demoData: true } };
}

// ---------------------------------------------------------------- 校验与规范化

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const THEMES: Settings['theme'][] = ['light', 'dark', 'system'];
const MAX_TITLE = 200;
const MAX_NOTES = 5000;
const MAX_NAME = 64;
const MIN_DURATION = 5;
const MAX_DURATION = 1440;

function isValidIso(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value));
}

export interface SanitizeStats {
  tasks: number;
  projects: number;
  habits: number;
  habitLogs: number;
  duplicatesRemoved: { tasks: number; projects: number; habits: number; habitLogs: number };
  /** 无法修复、被丢弃的记录数 */
  droppedInvalid: number;
  /** 被规范化/兜底修正的字段数 */
  fixedFields: number;
  /** 因引用不存在而被置空的 projectId 数量 */
  brokenProjectRefs: number;
  /** 归档项目数量（Phase 5.0-a 新增：信息性统计，用于导入预览；可选以兼容既有统计消费方） */
  archivedProjects?: number;
}

export interface SanitizeResult {
  data: AppData | null;
  stats: SanitizeStats;
  warnings: string[];
}

function emptyStats(): SanitizeStats {
  return {
    tasks: 0,
    projects: 0,
    habits: 0,
    habitLogs: 0,
    duplicatesRemoved: { tasks: 0, projects: 0, habits: 0, habitLogs: 0 },
    droppedInvalid: 0,
    fixedFields: 0,
    brokenProjectRefs: 0,
    archivedProjects: 0,
  };
}

/**
 * 数据校验与规范化（供备份导入、旧数据迁移、IndexedDB 读取共用）：
 * - 结构必须包含 tasks/habits 数组，否则返回 null（调用方不得改动原数据）
 * - 重复 id 保留首次出现的有效记录，后续重复丢弃并计数
 * - 字段类型/范围兜底：日期、时间、ISO 时间戳、优先级、时长、备注长度、设置项白名单等
 * - 所有修正累计到 stats 与 warnings，供导入预览展示（不静默）
 */
export function sanitizeImportedDataDetailed(parsed: unknown): SanitizeResult {
  const stats = emptyStats();
  const warnings: string[] = [];
  if (!parsed || typeof parsed !== 'object') {
    return { data: null, stats, warnings: ['数据不是有效对象'] };
  }
  const obj = parsed as Partial<AppData>;
  if (!Array.isArray(obj.tasks) || !Array.isArray(obj.habits)) {
    return { data: null, stats, warnings: ['数据结构不完整（缺少 tasks/habits）'] };
  }
  const today = todayKey();
  const fixed = () => {
    stats.fixedFields += 1;
  };

  // ---- projects（先去重，供任务引用校验） ----
  const projects: Project[] = [];
  const projectIds = new Set<string>();
  if (Array.isArray(obj.projects)) {
    for (const raw of obj.projects) {
      if (!raw || typeof raw !== 'object') {
        stats.droppedInvalid += 1;
        continue;
      }
      const p = raw as Partial<Project>;
      if (typeof p.id !== 'string' || !p.id.trim() || typeof p.name !== 'string' || !p.name.trim()) {
        stats.droppedInvalid += 1;
        continue;
      }
      if (projectIds.has(p.id)) {
        stats.duplicatesRemoved.projects += 1;
        continue;
      }
      projectIds.add(p.id);
      const color = normalizeProjectColor(p.color);
      if (color !== p.color) fixed();
      const name = normalizeProjectName(p.name);
      if (name !== p.name) fixed();
      let archived = false;
      if (p.archived !== undefined) {
        if (typeof p.archived === 'boolean') archived = p.archived;
        else fixed(); // 非布尔：按未归档处理（不阻断导入）
      }
      let createdAt: string | undefined;
      if (p.createdAt !== undefined) {
        if (isValidIso(p.createdAt)) createdAt = p.createdAt;
        else fixed();
      }
      projects.push({ id: p.id, name, color, archived, createdAt });
    }
  }
  stats.projects = projects.length;
  stats.archivedProjects = projects.filter((p) => p.archived === true).length;

  // ---- tasks ----
  const tasks: Task[] = [];
  const taskIds = new Set<string>();
  for (const raw of obj.tasks) {
    if (!raw || typeof raw !== 'object') {
      stats.droppedInvalid += 1;
      continue;
    }
    const t = raw as Partial<Task>;
    if (typeof t.id !== 'string' || !t.id.trim() || typeof t.title !== 'string') {
      stats.droppedInvalid += 1;
      continue;
    }
    if (taskIds.has(t.id)) {
      stats.duplicatesRemoved.tasks += 1;
      continue;
    }
    taskIds.add(t.id);

    let title = t.title.slice(0, MAX_TITLE);
    if (title !== t.title) fixed();
    let notes: string | undefined;
    if (typeof t.notes === 'string') {
      notes = t.notes.slice(0, MAX_NOTES);
      if (notes !== t.notes) fixed();
    } else if (t.notes !== undefined) {
      fixed();
    }
    let date = t.date;
    if (typeof date !== 'string' || !DATE_RE.test(date)) {
      date = today;
      fixed();
    }
    let time: string | undefined;
    if (typeof t.time === 'string' && TIME_RE.test(t.time)) time = t.time;
    else if (t.time !== undefined && t.time !== '') fixed();
    let durationMin: number | undefined;
    if (typeof t.durationMin === 'number' && Number.isFinite(t.durationMin)) {
      durationMin = Math.min(MAX_DURATION, Math.max(MIN_DURATION, Math.round(t.durationMin)));
      if (durationMin !== t.durationMin) fixed();
    } else if (t.durationMin !== undefined) {
      fixed();
    }
    const rawPriority = Number(t.priority);
    const priority = (Number.isFinite(rawPriority) ? Math.min(3, Math.max(1, Math.round(rawPriority))) : 3) as Task['priority'];
    if (priority !== t.priority) fixed();
    let projectId: string | undefined;
    if (typeof t.projectId === 'string' && t.projectId && projectIds.has(t.projectId)) {
      projectId = t.projectId;
    } else if (t.projectId !== undefined && t.projectId !== '') {
      stats.brokenProjectRefs += 1;
      fixed();
    }
    let completedAt: string | undefined;
    if (isValidIso(t.completedAt)) completedAt = t.completedAt;
    else if (t.completedAt !== undefined) fixed();
    let createdAt = isValidIso(t.createdAt) ? t.createdAt : nowIso();
    if (createdAt !== t.createdAt) fixed();
    const source: Task['source'] = t.source === 'ai' ? 'ai' : 'manual';
    if (t.source !== undefined && t.source !== source) fixed();
    tasks.push({
      id: t.id,
      title,
      notes,
      date,
      time,
      durationMin,
      priority,
      projectId,
      completed: Boolean(t.completed),
      completedAt,
      createdAt,
      source,
    });
  }
  stats.tasks = tasks.length;

  // ---- habits ----
  const habits: Habit[] = [];
  const habitIds = new Set<string>();
  for (const raw of obj.habits) {
    if (!raw || typeof raw !== 'object') {
      stats.droppedInvalid += 1;
      continue;
    }
    const h = raw as Partial<Habit>;
    if (typeof h.id !== 'string' || !h.id.trim() || typeof h.name !== 'string' || !h.name.trim()) {
      stats.droppedInvalid += 1;
      continue;
    }
    if (habitIds.has(h.id)) {
      stats.duplicatesRemoved.habits += 1;
      continue;
    }
    habitIds.add(h.id);
    let emoji = typeof h.emoji === 'string' && h.emoji ? h.emoji.slice(0, 8) : '🌱';
    if (emoji !== h.emoji) fixed();
    const rawTarget = Number(h.weeklyTarget);
    const weeklyTarget = Number.isFinite(rawTarget) ? Math.min(7, Math.max(1, Math.round(rawTarget))) : 7;
    if (weeklyTarget !== h.weeklyTarget) fixed();
    let createdAt = isValidIso(h.createdAt) ? h.createdAt : nowIso();
    if (createdAt !== h.createdAt) fixed();
    habits.push({ id: h.id, name: h.name.trim().slice(0, MAX_NAME), emoji, weeklyTarget, createdAt, archived: Boolean(h.archived) });
  }
  stats.habits = habits.length;

  // ---- habitLogs ----
  const habitLogs: HabitLog[] = [];
  const logKeys = new Set<string>();
  if (Array.isArray(obj.habitLogs)) {
    for (const raw of obj.habitLogs) {
      if (!raw || typeof raw !== 'object') {
        stats.droppedInvalid += 1;
        continue;
      }
      const l = raw as Partial<HabitLog>;
      if (typeof l.habitId !== 'string' || !habitIds.has(l.habitId) || typeof l.date !== 'string' || !DATE_RE.test(l.date)) {
        stats.droppedInvalid += 1;
        continue;
      }
      const key = `${l.habitId}|${l.date}`;
      if (logKeys.has(key)) {
        stats.duplicatesRemoved.habitLogs += 1;
        continue;
      }
      logKeys.add(key);
      habitLogs.push({ habitId: l.habitId, date: l.date });
    }
  }
  stats.habitLogs = habitLogs.length;

  // ---- settings（白名单） ----
  const defaults = defaultSettings();
  const rawSettings = (obj.settings ?? {}) as Partial<Settings>;
  const settings: Settings = { ...defaults };
  if (typeof rawSettings.name === 'string') {
    settings.name = rawSettings.name.slice(0, MAX_NAME);
    if (settings.name !== rawSettings.name) fixed();
  } else if (rawSettings.name !== undefined) {
    fixed();
  }
  if (rawSettings.theme !== undefined) {
    if (THEMES.includes(rawSettings.theme as Settings['theme'])) settings.theme = rawSettings.theme as Settings['theme'];
    else fixed();
  }
  if (rawSettings.weekStart !== undefined) {
    const ws = Number(rawSettings.weekStart);
    if (ws === 0 || ws === 1) settings.weekStart = ws;
    else fixed();
  }
  settings.aiEnabled = rawSettings.aiEnabled === undefined ? defaults.aiEnabled : Boolean(rawSettings.aiEnabled);
  settings.demoData = rawSettings.demoData === undefined ? defaults.demoData : Boolean(rawSettings.demoData);
  if (rawSettings.onboarded !== undefined) {
    if (typeof rawSettings.onboarded === 'boolean') settings.onboarded = rawSettings.onboarded;
    else fixed();
  }

  if (stats.duplicatesRemoved.tasks) warnings.push(`重复任务 ID：丢弃 ${stats.duplicatesRemoved.tasks} 条（保留首次出现）`);
  if (stats.duplicatesRemoved.projects) warnings.push(`重复项目 ID：丢弃 ${stats.duplicatesRemoved.projects} 条`);
  if (stats.duplicatesRemoved.habits) warnings.push(`重复习惯 ID：丢弃 ${stats.duplicatesRemoved.habits} 条`);
  if (stats.duplicatesRemoved.habitLogs) warnings.push(`重复打卡记录：丢弃 ${stats.duplicatesRemoved.habitLogs} 条`);
  if (stats.droppedInvalid) warnings.push(`无效记录：丢弃 ${stats.droppedInvalid} 条（缺少必要字段/格式错误）`);
  if (stats.brokenProjectRefs) warnings.push(`项目引用不存在：${stats.brokenProjectRefs} 条任务已置为未分类`);
  if (stats.fixedFields) warnings.push(`字段修正：${stats.fixedFields} 处（日期/时间/优先级/时长/设置等）`);

  return {
    data: { version: 1, tasks, projects, habits, habitLogs, settings },
    stats,
    warnings,
  };
}

/** 兼容旧调用：仅返回数据（规范化结果），无法识别时返回 null。 */
export function sanitizeImportedData(parsed: unknown): AppData | null {
  return sanitizeImportedDataDetailed(parsed).data;
}

/** 解析 JSON 字符串（旧备份格式 / 内嵌 AppData）；失败返回 null。 */
export function parseImportedData(raw: string): AppData | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return sanitizeImportedData(parsed);
}
