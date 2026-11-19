export type Priority = 1 | 2 | 3;

export type TaskSource = 'manual' | 'ai';

export interface Task {
  id: string;
  title: string;
  notes?: string;
  /** 截止日期（本地日期，YYYY-MM-DD） */
  date: string;
  /** 可选的具体时间（HH:mm），用于今日时间线 */
  time?: string;
  /** 排程时长（分钟），默认 60 */
  durationMin?: number;
  priority: Priority;
  projectId?: string;
  completed: boolean;
  completedAt?: string;
  createdAt: string;
  source: TaskSource;
}

export interface Project {
  id: string;
  name: string;
  color: string;
  /** 归档标记（Phase 5.0-a 新增，可选：缺省视为未归档） */
  archived?: boolean;
  /** 创建时间（Phase 5.0-a 新增，可选：用于稳定排序，缺省回落到名称排序） */
  createdAt?: string;
}

export interface Habit {
  id: string;
  name: string;
  emoji: string;
  /** 每周目标次数，1-7 */
  weeklyTarget: number;
  createdAt: string;
  archived: boolean;
}

export interface HabitLog {
  habitId: string;
  /** YYYY-MM-DD */
  date: string;
}

export type ThemeMode = 'light' | 'dark' | 'system';

export interface Settings {
  name: string;
  theme: ThemeMode;
  /** 0 = 周日，1 = 周一 */
  weekStart: 0 | 1;
  aiEnabled: boolean;
  /** 当前是否为示例数据，界面会明确提示 */
  demoData: boolean;
  /** 是否已完成/跳过首次上手引导（Phase 5.0-a 新增，可选：缺省视为未完成） */
  onboarded?: boolean;
}

export interface AppData {
  version: 1;
  tasks: Task[];
  projects: Project[];
  habits: Habit[];
  habitLogs: HabitLog[];
  settings: Settings;
}

export const PRIORITY_META: Record<Priority, { label: string; className: string; dot: string }> = {
  1: { label: '紧急', className: 'text-p1', dot: 'bg-p1' },
  2: { label: '高', className: 'text-p2', dot: 'bg-p2' },
  3: { label: '普通', className: 'text-p3', dot: 'bg-p3' },
};

export const PROJECT_COLORS = ['#4A5B8C', '#2F7477', '#B0724A', '#5F7F3F', '#8C6A2F', '#A8597A', '#7A5E8C', '#6E6A64'];

export const HABIT_EMOJIS = ['🌱', '📖', '🏃', '💧', '🧘', '✍️', '🌙', '🥗', '🎧', '💪'];

export const HABIT_COLORS = ['#2F7477', '#5F7F3F', '#B0724A', '#4A5B8C', '#A8597A', '#7A5E8C'];
