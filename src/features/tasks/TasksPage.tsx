import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../store/AppStore';
import { useTaskEditor } from '../../components/AppShell';
import { filterTasks, type TaskDateFilter, type TaskStatusFilter } from '../../lib/selectors';
import { relativeLabel, todayKey } from '../../lib/date';
import { Segmented } from '../../components/UI';
import { Icon } from '../../components/Icons';
import { TaskEmpty } from './TaskRow';
import { TaskRows } from './TaskRows';
import type { Priority, Task } from '../../types';

type PriorityFilter = 'all' | Priority;

const STATUS_OPTIONS: { value: TaskStatusFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'open', label: '待办' },
  { value: 'done', label: '已完成' },
];

const DATE_OPTIONS: { value: TaskDateFilter; label: string }[] = [
  { value: 'all', label: '全部日期' },
  { value: 'today', label: '今天' },
  { value: 'week', label: '本周' },
  { value: 'overdue', label: '已逾期' },
  { value: 'upcoming', label: '即将' },
];

/** 搜索防抖窗口：输入停顿 120ms 后才真正过滤；清空/Enter/compositionend 立即生效。 */
const SEARCH_DEBOUNCE_MS = 120;

export function TasksPage() {
  if (import.meta.env.DEV) {
    const w = window as unknown as Record<string, number>;
    w.__FD_PAGE_RENDERS__ = (w.__FD_PAGE_RENDERS__ || 0) + 1;
  }
  const { data } = useApp();
  const { openTaskEditor } = useTaskEditor();
  const navigate = useNavigate();
  const [inputValue, setInputValue] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [status, setStatus] = useState<TaskStatusFilter>('all');
  const [priority, setPriority] = useState<PriorityFilter>('all');
  const [dateFilter, setDateFilter] = useState<TaskDateFilter>('all');
  const today = todayKey();

  // 输入法组合状态：composition 期间不触发搜索
  const composingRef = useRef(false);
  const inputValueRef = useRef(inputValue);
  inputValueRef.current = inputValue;

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const listTopRef = useRef<HTMLDivElement | null>(null);
  const lastConditionRef = useRef('');

  // 交互优先：点击/切换后先用旧列表做轻量提交，让持久化防抖计时立即启动；
  // 新列表（排序 + 分组 + 可见行）在随后的低优先级渲染中完成，视觉上仅延迟 1-2 帧。
  const deferredTasks = useDeferredValue(data.tasks);

  // 开发态埋点：只统计「逻辑查询次数」（StrictMode 双调用同一 key 只记一次）
  const tasksVersionRef = useRef(0);
  const lastTasksRef = useRef(deferredTasks);
  if (lastTasksRef.current !== deferredTasks) {
    lastTasksRef.current = deferredTasks;
    tasksVersionRef.current += 1;
  }

  const filtered = useMemo(() => {
    const start = import.meta.env.DEV ? performance.now() : 0;
    const result = filterTasks(deferredTasks, {
      query: debouncedQuery,
      status,
      priority,
      date: dateFilter,
      weekStart: data.settings.weekStart,
    });
    if (import.meta.env.DEV) {
      const w = window as unknown as Record<string, number | string>;
      const key = `${debouncedQuery}|${status}|${priority}|${dateFilter}|${tasksVersionRef.current}`;
      if (w.__FD_FILTER_LAST_KEY__ !== key) {
        w.__FD_FILTER_LAST_KEY__ = key;
        w.__FD_FILTER_COUNT__ = ((w.__FD_FILTER_COUNT__ as number) || 0) + 1;
      }
      w.__FD_FILTER_MS__ = performance.now() - start;
      w.__FD_LAST_FILTERED_LEN__ = result.length;
    }
    return result;
  }, [deferredTasks, data.settings.weekStart, debouncedQuery, status, priority, dateFilter]);

  const pending = inputValue.trim() !== debouncedQuery;
  const hasFilter = debouncedQuery.trim() !== '' || status !== 'all' || priority !== 'all' || dateFilter !== 'all';
  const openCount = data.tasks.filter((t) => !t.completed).length;
  const doneCount = data.tasks.length - openCount;

  // 单次遍历分组：filterTasks 已返回有序结果（未完成在前、同日按时间/优先级、已完成按完成时间倒序），
  // 因此不再对每个分组重复 sortTasks，避免 4 次全量排序。
  const groups = useMemo(() => {
    if (hasFilter) return [{ key: 'filtered', title: '筛选结果', tasks: filtered }];
    const overdue: Task[] = [];
    const todays: Task[] = [];
    const upcoming: Task[] = [];
    const done: Task[] = [];
    for (const t of filtered) {
      if (t.completed) done.push(t);
      else if (t.date < today) overdue.push(t);
      else if (t.date === today) todays.push(t);
      else upcoming.push(t);
    }
    return [
      { key: 'overdue', title: '已逾期', tasks: overdue },
      { key: 'today', title: '今天', tasks: todays },
      { key: 'upcoming', title: '即将', tasks: upcoming },
      { key: 'done', title: '已完成', tasks: done.slice(0, 20) },
    ];
  }, [filtered, hasFilter, today]);

  const visibleGroups = groups.filter((g) => g.tasks.length > 0 || g.key === 'today');

  // 稳定回调：所有任务行共享同一个 onEdit，避免 memo 失效
  const handleEdit = useCallback((task: Task) => openTaskEditor(task), [openTaskEditor]);
  const handleCreate = useCallback(() => openTaskEditor({ date: today }), [openTaskEditor, today]);

  /** 立即把当前输入提交为查询（Enter / compositionend / 切换筛选时使用）。
   *  直接读取输入框 DOM 值，避免同一事件循环内 React 尚未提交 state 时读到旧值。 */
  const flushQuery = useCallback(() => {
    const raw = searchInputRef.current ? searchInputRef.current.value : inputValueRef.current;
    setDebouncedQuery(raw.trim());
  }, []);

  // 防抖：清空立即生效；输入法组合期间不安排搜索；其余输入在停顿 120ms 后生效
  useEffect(() => {
    const value = inputValue;
    if (value.trim() === '') {
      setDebouncedQuery('');
      return;
    }
    if (composingRef.current) return;
    const timer = window.setTimeout(() => {
      setDebouncedQuery(value.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [inputValue]);

  const changeStatus = useCallback(
    (value: TaskStatusFilter) => {
      flushQuery();
      setStatus(value);
    },
    [flushQuery]
  );
  const changePriority = useCallback(
    (value: PriorityFilter) => {
      flushQuery();
      setPriority(value);
    },
    [flushQuery]
  );
  const changeDate = useCallback(
    (value: TaskDateFilter) => {
      flushQuery();
      setDateFilter(value);
    },
    [flushQuery]
  );

  const clearSearch = useCallback(() => {
    setInputValue('');
    setDebouncedQuery('');
  }, []);

  const clearFilters = useCallback(() => {
    setInputValue('');
    setDebouncedQuery('');
    setStatus('all');
    setPriority('all');
    setDateFilter('all');
  }, []);

  // 有效搜索/筛选条件变化时，如果用户已经滚动到列表下方，回到列表顶部；
  // 依赖只包含「条件」，普通数据更新（勾选/编辑）不会拉回滚动位置。
  useEffect(() => {
    const key = `${debouncedQuery}|${status}|${priority}|${dateFilter}`;
    if (lastConditionRef.current === key) return;
    lastConditionRef.current = key;
    const el = listTopRef.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - 8;
    if (window.scrollY > top + 4) window.scrollTo(0, Math.max(0, top));
  }, [debouncedQuery, status, priority, dateFilter]);

  return (
    <div className="space-y-4">
      <section className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="fd-t-display text-ink">全部任务</p>
          <p className="mt-0.5 text-xs text-ink-3">
            共 {data.tasks.length} · 待办 {openCount} · 已完成 {doneCount}
            {hasFilter ? <span className="ml-1 text-accent-ink">· 筛选出 {filtered.length} 条</span> : null}
          </p>
        </div>
        <button className="fd-btn-primary px-3 py-1.5 text-xs" onClick={handleCreate}>
          <Icon name="plus" size={14} />
          新建
        </button>
      </section>

      {/* 任务 / 项目 分段入口（移动端由此进入项目；桌面侧边栏另有「项目」项） */}
      <section className="flex flex-wrap items-center justify-between gap-2" aria-label="视图切换">
        <Segmented
          label="任务与项目视图"
          options={[
            { value: 'tasks', label: '任务' },
            { value: 'projects', label: '项目' },
          ]}
          value="tasks"
          onChange={(v) => {
            if (v === 'projects') navigate('/projects');
          }}
        />
        <p className="text-[11px] text-ink-3">项目视图按目标分组，显示完成率与本周进度</p>
      </section>

      <section className="fd-glass fd-glass-soft space-y-3 rounded-[20px] p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex min-w-[180px] flex-1 items-center gap-2 rounded-full border border-line bg-paper px-3 py-1.5">
            <Icon name="search" size={15} className="shrink-0 text-ink-3" />
            <input
              id="task-search"
              aria-label="搜索任务"
              ref={searchInputRef}
              className="min-h-[24px] w-full bg-transparent py-0.5 text-sm text-ink outline-none placeholder:text-ink-3"
              placeholder="搜索任务标题或备注"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onCompositionStart={() => {
                composingRef.current = true;
              }}
              onCompositionEnd={(e) => {
                composingRef.current = false;
                const raw = e.currentTarget.value;
                setInputValue(raw);
                setDebouncedQuery(raw.trim());
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (!composingRef.current) {
                    const raw = e.currentTarget.value;
                    setInputValue(raw);
                    setDebouncedQuery(raw.trim());
                  }
                }
              }}
            />
            {pending ? (
              <span className="shrink-0 text-[10px] text-ink-3" aria-live="polite">
                搜索中…
              </span>
            ) : null}
            {inputValue ? (
              <button type="button" aria-label="清除搜索" className="text-ink-3 hover:text-ink" onClick={clearSearch}>
                <Icon name="close" size={13} />
              </button>
            ) : null}
          </div>
          <Segmented label="按状态筛选" options={STATUS_OPTIONS} value={status} onChange={changeStatus} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            id="filter-priority"
            aria-label="按优先级筛选"
            className="fd-input w-auto px-2.5 py-1.5 text-xs"
            value={String(priority)}
            onChange={(e) => changePriority(e.target.value === 'all' ? 'all' : (Number(e.target.value) as Priority))}
          >
            <option value="all">全部优先级</option>
            <option value="1">P1 紧急</option>
            <option value="2">P2 高</option>
            <option value="3">P3 普通</option>
          </select>
          <select
            id="filter-date"
            aria-label="按日期筛选"
            className="fd-input w-auto px-2.5 py-1.5 text-xs"
            value={dateFilter}
            onChange={(e) => changeDate(e.target.value as TaskDateFilter)}
          >
            {DATE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {hasFilter ? (
            <button className="fd-btn-ghost rounded-full px-2.5 py-1 text-xs" onClick={clearFilters}>
              <Icon name="close" size={12} />
              清空筛选
            </button>
          ) : null}
        </div>
      </section>

      <div ref={listTopRef} className="space-y-4">
        {filtered.length === 0 ? (
          <section className="fd-card">
            <TaskEmpty onCreate={handleCreate} />
            <p className="mt-2 text-center text-[11px] text-ink-3">
              {hasFilter ? '没有符合筛选条件的任务，试试清空筛选。' : '还没有任务，点击上方「新建」开始。'}
            </p>
            {!hasFilter && data.projects.length === 0 ? (
              <div className="mt-2 text-center">
                <button className="fd-btn-ghost px-3 py-1 text-xs" onClick={() => navigate('/projects')} data-fd-empty-create-project="1">
                  先创建第一个项目
                </button>
              </div>
            ) : null}
            {hasFilter ? (
              <div className="mt-2 text-center">
                <button className="fd-btn-soft px-3 py-1 text-xs" onClick={clearFilters}>
                  清空筛选
                </button>
              </div>
            ) : null}
          </section>
        ) : (
          visibleGroups.map((group) => (
            <section key={group.key} className="fd-card" data-fd-group={group.key}>
              <div className="mb-1 flex items-center justify-between">
                <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                  {group.title}
                  <span className="fd-num rounded-full bg-sunken px-1.5 text-[10px] font-normal text-ink-3">
                    {group.tasks.length}
                  </span>
                </h2>
                {group.key === 'today' ? <span className="text-[11px] text-ink-3">{relativeLabel(today)}</span> : null}
                {group.key === 'filtered' ? (
                  <span className="text-[11px] text-ink-3">按关键词 / 优先级 / 状态 / 日期筛选</span>
                ) : null}
              </div>
              {group.tasks.length === 0 ? (
                group.key === 'today' || (group.key === 'overdue' && !hasFilter) ? (
                  <TaskEmpty onCreate={handleCreate} />
                ) : (
                  <p className="fd-t-micro py-3 text-center">暂无任务</p>
                )
              ) : (
                <TaskRows tasks={group.tasks} showDate={group.key !== 'today'} onEdit={handleEdit} projects={data.projects} />
              )}
            </section>
          ))
        )}
      </div>
    </div>
  );
}
