import { useEffect, useState } from 'react';
import { msUntilNextMidnight, todayKey } from './date';

/**
 * 返回当前本地日期键（YYYY-MM-DD），并保证：
 * - 到下一个本地午夜自动刷新（按日历日计算，不使用固定 24h，天然兼容夏令时）；
 * - 页面从后台恢复（visibilitychange / focus）时校准，避免休眠后日期过期；
 * - 跨日时即使 AppData 未变化，依赖 today 的 useMemo 也会重新计算。
 */
export function useToday(): string {
  const [today, setToday] = useState(todayKey);

  useEffect(() => {
    let timer = 0;
    const sync = () => {
      const next = todayKey();
      setToday((prev) => (prev === next ? prev : next));
    };
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        sync();
        schedule();
      }, msUntilNextMidnight());
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        sync();
        schedule();
      }
    };
    schedule();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', sync);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', sync);
    };
  }, []);

  return today;
}
