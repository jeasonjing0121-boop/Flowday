/** 纯日期工具：全部以本地日期字符串 YYYY-MM-DD 为键，避免时区问题。 */

const pad = (n: number) => String(n).padStart(2, '0');

export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function todayKey(): string {
  return dateKey(new Date());
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function addDays(key: string, delta: number): string {
  const d = parseKey(key);
  d.setDate(d.getDate() + delta);
  return dateKey(d);
}

export function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const d = new Date(year, month + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}

export function startOfWeek(key: string, weekStart: 0 | 1): string {
  const d = parseKey(key);
  const diff = (d.getDay() - weekStart + 7) % 7;
  d.setDate(d.getDate() - diff);
  return dateKey(d);
}

export function weekDates(anchor: string, weekStart: 0 | 1): string[] {
  const start = startOfWeek(anchor, weekStart);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六'];

export function weekdayLabel(key: string): string {
  return `周${WEEKDAY_CN[parseKey(key).getDay()]}`;
}

export function weekdayLabels(weekStart: 0 | 1): string[] {
  return Array.from({ length: 7 }, (_, i) => WEEKDAY_CN[(i + weekStart) % 7]);
}

export function monthLabel(year: number, month: number): string {
  return `${year} 年 ${month + 1} 月`;
}

export function formatMD(key: string): string {
  const d = parseKey(key);
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

export function formatFull(key: string): string {
  return `${formatMD(key)} ${weekdayLabel(key)}`;
}

export function relativeLabel(key: string): string {
  const today = todayKey();
  if (key === today) return '今天';
  if (key === addDays(today, 1)) return '明天';
  if (key === addDays(today, -1)) return '昨天';
  return formatMD(key);
}

export function isPast(key: string): boolean {
  return key < todayKey();
}

export function isToday(key: string): boolean {
  return key === todayKey();
}

/** 用于月度日历的 6x7 网格（含上月/下月补位）。 */
export function monthGrid(year: number, month: number, weekStart: 0 | 1): string[] {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() - weekStart + 7) % 7;
  const start = new Date(year, month, 1 - offset);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return dateKey(d);
  });
}

/** 一周的日期范围标签，例如「11 月 10 日 – 11 月 16 日」。 */
export function weekRangeLabel(anchor: string, weekStart: 0 | 1): string {
  const days = weekDates(anchor, weekStart);
  return `${formatMD(days[0])} – ${formatMD(days[6])}`;
}

export function greeting(d: Date = new Date()): string {
  const h = d.getHours();
  if (h < 6) return '夜深了';
  if (h < 12) return '早上好';
  if (h < 18) return '下午好';
  return '晚上好';
}

/** 把 "HH:mm" 转成分钟数，空值排到最后。 */
export function timeToMinutes(time?: string): number {
  if (!time) return 24 * 60 + 999;
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export function isoWeekdayShort(key: string): string {
  return WEEKDAY_CN[parseKey(key).getDay()];
}

/**
 * 距离下一个「本地日历午夜」的毫秒数（含 50ms 余量，最少 1000ms）。
 * 使用本地日期构造 +1 天，而不是固定加 24 小时，避免夏令时/时区调整导致偏差。
 */
export function msUntilNextMidnight(now: Date = new Date()): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 50);
  return Math.max(1000, next.getTime() - now.getTime());
}
