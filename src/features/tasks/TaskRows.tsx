import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Project, Task } from '../../types';
import { TaskRow } from './TaskRow';

/** 低于该行数直接用普通列表，避免虚拟化带来的额外开销与复杂度。 */
const PLAIN_LIMIT = 60;
/** 未测量行的高度估计（实测：无备注约 60px，有备注约 78px）。 */
const ROW_ESTIMATE = 66;
/** 视口上下各多渲染的行数，避免快速滚动白屏。 */
const OVERSCAN = 8;

interface TaskRowsProps {
  tasks: Task[];
  showDate?: boolean;
  onEdit: (task: Task) => void;
  projects: Project[];
}

/**
 * 任务行容器：
 * - 少量任务：保持原有 `divide-y` 普通列表（视觉与交互完全不变）
 * - 大量任务：按视口窗口化渲染，仅挂载可见行 ± OVERSCAN
 */
export function TaskRows({ tasks, showDate = false, onEdit, projects }: TaskRowsProps) {
  if (tasks.length <= PLAIN_LIMIT) {
    return (
      <div className="divide-y divide-line-2">
        {tasks.map((task) => (
          <TaskRow key={task.id} task={task} onEdit={onEdit} showDate={showDate} projects={projects} />
        ))}
      </div>
    );
  }
  return <VirtualRows tasks={tasks} showDate={showDate} onEdit={onEdit} projects={projects} />;
}

function VirtualRows({ tasks, showDate = false, onEdit, projects }: TaskRowsProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const heights = useRef(new Map<string, number>());
  const offsetsRef = useRef<{ offsets: number[]; total: number }>({ offsets: [], total: 0 });
  const anchorRef = useRef<{ index: number; offset: number } | null>(null);
  const pendingMeasure = useRef(false);
  const rafRef = useRef(0);
  const [version, setVersion] = useState(0);
  const [range, setRange] = useState({ start: 0, end: Math.min(tasks.length, 24) });
  const rangeRef = useRef(range);
  rangeRef.current = range;

  // 前缀偏移：已测量行用实测高度，未测量行用估计高度
  const model = useMemo(() => {
    const offsets = new Array<number>(tasks.length);
    let acc = 0;
    for (let i = 0; i < tasks.length; i++) {
      offsets[i] = acc;
      acc += heights.current.get(tasks[i].id) ?? ROW_ESTIMATE;
    }
    offsetsRef.current = { offsets, total: acc };
    return { offsets, total: acc };
  }, [tasks, version]);

  const updateRange = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const { offsets, total } = offsetsRef.current;
    if (!total) return;
    const top = el.getBoundingClientRect().top + window.scrollY;
    const viewTop = window.scrollY - top;
    const viewBottom = viewTop + window.innerHeight;

    let lo = 0;
    let hi = offsets.length - 1;
    let start = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (offsets[mid] <= viewTop) {
        start = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    let end = start;
    while (end < offsets.length && offsets[end] < viewBottom) end += 1;

    const next = {
      start: Math.max(0, start - OVERSCAN),
      end: Math.min(tasks.length, end + OVERSCAN),
    };
    setRange((prev) => (prev.start === next.start && prev.end === next.end ? prev : next));
  }, [tasks.length]);

  // 滚动 / 尺寸变化：rAF 节流后重算窗口
  useEffect(() => {
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      rafRef.current = window.requestAnimationFrame(() => {
        ticking = false;
        updateRange();
      });
    };
    updateRange();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    const ro = typeof ResizeObserver !== 'undefined' && containerRef.current ? new ResizeObserver(onScroll) : null;
    if (ro && containerRef.current) ro.observe(containerRef.current);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      ro?.disconnect();
      window.cancelAnimationFrame(rafRef.current);
    };
  }, [updateRange, tasks.length]);

  // 任务集合变化（搜索/筛选/排序/删除）后重新计算窗口
  useEffect(() => {
    const id = window.requestAnimationFrame(updateRange);
    return () => window.cancelAnimationFrame(id);
  }, [model, updateRange]);

  // 行高测量完成导致上方偏移变化时，补偿滚动位置，避免视觉跳动
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    anchorRef.current = null;
    if (!anchor) return;
    const { offsets } = offsetsRef.current;
    if (anchor.index < offsets.length) {
      const delta = offsets[anchor.index] - anchor.offset;
      if (Math.abs(delta) > 0.5) window.scrollBy(0, delta);
    }
  }, [version]);

  const measureRafRef = useRef(0);

  // 卸载时取消挂起的行高测量 rAF，避免遗留任务
  useEffect(() => () => cancelAnimationFrame(measureRafRef.current), []);

  const measure = useCallback((id: string, el: HTMLElement) => {
    const height = el.getBoundingClientRect().height;
    if (height <= 0) return;
    const prev = heights.current.get(id);
    if (prev !== undefined && Math.abs(prev - height) <= 0.5) return;
    if (!anchorRef.current) {
      const { offsets } = offsetsRef.current;
      const first = rangeRef.current.start;
      if (first < offsets.length) anchorRef.current = { index: first, offset: offsets[first] };
    }
    heights.current.set(id, height);
    if (!pendingMeasure.current) {
      pendingMeasure.current = true;
      measureRafRef.current = window.requestAnimationFrame(() => {
        pendingMeasure.current = false;
        setVersion((v) => v + 1);
      });
    }
  }, []);

  const start = Math.min(range.start, tasks.length);
  const end = Math.min(range.end, tasks.length);
  const visible = [];
  for (let i = start; i < end; i += 1) visible.push(i);

  return (
    <div ref={containerRef} className="relative" style={{ height: model.total }} data-fd-virtual="1">
      {visible.map((index) => (
        <VirtualRow
          key={tasks[index].id}
          task={tasks[index]}
          top={model.offsets[index]}
          index={index}
          showDate={showDate}
          onEdit={onEdit}
          projects={projects}
          measure={measure}
        />
      ))}
    </div>
  );
}

const VirtualRow = memo(function VirtualRow({
  task,
  top,
  index,
  showDate,
  onEdit,
  projects,
  measure,
}: {
  task: Task;
  top: number;
  index: number;
  showDate: boolean;
  onEdit: (task: Task) => void;
  projects: Project[];
  measure: (id: string, el: HTMLElement) => void;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    measure(task.id, el);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measure(task.id, el));
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, task.id]);

  return (
    <div
      ref={wrapRef}
      data-fd-virtual-row={index}
      className={`absolute inset-x-0 ${index > 0 ? 'border-t border-line-2' : ''}`}
      style={{ top }}
    >
      <TaskRow task={task} onEdit={onEdit} showDate={showDate} projects={projects} />
    </div>
  );
});
