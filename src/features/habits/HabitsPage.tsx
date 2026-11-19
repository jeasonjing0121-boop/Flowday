import { useState } from 'react';
import type { Habit } from '../../types';
import { HABIT_EMOJIS } from '../../types';
import { useApp } from '../../store/AppStore';
import { uid } from '../../lib/data';
import { addDays, isToday, relativeLabel, todayKey, WEEKDAY_CN, parseKey } from '../../lib/date';
import { activeHabits, habitStreak, habitWeekCount, habitWeekPercent, isHabitChecked } from '../../lib/selectors';
import { EmptyState, Modal, useConfirm, useToast } from '../../components/UI';
import { Icon } from '../../components/Icons';

export function HabitsPage() {
  const { data, dispatch } = useApp();
  const { confirm } = useConfirm();
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState({ name: '', emoji: HABIT_EMOJIS[0], target: 7 });
  const today = todayKey();
  const habits = activeHabits(data);
  const checkedToday = habits.filter((h) => isHabitChecked(data, h.id, today)).length;
  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));

  const submit = () => {
    const name = draft.name.trim();
    if (!name) return;
    const habit: Habit = {
      id: uid('h'),
      name,
      emoji: draft.emoji,
      weeklyTarget: draft.target,
      createdAt: new Date().toISOString(),
      archived: false,
    };
    dispatch({ type: 'habit/add', habit });
    toast('已创建习惯');
    setDraft({ name: '', emoji: HABIT_EMOJIS[0], target: 7 });
    setCreateOpen(false);
  };

  return (
    <div className="space-y-4">
      <section className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="fd-t-display text-ink">习惯</p>
          <p className="mt-0.5 text-xs text-ink-3">
            今日已打卡 {checkedToday}/{habits.length} · 坚持比强度更重要
          </p>
        </div>
        <button className="fd-btn-primary px-3 py-1.5 text-xs" onClick={() => setCreateOpen(true)}>
          <Icon name="plus" size={14} />
          新建习惯
        </button>
      </section>

      {habits.length === 0 ? (
        <EmptyState
          icon="habit"
          title="还没有习惯"
          description="从一件小事开始：早起、阅读、运动、喝水都可以。每天打卡，连续天数会记录你的坚持。"
          action={
            <button className="fd-btn-primary px-3 py-1.5 text-xs" onClick={() => setCreateOpen(true)}>
              建立第一个习惯
            </button>
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {habits.map((habit) => {
            const checked = isHabitChecked(data, habit.id, today);
            const streak = habitStreak(data, habit.id);
            const weekPercent = habitWeekPercent(data, habit);
            const weekCount = habitWeekCount(data, habit);
            return (
              <section key={habit.id} className="fd-card">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="grid h-10 w-10 place-items-center rounded-xl bg-sunken text-lg">{habit.emoji}</span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">{habit.name}</p>
                      <p className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-3">
                        <span className="inline-flex items-center gap-0.5 text-p2">
                          <Icon name="flame" size={11} />
                          连续 {streak} 天
                        </span>
                        <span>
                          本周 {weekCount}/{habit.weeklyTarget}
                        </span>
                      </p>
                    </div>
                  </div>
                  <button
                    className="fd-btn-ghost rounded-lg p-1.5 hover:text-danger"
                    aria-label="删除习惯"
                    onClick={async () => {
                      const ok = await confirm({
                        title: '删除习惯？',
                        description: `「${habit.name}」及其打卡记录会被一起删除。`,
                        confirmText: '删除',
                        danger: true,
                      });
                      if (!ok) return;
                      dispatch({ type: 'habit/delete', id: habit.id });
                      toast('已删除习惯', 'info');
                    }}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </div>

                <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-sunken">
                  <div
                    className="fd-gradient-bg h-full rounded-full transition-all"
                    style={{ width: `${weekPercent}%` }}
                  />
                </div>

                <div className="mt-3 flex items-center justify-between">
                  <button
                    type="button"
                    aria-pressed={checked}
                    onClick={() => dispatch({ type: 'habit/toggle', habitId: habit.id, date: today })}
                    className={`fd-btn px-3 py-1.5 text-xs ${
                      checked ? 'bg-accent-soft text-accent-ink' : 'bg-ink text-paper hover:opacity-85'
                    }`}
                  >
                    <Icon name={checked ? 'check' : 'plus'} size={14} />
                    {checked ? '今天已打卡 · 撤销' : '打卡今天'}
                  </button>
                  <span className="text-[11px] text-ink-3">连续 {streak} 天</span>
                </div>

                <div className="mt-3 grid grid-cols-7 gap-1">
                  {weekDates.map((date) => {
                    const done = isHabitChecked(data, habit.id, date);
                    const isCurrent = isToday(date);
                    const weekday = WEEKDAY_CN[parseKey(date).getDay()];
                    return (
                      <button
                        key={date}
                        type="button"
                        title={`${relativeLabel(date)}${done ? ' · 已打卡' : ''}（点击可补卡/取消）`}
                        onClick={() => dispatch({ type: 'habit/toggle', habitId: habit.id, date })}
                        className={`flex flex-col items-center gap-1 rounded-lg py-1 text-[10px] transition-colors ${
                          done ? 'bg-accent/12 text-accent-ink' : 'text-ink-3 hover:bg-sunken'
                        } ${isCurrent ? 'ring-1 ring-accent/40' : ''}`}
                      >
                        <span>{weekday}</span>
                        <span className={`grid h-5 w-5 place-items-center rounded-full border ${done ? 'border-transparent bg-accent text-white' : 'border-line-2'}`}>
                          {done ? <Icon name="check" size={10} strokeWidth={3} /> : <span className="text-[9px]">{Number(date.slice(8))}</span>}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="新建习惯"
        footer={
          <>
            <button className="fd-btn-ghost" onClick={() => setCreateOpen(false)}>
              取消
            </button>
            <button className="fd-btn-primary" onClick={submit}>
              创建
            </button>
          </>
        }
      >
        <div>
          <label className="fd-label" htmlFor="habit-name">
            习惯名称
          </label>
          <input
            id="habit-name"
            autoFocus
            className="fd-input"
            placeholder="例如：早起、阅读 30 分钟"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
          />
        </div>
        <div>
          <span className="fd-label">图标</span>
          <div className="flex flex-wrap gap-1.5">
            {HABIT_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => setDraft({ ...draft, emoji })}
                className={`grid h-9 w-9 place-items-center rounded-xl border text-base transition-colors ${
                  draft.emoji === emoji ? 'border-accent bg-accent-soft' : 'border-line hover:bg-sunken'
                }`}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className="fd-label">每周目标次数</span>
          <div className="flex flex-wrap gap-1.5">
            {Array.from({ length: 7 }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setDraft({ ...draft, target: n })}
                className={`h-8 w-9 rounded-lg border text-xs transition-colors ${
                  draft.target === n ? 'border-accent bg-accent-soft font-medium text-accent-ink' : 'border-line text-ink-2 hover:bg-sunken'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-ink-3">颜色与图标用于区分习惯；连续天数按实际打卡计算。</p>
        </div>
      </Modal>
    </div>
  );
}


