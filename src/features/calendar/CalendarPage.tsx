import { useMemo, useState } from 'react';
import { useApp } from '../../store/AppStore';
import { useTaskEditor } from '../../components/AppShell';
import {
  addDays,
  addMonths,
  formatFull,
  formatMD,
  monthGrid,
  monthLabel,
  startOfWeek,
  todayKey,
  weekDates,
  weekRangeLabel,
  weekdayLabel,
  weekdayLabels,
} from '../../lib/date';
import { sortTasks, tasksOnDate, findConflicts } from '../../lib/selectors';
import { Segmented } from '../../components/UI';
import { Icon } from '../../components/Icons';
import { TaskRow, sortByTime } from '../tasks/TaskRow';
import { DayTimeline, UnscheduledList } from './DayTimeline';

type View = 'month' | 'week' | 'day';

export function CalendarPage() {
  const { data, dispatch } = useApp();
  const { openTaskEditor } = useTaskEditor();
  const today = todayKey();
  const [anchor, setAnchor] = useState(today);
  const [view, setView] = useState<View>('month');
  const weekStart = data.settings.weekStart;

  const d = useMemo(() => {
    const [y, m] = anchor.split('-').map(Number);
    return { year: y, month: m - 1 };
  }, [anchor]);

  const label =
    view === 'month' ? monthLabel(d.year, d.month) : view === 'week' ? weekRangeLabel(anchor, weekStart) : formatFull(anchor);

  const shift = (dir: -1 | 1) => {
    if (view === 'month') {
      const next = addMonths(d.year, d.month, dir);
      setAnchor(`${next.year}-${String(next.month + 1).padStart(2, '0')}-01`);
    } else if (view === 'week') {
      setAnchor(addDays(startOfWeek(anchor, weekStart), dir * 7));
    } else {
      setAnchor(addDays(anchor, dir));
    }
  };

  const days = useMemo(
    () => (view === 'month' ? monthGrid(d.year, d.month, weekStart) : weekDates(anchor, weekStart)),
    [view, d.year, d.month, anchor, weekStart]
  );

  const byDate = useMemo(() => {
    const map = new Map<string, ReturnType<typeof tasksOnDate>>();
    for (const key of days) map.set(key, tasksOnDate(data.tasks, key));
    return map;
  }, [data.tasks, days]);

  const selected = useMemo(() => sortTasks(tasksOnDate(data.tasks, anchor)), [data.tasks, anchor]);
  const dayConflicts = useMemo(() => findConflicts(selected), [selected]);

  const scheduleTask = (taskId: string, time: string, durationMin: number) => {
    if (!time) {
      dispatch({ type: 'task/update', id: taskId, patch: { time: undefined, durationMin: undefined } });
      return;
    }
    dispatch({ type: 'task/update', id: taskId, patch: { date: anchor, time, durationMin } });
  };
  const unscheduleTask = (taskId: string) => {
    dispatch({ type: 'task/update', id: taskId, patch: { time: undefined, durationMin: undefined } });
  };
  const dayOfMonth = (key: string) => Number(key.split('-')[2]);
  const inMonth = (key: string) => {
    const [y, m] = key.split('-').map(Number);
    return y === d.year && m - 1 === d.month;
  };

  return (
    <div className="space-y-4">
      <section className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <button className="fd-btn-ghost rounded-lg border border-line p-1.5" aria-label="上一页" onClick={() => shift(-1)}>
            <Icon name="left" size={16} />
          </button>
          <button className="fd-btn-ghost rounded-lg border border-line p-1.5" aria-label="下一页" onClick={() => shift(1)}>
            <Icon name="right" size={16} />
          </button>
          <span className="ml-1 text-sm font-semibold text-ink">{label}</span>
        </div>
        <div className="flex items-center gap-2">
          <button className="fd-btn-ghost rounded-lg border border-line px-2.5 py-1 text-xs" onClick={() => setAnchor(today)}>
            回到今天
          </button>
          <Segmented
            label="日历视图"
            value={view}
            onChange={setView}
            options={[
              { value: 'month', label: '月' },
              { value: 'week', label: '周' },
              { value: 'day', label: '日' },
            ]}
          />
        </div>
      </section>

      {view === 'month' ? (
        <section className="fd-card p-3 sm:p-4">
          <div className="grid grid-cols-7 pb-1">
            {weekdayLabels(weekStart).map((w) => (
              <div key={w} className="py-1 text-center text-[11px] text-ink-3">
                周{w}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {days.map((key) => {
              const list = byDate.get(key) ?? [];
              const isSel = key === anchor;
              const isToday = key === today;
              const openTasks = list.filter((t) => !t.completed);
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={isSel}
                  aria-current={isToday ? 'date' : undefined}
                  aria-label={`${key}${isToday ? '（今天）' : ''}，${openTasks.length} 项待办`}
                  onClick={() => setAnchor(key)}
                  className={`min-h-[68px] rounded-lg border p-1.5 text-left align-top transition-colors sm:min-h-[80px] ${
                    isSel
                      ? 'border-accent bg-accent-soft'
                      : 'border-line-2 hover:border-line hover:bg-sunken/50'
                  } ${inMonth(key) ? '' : 'opacity-40'}`}
                >
                  <span
                    className={`fd-num inline-grid h-5 w-5 place-items-center rounded-full text-[11px] ${
                      isToday ? 'bg-ink font-medium text-paper' : 'text-ink-2'
                    }`}
                  >
                    {dayOfMonth(key)}
                  </span>
                  <span className="mt-0.5 block space-y-0.5">
                    {openTasks.slice(0, 2).map((t) => (
                      <span key={t.id} className="block truncate text-[10px] leading-4 text-ink-3">
                        {t.time ? `${t.time} ` : ''}
                        {t.title}
                      </span>
                    ))}
                    {openTasks.length > 2 ? <span className="block text-[10px] text-ink-3">+{openTasks.length - 2}</span> : null}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ) : view === 'week' ? (
        <section className="fd-scroll -mx-1 flex gap-2 overflow-x-auto px-1 pb-1 md:mx-0 md:grid md:grid-cols-7 md:overflow-visible md:px-0 md:pb-0">
          {days.map((key) => {
            const list = (byDate.get(key) ?? []).filter((t) => !t.completed);
            const isToday = key === today;
            return (
              <div key={key} className={`fd-card min-w-[168px] p-2.5 md:min-w-0 ${isToday ? 'border-accent' : ''}`}>
                <button type="button" className="mb-1.5 w-full text-left" onClick={() => setAnchor(key)}>
                  <span className="text-[11px] text-ink-3">{weekdayLabel(key)}</span>
                  <span className={`fd-num ml-1 text-xs ${isToday ? 'font-medium text-accent-ink' : 'text-ink-2'}`}>
                    {dayOfMonth(key)}
                  </span>
                </button>
                <div className="space-y-1">
                  {list.length === 0 ? <p className="py-1 text-[10px] text-ink-3">—</p> : null}
                  {list.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => openTaskEditor(t)}
                      className="block w-full truncate rounded-md bg-paper px-1.5 py-1 text-left text-[10px] leading-4 text-ink-2 hover:bg-sunken"
                    >
                      {t.time ? <span className="fd-num mr-1 text-ink-3">{t.time}</span> : null}
                      {t.title}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </section>
      ) : (
        <section className="space-y-3">
          {dayConflicts.length > 0 ? (
            <div className="fd-card flex flex-wrap items-center gap-2 border-p2/40 bg-p2/8 px-3 py-2 text-xs text-ink-2">
              <Icon name="clock" size={14} className="text-p2" />
              <span>
                检测到 <strong className="text-ink">{dayConflicts.length}</strong> 处时间冲突：
                {dayConflicts
                  .slice(0, 2)
                  .map((c) => `「${c.a.title}」与「${c.b.title}」`)
                  .join('；')}
                {dayConflicts.length > 2 ? ' 等' : ''}
                。可拖动时间块调整，也可保留（冲突不阻止保存）。
              </span>
            </div>
          ) : null}
          <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
            <UnscheduledList
              tasks={selected}
              onSchedule={scheduleTask}
              onUnschedule={unscheduleTask}
              onEdit={(t) => openTaskEditor(t)}
            />
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-ink">{formatMD(anchor)} 的时间线</h2>
                <button className="fd-btn-soft px-2.5 py-1 text-xs" onClick={() => openTaskEditor({ date: anchor })}>
                  <Icon name="plus" size={13} />
                  添加
                </button>
              </div>
              <DayTimeline
                date={anchor}
                tasks={selected}
                onSchedule={scheduleTask}
                onEdit={(t) => openTaskEditor(t)}
                onQuickCreate={(time) => openTaskEditor({ date: anchor, time })}
              />
            </div>
          </div>
        </section>
      )}

      {view !== 'day' ? (
        <section className="fd-card">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-ink">
              {formatFull(anchor)}
              <span className="ml-2 text-[11px] font-normal text-ink-3">
                {selected.filter((t) => !t.completed).length} 件待办 · {selected.filter((t) => t.completed).length} 件已完成
              </span>
            </h2>
            <button className="fd-btn-soft px-2.5 py-1 text-xs" onClick={() => openTaskEditor({ date: anchor })}>
              <Icon name="plus" size={13} />
              在这天添加
            </button>
          </div>
          {selected.length === 0 ? (
            <p className="fd-t-micro py-5 text-center">这一天还没有任务。</p>
          ) : (
            <div className="divide-y divide-line-2">
              {sortByTime(selected).map((t) => (
                <TaskRow key={t.id} task={t} onEdit={(task) => openTaskEditor(task)} projects={data.projects} />
              ))}
            </div>
          )}
        </section>
      ) : null}

      <p className="px-1 text-[11px] text-ink-3">
        提示：日视图支持拖拽排程——把「未安排」任务拖到时间线（15 分钟吸附）、拖动时间块改时间、拖回「未安排」取消排程；也可点「排时间」精确设置。冲突只提醒、不阻止保存；周起始日为
        {weekStart === 1 ? '周一' : '周日'}（可在设置中修改）。
      </p>
    </div>
  );
}
