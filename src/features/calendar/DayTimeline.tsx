import { useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import type { Task } from '../../types';
import { PRIORITY_META } from '../../types';
import { isToday, timeToMinutes } from '../../lib/date';
import { findConflicts } from '../../lib/selectors';
import { Icon } from '../../components/Icons';

const HOUR_PX = 56;
const DRAG_MIME = 'text/fd-task';

const snap15 = (min: number) => Math.max(0, Math.min(24 * 60 - 15, Math.round(min / 15) * 15));
const fmtMin = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const durOf = (t: Task) => t.durationMin ?? 60;

interface TimelineProps {
  date: string;
  tasks: Task[];
  onSchedule: (taskId: string, time: string, durationMin: number) => void;
  onEdit: (task: Task) => void;
  /** 点击空白时间格快速创建（Apple 日历式交互） */
  onQuickCreate?: (time: string) => void;
}

/** 日视图时间线：小时 + 半小时刻度、任务时间块、拖拽排程、冲突标记、当前时间指示。 */
export function DayTimeline({ date, tasks, onSchedule, onEdit, onQuickCreate }: TimelineProps) {
  const [dropHint, setDropHint] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const blocks = useMemo(() => tasks.filter((t) => t.time && !t.completed), [tasks]);
  const conflictIds = useMemo(() => {
    const set = new Set<string>();
    for (const c of findConflicts(tasks)) {
      set.add(c.a.id);
      set.add(c.b.id);
    }
    return set;
  }, [tasks]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const first = blocks.length ? Math.min(...blocks.map((t) => timeToMinutes(t.time!))) : 8 * 60;
    el.scrollTop = Math.max(0, (first / 60) * HOUR_PX - 56);
  }, [date, blocks]);

  const minutesAt = (e: DragEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return snap15(((e.clientY - rect.top) / HOUR_PX) * 60);
  };

  const nowMin = (() => {
    if (!isToday(date)) return null;
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  })();

  return (
    <div
      ref={scrollRef}
      data-fd-timeline="1"
      className="fd-scroll relative overflow-y-auto rounded-[20px] border border-line-2 bg-surface"
      style={{ maxHeight: 560 }}
      onDragOver={(e) => {
        e.preventDefault();
        setDropHint(minutesAt(e));
      }}
      onDragLeave={() => setDropHint(null)}
      onDrop={(e) => {
        e.preventDefault();
        const id = e.dataTransfer.getData(DRAG_MIME);
        setDropHint(null);
        if (!id) return;
        const task = tasks.find((t) => t.id === id) ?? null;
        if (task) onSchedule(id, fmtMin(minutesAt(e)), durOf(task));
      }}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const min = snap15(((e.clientY - rect.top) / HOUR_PX) * 60);
        onQuickCreate?.(fmtMin(min));
      }}
    >
      <div className="relative" style={{ height: 24 * HOUR_PX }}>
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h} className="absolute inset-x-0" style={{ top: h * HOUR_PX, height: HOUR_PX }}>
            <div className="absolute inset-x-0 top-0 border-t border-line-2" />
            <div className="absolute inset-x-0 top-1/2 border-t border-line-2/50" />
            <span className="fd-num absolute left-1.5 top-0.5 text-[10px] leading-4 text-ink-3">
              {String(h).padStart(2, '0')}:00
            </span>
          </div>
        ))}

        {blocks.length === 0 ? (
          <p className="pointer-events-none absolute inset-x-0 top-1/3 text-center text-xs text-ink-3">
            点击任意时间快速创建任务，或从左侧把任务拖进来
          </p>
        ) : null}

        {dropHint !== null ? (
          <div
            className="pointer-events-none absolute inset-x-2 z-20 rounded-[14px] border-2 border-dashed border-accent/60 bg-accent/8"
            style={{ top: (dropHint / 60) * HOUR_PX, height: HOUR_PX }}
          >
            <span className="fd-num absolute -top-2.5 left-2 rounded-full bg-accent px-1.5 text-[10px] text-white">
              {fmtMin(dropHint)}
            </span>
          </div>
        ) : null}

        {nowMin !== null ? (
          <div className="pointer-events-none absolute inset-x-0 z-10" style={{ top: (nowMin / 60) * HOUR_PX }}>
            <div className="h-[2px] rounded-full bg-p1" />
            <span className="fd-num absolute -top-2.5 left-0 rounded-full bg-p1 px-1.5 py-px text-[9px] font-medium text-white">
              {fmtMin(nowMin)}
            </span>
          </div>
        ) : null}

        {blocks.map((t) => {
          const start = timeToMinutes(t.time!);
          const height = Math.max(30, (durOf(t) / 60) * HOUR_PX - 3);
          const conflict = conflictIds.has(t.id);
          const accent = `var(--fd-p${t.priority})`;
          return (
            <button
              key={t.id}
              type="button"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(DRAG_MIME, t.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onClick={() => onEdit(t)}
              title={`${t.time}–${fmtMin(start + durOf(t))} · 拖动改时间 · 点击编辑`}
              className={`group absolute inset-x-2 z-10 cursor-grab overflow-hidden rounded-[14px] border py-1 pl-2.5 pr-2 text-left shadow-sm transition-shadow hover:shadow-md active:cursor-grabbing ${
                conflict ? 'border-p2/60 bg-p2/10' : 'border-line bg-surface'
              }`}
              style={{ top: (start / 60) * HOUR_PX + 1, height, borderLeftWidth: 3, borderLeftColor: accent }}
            >
              <span className="fd-num block text-[10px] leading-4 text-ink-3">
                {t.time}–{fmtMin(start + durOf(t))}
                {conflict ? <span className="ml-1 font-medium text-p2">冲突</span> : null}
              </span>
              <span className="block truncate text-xs font-medium text-ink">{t.title}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** 未安排时间的任务（当天）：可拖到时间线，或用「排时间」快速排程；接收拖回以取消排程。 */
export function UnscheduledList({
  tasks,
  onSchedule,
  onUnschedule,
  onEdit,
}: {
  tasks: Task[];
  onSchedule: (taskId: string, time: string, durationMin: number) => void;
  onUnschedule: (taskId: string) => void;
  onEdit: (task: Task) => void;
}) {
  const [schedFor, setSchedFor] = useState<string | null>(null);
  const [time, setTime] = useState('09:00');
  const [dur, setDur] = useState(60);
  const list = tasks.filter((t) => !t.time && !t.completed);

  return (
    <div
      className="fd-card space-y-2"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const id = e.dataTransfer.getData(DRAG_MIME);
        if (id) onUnschedule(id);
      }}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">未安排</h3>
        <span className="fd-num text-[11px] text-ink-3">{list.length}</span>
      </div>
      {list.length === 0 ? (
        <p className="py-3 text-center text-[11px] text-ink-3">当天的任务都已排入时间线</p>
      ) : (
        list.map((t) => (
          <div key={t.id} className="rounded-[14px] border border-line bg-paper p-2">
            <div className="flex items-start gap-1.5">
              <span
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(DRAG_MIME, t.id);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                className="mt-0.5 cursor-grab text-ink-3 active:cursor-grabbing"
                title="拖到右侧时间线排程"
              >
                <Icon name="clock" size={13} />
              </span>
              <button type="button" onClick={() => onEdit(t)} className="min-w-0 flex-1 truncate text-left text-xs text-ink">
                {t.title}
              </button>
              <span className={`mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full ${PRIORITY_META[t.priority].dot}`} />
            </div>
            {schedFor === t.id ? (
              <div className="fd-pop mt-2 space-y-1.5 rounded-[14px] border border-line bg-surface p-2">
                <div className="flex items-center gap-1.5">
                  <input id="sched-time" aria-label="排程开始时间" type="time" className="fd-input px-2 py-1 text-xs" value={time} onChange={(e) => setTime(e.target.value)} />
                  <select id="sched-duration" aria-label="排程时长" className="fd-input px-2 py-1 text-xs" value={dur} onChange={(e) => setDur(Number(e.target.value))}>
                    {[30, 45, 60, 90, 120].map((m) => (
                      <option key={m} value={m}>
                        {m} 分钟
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    className="fd-btn-primary flex-1 px-2 py-1 text-[11px]"
                    onClick={() => {
                      onSchedule(t.id, time, dur);
                      setSchedFor(null);
                    }}
                  >
                    确认排程
                  </button>
                  <button className="fd-btn-ghost px-2 py-1 text-[11px]" onClick={() => setSchedFor(null)}>
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <button className="fd-btn-ghost mt-1 w-full rounded-full px-2 py-1 text-[11px]" onClick={() => setSchedFor(t.id)}>
                排时间
              </button>
            )}
          </div>
        ))
      )}
      <p className="pt-1 text-[10px] leading-4 text-ink-3">拖拽到时间线，或点「排时间」；把时间块拖回这里可取消排程。</p>
    </div>
  );
}
