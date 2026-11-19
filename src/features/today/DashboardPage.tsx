import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../../store/AppStore';
import { useTaskEditor } from '../../components/AppShell';
import { emptyData } from '../../lib/data';
import { dashboardAggregate, isHabitChecked } from '../../lib/selectors';
import { greeting, weekdayLabel } from '../../lib/date';
import { useToday } from '../../lib/useToday';
import { DemoBanner, EmptyState, ProgressRing, useConfirm, useToast } from '../../components/UI';
import { Icon } from '../../components/Icons';
import { TaskRow } from '../tasks/TaskRow';

export function DashboardPage() {
  if (import.meta.env.DEV) {
    const counters = window as unknown as Record<string, number>;
    counters.__FD_DASH_RENDERS__ = (counters.__FD_DASH_RENDERS__ || 0) + 1;
  }
  const { data, dispatch } = useApp();
  const { openTaskEditor } = useTaskEditor();
  const { confirm } = useConfirm();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [quickTitle, setQuickTitle] = useState('');
  // 本地日期 + 跨日自动刷新（午夜定时器 + visibilitychange/focus 校准）
  const today = useToday();

  // R3：单遍聚合（一次遍历产出今日统计 / 近 7 日 / 焦点 / 时间线 / 打卡数）
  const agg = useMemo(() => {
    const start = import.meta.env.DEV ? performance.now() : 0;
    const result = dashboardAggregate(data, today);
    if (import.meta.env.DEV) {
      const counters = window as unknown as Record<string, number>;
      counters.__FD_AGG_MS__ = performance.now() - start;
      counters.__FD_AGG_COUNT__ = (counters.__FD_AGG_COUNT__ || 0) + 1;
    }
    return result;
  }, [data, today]);

  const stats = useMemo(
    () => ({ total: agg.total, done: agg.done, open: agg.open, percent: agg.percent }),
    [agg]
  );
  const focus = agg.focus;
  const timeline = agg.timeline;
  const week = agg.week;
  const maxCount = Math.max(1, ...week.map((d) => d.count));
  const habits = data.habits.filter((h) => !h.archived);
  const checkedCount = agg.habitChecked;

  const quickAdd = () => {
    const title = quickTitle.trim();
    if (!title) return;
    dispatch({
      type: 'task/add',
      task: {
        id: `t_${Date.now().toString(36)}`,
        title,
        date: today,
        priority: 3,
        completed: false,
        createdAt: new Date().toISOString(),
        source: 'manual',
      },
    });
    setQuickTitle('');
    toast('已添加到今天');
  };

  const clearDemo = async () => {
    const ok = await confirm({
      title: '清空示例数据？',
      description: '当前所有任务、习惯与打卡记录都会被删除，且无法恢复。',
      confirmText: '清空',
      danger: true,
    });
    if (!ok) return;
    dispatch({ type: 'data/replace', data: { ...emptyData(), settings: { ...data.settings, demoData: false } } });
    toast('已清空示例数据', 'info');
  };

  return (
    <div className="min-w-0 space-y-4">
      {data.settings.demoData ? <DemoBanner onClear={clearDemo} /> : null}

      <section className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="fd-t-display text-ink">
            {greeting()}，{data.settings.name || '朋友'}
          </p>
          <p className="mt-1 text-sm text-ink-2">
            今天共 {stats.total} 件事，已完成 {stats.done} 件
            {stats.open > 0 ? `，还有 ${stats.open} 件待处理` : '，节奏不错'}
          </p>
        </div>
        <p className="fd-chip">
          <Icon name="sun" size={12} />
          {weekdayLabel(today)} · 保持专注
        </p>
      </section>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          {/* 移动端进度（桌面端在右栏显示） */}
          <section className="fd-card flex flex-wrap items-center gap-x-3 gap-y-2 lg:hidden" data-ambient="#8a76c8">
            <span className="shrink-0">
              <ProgressRing percent={stats.percent} size={56} stroke={6} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-ink-3">今日完成</p>
              <p className="fd-t-num text-lg text-ink">
                {stats.done}
                <span className="text-xs font-normal text-ink-3"> / {stats.total}</span>
              </p>
            </div>
            <p className="basis-full text-[11px] leading-5 text-ink-3 sm:basis-auto sm:text-right">
              待处理 {stats.open} 件
              <br />
              连续保持节奏
            </p>
          </section>

          {/* 今日焦点 */}
          <section className="fd-card sticky" style={{ top: 76, zIndex: 1 }} data-ambient="#8a76c8">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                <Icon name="flag" size={15} className="text-accent" />
                今日焦点
              </h2>
              <span className="text-[11px] text-ink-3">按逾期 / 优先级自动推荐</span>
            </div>
            {focus.length === 0 ? (
              <EmptyState
                title="今天还没有任务"
                description="写下今天最想完成的一件事，或让Jing帮你安排。"
                action={
                  <button className="fd-btn-primary px-3 py-1.5 text-xs" onClick={() => openTaskEditor({ date: today })}>
                    <Icon name="plus" size={14} />
                    写下第一件事
                  </button>
                }
              />
            ) : (
              <div className="divide-y divide-line-2 lg-inset rounded-xl">
                {focus.map((task) => (
                  <TaskRow key={task.id} task={task} showDate onEdit={(t) => openTaskEditor(t)} projects={data.projects} />
                ))}
              </div>
            )}

            <div className="mt-3 flex items-center gap-2 rounded-xl border border-line bg-paper px-2.5 py-1.5">
              <Icon name="plus" size={15} className="shrink-0 text-ink-3" />
              <input
                aria-label="快速添加今日任务"
                className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-3"
                placeholder="快速记一条，回车添加到今天"
                value={quickTitle}
                onChange={(e) => setQuickTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') quickAdd();
                }}
              />
              {quickTitle.trim() ? (
                <button className="fd-btn-primary px-2 py-1 text-[11px]" onClick={quickAdd}>
                  添加
                </button>
              ) : null}
            </div>
          </section>

          {/* 近 7 天 */}
          <section className="fd-card sticky" style={{ top: 92, zIndex: 2 }}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">近 7 天完成数</h2>
              <span className="fd-num text-[11px] text-ink-3">
                共 {week.reduce((sum, d) => sum + d.count, 0)} 件
              </span>
            </div>
            <div
              role="img"
              aria-label={`近 7 天完成数：${week.map((d) => `${weekdayLabel(d.date)} ${d.count} 件`).join('，')}`}
              className="flex h-[92px] items-end gap-2"
            >
              {week.map((d) => (
                <div key={d.date} className="flex flex-1 flex-col items-center gap-1.5">
                  <div className="relative flex h-[62px] w-full items-end">
                    <span className="absolute inset-x-0 bottom-0 h-[3px] rounded-full bg-sunken-2" aria-hidden="true" />
                    <div
                      className="fd-gradient-bg relative w-full rounded-t-md"
                      style={{ height: `${Math.max(d.count === 0 ? 6 : 12, (d.count / maxCount) * 100)}%`, opacity: d.count ? 1 : 0.3 }}
                      title={`${d.date}：完成 ${d.count} 件`}
                    />
                  </div>
                  <span className="text-[10px] text-ink-3">{weekdayLabel(d.date).replace('周', '')}</span>
                </div>
              ))}
            </div>
          </section>

          {/* AI 建议 */}
          {data.settings.aiEnabled ? (
            <section className="fd-ai-card sticky" style={{ top: 108, zIndex: 3 }}>
              <div className="fd-ai-inner flex items-start gap-3">
                <span className="fd-gradient-bg mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-white">
                  <Icon name="sparkles" size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">Jing的建议</p>
                  <p className="mt-1 text-xs leading-5 text-ink-2">
                    {stats.open > 3
                      ? `今天还有 ${stats.open} 件事没做，其中 ${focus.length} 件最关键。把小一点的挪到明天，先推进最重要的一件？`
                      : '今天的任务量比较轻，可以考虑把明天的一件提前完成，或留 30 分钟复盘本周。'}
                  </p>
                  <button
                    className="fd-btn-soft mt-2.5 px-2.5 py-1 text-[11px]"
                    onClick={() => navigate('/assistant?prompt=帮我规划今天')}
                  >
                    让Jing安排
                    <Icon name="arrow-right" size={13} />
                  </button>
                </div>
              </div>
            </section>
          ) : null}
        </div>

        <div className="min-w-0 space-y-4">
          {/* 进度（桌面端；移动端在左上角） */}
          <section
            className="fd-card sticky hidden lg:block"
            data-fd-stats={JSON.stringify(stats)}
            style={{ top: 76, zIndex: 1 }}
          >
            <div className="flex items-center gap-4">
              <div className="relative">
                <ProgressRing percent={stats.percent} />
                <span className="fd-num absolute inset-0 grid place-items-center text-lg font-semibold text-ink">
                  {stats.percent}%
                </span>
              </div>
              <div className="min-w-0 text-sm">
                <p className="font-medium text-ink">今日完成</p>
                <p className="fd-t-num mt-1 text-2xl text-ink">
                  {stats.done}
                  <span className="text-sm font-normal text-ink-3"> / {stats.total}</span>
                </p>
                <p className="mt-1 text-[11px] text-ink-3">已完成任务不计入待办</p>
              </div>
            </div>
          </section>

          {/* 今日时间线 */}
          <section className="fd-card sticky" style={{ top: 92, zIndex: 2 }}>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">今日时间线</h2>
              <Link to="/calendar" className="text-[11px] text-accent-ink hover:underline">
                日历
              </Link>
            </div>
            {timeline.length === 0 ? (
              <p className="fd-t-micro py-4 text-center">今天还没有安排具体时间，去日历里排一排。</p>
            ) : (
              <div className="space-y-2">
                {timeline.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => openTaskEditor(task)}
                    className="flex w-full items-center gap-3 rounded-xl border-l-2 border-accent bg-paper px-2.5 py-2 text-left transition-colors hover:bg-sunken/60"
                  >
                    <span className="fd-num w-10 shrink-0 text-[11px] text-ink-3">{task.time}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-ink">{task.title}</span>
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${task.priority === 1 ? 'bg-p1' : task.priority === 2 ? 'bg-p2' : 'bg-p3'}`} />
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* 习惯速打卡 */}
          <section className="fd-card sticky" style={{ top: 108, zIndex: 3 }}>
            <div className="mb-2.5 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">习惯打卡</h2>
              <span className="fd-num text-[11px] text-ink-3">
                {checkedCount}/{habits.length}
              </span>
            </div>
            {habits.length === 0 ? (
              <Link to="/habits" className="block rounded-xl border border-dashed border-line py-5 text-center text-xs text-ink-3 hover:text-ink">
                还没有习惯，去建立一个
              </Link>
            ) : (
              <div className="space-y-1.5">
                {habits.map((habit) => {
                  const checked = isHabitChecked(data, habit.id, today);
                  return (
                    <button
                      key={habit.id}
                      type="button"
                      onClick={() => dispatch({ type: 'habit/toggle', habitId: habit.id, date: today })}
                      className={`flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition-colors ${
                        checked ? 'border-transparent bg-accent-soft' : 'border-line hover:bg-sunken/60'
                      }`}
                    >
                      <span className="text-base">{habit.emoji}</span>
                      <span className={`flex-1 truncate text-xs ${checked ? 'font-medium text-ink' : 'text-ink-2'}`}>{habit.name}</span>
                      <span className={`grid h-5 w-5 place-items-center rounded-full border text-[11px] ${checked ? 'border-transparent bg-accent text-white' : 'border-line-2 text-transparent'}`}>
                        <Icon name="check" size={11} strokeWidth={3} />
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
