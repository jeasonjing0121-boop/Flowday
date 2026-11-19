import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import type { Task } from '../types';
import { trackNavHeight } from '../lib/insets';
import { useApp } from '../store/AppStore';
import { downloadBackup } from '../lib/storage/backup';
import { todayKey, formatFull } from '../lib/date';
import { BrandMark, Icon, type IconName } from './Icons';
import { SyncBanner } from './SyncBanner';
import { UpdateBanner } from './UpdateBanner';
import { TaskEditorModal } from '../features/tasks/TaskEditor';

interface TaskEditorApi {
  openTaskEditor: (initial?: Partial<Task>) => void;
}

const TaskEditorContext = createContext<TaskEditorApi | null>(null);

export function useTaskEditor(): TaskEditorApi {
  const ctx = useContext(TaskEditorContext);
  if (!ctx) throw new Error('useTaskEditor 必须在 AppShell 内使用');
  return ctx;
}

const NAV: { to: string; label: string; icon: IconName }[] = [
  { to: '/today', label: '今日', icon: 'today' },
  { to: '/tasks', label: '任务', icon: 'tasks' },
  { to: '/calendar', label: '日历', icon: 'calendar' },
  { to: '/habits', label: '习惯', icon: 'habit' },
  { to: '/assistant', label: 'Jing', icon: 'sparkles' },
];

/**
 * 桌面侧边栏导航：在「任务」之后插入「项目」。
 * 移动端底部导航仍使用 NAV（5 项），避免 320px 下拥挤；移动端项目入口放在任务页分段。
 */
const PROJECT_NAV_ITEM: { to: string; label: string; icon: IconName } = { to: '/projects', label: '项目', icon: 'folder' };
const DESKTOP_NAV: { to: string; label: string; icon: IconName }[] = [...NAV.slice(0, 2), PROJECT_NAV_ITEM, ...NAV.slice(2)];

const PAGE_TITLE: Record<string, string> = {
  '/today': '今日',
  '/tasks': '任务',
  '/projects': '项目',
  '/calendar': '日历',
  '/habits': '习惯',
  '/assistant': 'AI 助手 · Jing',
  '/settings': '设置',
};

// 页面环境色：供 Liquid Glass 采样（与路由语义对应，低饱和）
const ROUTE_AMBIENT: Record<string, string> = {
  '/today': '#8a76c8',
  '/tasks': '#5f7fc4',
  '/projects': '#5f9a8c',
  '/calendar': '#a9785f',
  '/habits': '#6b9a72',
  '/settings': '#6c7c96',
  '/assistant': '#9a6ba8',
};

export function AppShell() {
  const { data, dispatch } = useApp();
  const location = useLocation();
  const [editor, setEditor] = useState<{ open: boolean; initial?: Partial<Task> }>({ open: false });
  const [menuOpen, setMenuOpen] = useState(false);
  const menuBtnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuId = 'fd-account-menu';

  // —— 底部导航液态胶囊：真实测量选中项位置，用 transform 做形态位移（FLIP） ——
  const navHostRef = useRef<HTMLDivElement | null>(null);
  const [pill, setPill] = useState<{ x: number; w: number; on: boolean }>({ x: 0, w: 0, on: false });
  const measurePill = useCallback(() => {
    const host = navHostRef.current;
    if (!host) return;
    const index = NAV.findIndex((item) => location.pathname === item.to || location.pathname.startsWith(`${item.to}/`));
    const active = index >= 0 ? (host.querySelectorAll<HTMLElement>('a')[index] ?? null) : null;
    if (!active) return;
    setPill({ x: active.offsetLeft, w: active.offsetWidth, on: true });
  }, [location.pathname]);
  useLayoutEffect(() => {
    measurePill();
  }, [measurePill]);
  useEffect(() => {
    const onResize = () => measurePill();
    window.addEventListener('resize', onResize, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null;
    if (navHostRef.current && ro) ro.observe(navHostRef.current);
    return () => {
      window.removeEventListener('resize', onResize);
      ro?.disconnect();
    };
  }, [measurePill]);

  // B2：底部导航高度实测 → --fd-nav-h（字体缩放/主题变化都会改变高度，硬编码必然遮挡）
  const navRef = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => trackNavHeight(navRef.current), []);

  // 账户菜单键盘交互：打开聚焦首项，↑↓/Home/End 循环，Esc 关闭并归还焦点，Tab 关闭
  useEffect(() => {
    if (!menuOpen) return;
    const items = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    items()[0]?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      const list = items();
      const idx = list.indexOf(document.activeElement as HTMLElement);
      if (e.key === 'Escape') {
        e.preventDefault();
        setMenuOpen(false);
        menuBtnRef.current?.focus();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        list[(idx + 1) % list.length]?.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        list[(idx - 1 + list.length) % list.length]?.focus();
      } else if (e.key === 'Home') {
        e.preventDefault();
        list[0]?.focus();
      } else if (e.key === 'End') {
        e.preventDefault();
        list[list.length - 1]?.focus();
      } else if (e.key === 'Tab') {
        setMenuOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);
  const api = useMemo<TaskEditorApi>(
    () => ({ openTaskEditor: (initial) => setEditor({ open: true, initial }) }),
    []
  );

  const title = location.pathname.startsWith('/projects') ? '项目' : PAGE_TITLE[location.pathname] ?? '今日';
  const today = todayKey();
  const ambient =
    ROUTE_AMBIENT[location.pathname] ??
    (location.pathname.startsWith('/projects') ? ROUTE_AMBIENT['/projects'] : undefined);
  const dark =
    data.settings.theme === 'dark' ||
    (data.settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  return (
    <TaskEditorContext.Provider value={api}>
      <div className="min-h-dvh lg-safe-frame" data-lg-app="1">
        <a href="#fd-main" className="fd-skip-link">
          跳到主要内容
        </a>
        <SyncBanner />
        <UpdateBanner />
        {/* 桌面侧边栏：L1 液态玻璃面板 */}
        <aside
          aria-label="侧边栏"
          aria-hidden="false"
          className="fd-glass fd-glass-nav fd-stack lg-l1 sidebar-liquid fixed bottom-3 left-3 top-3 z-40 hidden w-[232px] flex-col px-3 py-4 lg:flex"
        >
          <NavLink to="/today" className="mb-6 flex items-center gap-2.5 px-2">
            <BrandMark size={30} />
            <span>
              <span className="block text-[15px] font-semibold tracking-tight text-ink">FlowDay</span>
              <span className="block text-[10px] tracking-[0.18em] text-ink-3">把今天安排明白</span>
            </span>
          </NavLink>

          <nav aria-label="主导航" className="flex flex-col gap-0.5">
            {DESKTOP_NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => `fd-nav-item ${isActive ? 'fd-nav-item-active' : ''}`}
              >
                <Icon name={item.icon} size={18} className="shrink-0 opacity-80" />
                <span>{item.label}</span>
              </NavLink>
            ))}
          </nav>

          <div className="mt-auto space-y-2 border-t border-line-2 pt-3">
            <NavLink
              to="/settings"
              className={({ isActive }) => `fd-nav-item ${isActive ? 'fd-nav-item-active' : ''}`}
            >
              <Icon name="settings" size={18} className="shrink-0 opacity-80" />
              <span>设置</span>
            </NavLink>
            <button
              type="button"
              className="fd-nav-item w-full"
              onClick={() =>
                dispatch({
                  type: 'settings/update',
                  patch: { theme: data.settings.theme === 'dark' ? 'light' : 'dark' },
                })
              }
            >
              <Icon name={dark ? 'sun' : 'moon'} size={18} className="shrink-0 opacity-80" />
              <span>{dark ? '切换到浅色' : '切换到深色'}</span>
            </button>
            <p className="px-3 pt-1 text-[10px] leading-4 text-ink-3">
              IndexedDB 本地存储 · 数据只保存在这台设备
            </p>
          </div>
        </aside>

        {/* 主区域 */}
        <div className="flex min-w-0 flex-1 flex-col lg:pl-[252px]">
          <header className="sticky top-3 z-30 px-3 md:px-6" data-ambient={ambient}>
            <div className="fd-glass fd-glass-nav lg-l1 header-liquid relative mx-auto flex h-14 w-full max-w-[1120px] items-center justify-between gap-3 px-4 md:px-6">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="lg:hidden">
                  <BrandMark size={24} />
                </span>
                <div className="min-w-0">
                  <h1 className="truncate text-[15px] font-semibold text-ink md:text-base">{title}</h1>
                  <p className="hidden text-[11px] text-ink-3 sm:block">{formatFull(today)}</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <NavLink to="/settings" className="fd-btn-ghost rounded-lg p-2 lg:hidden" aria-label="设置">
                  <Icon name="settings" size={18} />
                </NavLink>
                {/* 头像 + 液态玻璃下拉菜单 */}
                <div className="relative">
                  <button
                    ref={menuBtnRef}
                    type="button"
                    aria-label="账户菜单"
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    aria-controls={menuOpen ? menuId : undefined}
                    onClick={() => setMenuOpen((v) => !v)}
                    onKeyDown={(e) => {
                      // Enter/Space 走原生 click（避免 keydown 打开 + click 再关闭）；ArrowDown 直接展开
                      if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        setMenuOpen(true);
                      }
                    }}
                    className="lg-l1 lg-l1-heavy lg-orb relative grid h-9 w-9 place-items-center rounded-full text-xs font-semibold text-ink"
                  >
                    {(data.settings.name || '流').slice(0, 1).toUpperCase()}
                  </button>
                  {menuOpen ? (
                    <>
                      <div
                        className="fixed inset-0 z-40 lg-scrim-soft"
                        onClick={() => setMenuOpen(false)}
                        aria-hidden="true"
                      />
                      <div
                        id={menuId}
                        ref={menuRef}
                        role="menu"
                        aria-label="账户菜单"
                        style={{ '--lg-menu-origin': 'top right' } as React.CSSProperties}
                        className="fd-glass fd-glass-nav fd-pop lg-l1 lg-l1-heavy menu-liquid lg-menu-pop absolute right-0 top-11 z-50 w-52 rounded-[18px] p-1.5"
                      >
                        <NavLink
                          to="/settings"
                          role="menuitem"
                          onClick={() => setMenuOpen(false)}
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-ink-2 hover:bg-sunken hover:text-ink"
                        >
                          <Icon name="settings" size={14} />
                          设置
                        </NavLink>
                        <button
                          type="button"
                          role="menuitem"
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-ink-2 hover:bg-sunken hover:text-ink"
                          onClick={() => {
                            dispatch({
                              type: 'settings/update',
                              patch: { theme: data.settings.theme === 'dark' ? 'light' : 'dark' },
                            });
                            setMenuOpen(false);
                          }}
                        >
                          <Icon name={dark ? 'sun' : 'moon'} size={14} />
                          {dark ? '切换到浅色' : '切换到深色'}
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-ink-2 hover:bg-sunken hover:text-ink"
                          onClick={() => {
                            downloadBackup(data);
                            setMenuOpen(false);
                          }}
                        >
                          <Icon name="download" size={14} />
                          导出 JSON 备份
                        </button>
                      </div>
                    </>
                  ) : null}
                </div>
                {/* 浮动操作：移动端为液态圆形按钮，桌面为带文字的胶囊按钮 */}
                <button
                  className="lg-l1 lg-l1-clear lg-fab relative flex h-10 items-center justify-center gap-1.5 rounded-full px-2 text-xs font-medium text-ink sm:h-auto sm:px-3.5 sm:py-2 md:text-sm"
                  onClick={() => api.openTaskEditor({ date: today })}
                >
                  <Icon name="plus" size={15} />
                  <span className="hidden sm:inline">新建任务</span>
                </button>
              </div>
            </div>
          </header>

          <main
            id="fd-main"
            data-fd-main
            tabIndex={-1}
            key={location.pathname}
            className="fd-page-in lg-main-mobile mx-auto w-full max-w-[1120px] flex-1 scroll-mt-24 px-4 pb-28 pt-4 outline-none sm:px-6 lg:px-8 lg:pb-10 lg:pt-6"
          >
            <Outlet />
          </main>
        </div>

        {/* 移动端底部导航：L1 液态玻璃胶囊 + 真实位移的选中块 */}
        <nav
          aria-label="底部导航"
          data-lg-pill="1"
          data-fd-bottom-nav="1"
          ref={navRef}
          className="fd-glass fd-glass-nav lg-l1 tabbar-liquid fixed z-40 lg:hidden"
        >
          <div ref={navHostRef} className="lg-pill-host relative grid h-14 grid-cols-5">
            <span
              aria-hidden="true"
              className="lg-tab-pill"
              style={{ transform: `translate3d(${pill.x}px, 0, 0)`, width: `${pill.w}px`, opacity: pill.on ? 1 : 0 }}
            />
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `mx-1 flex flex-col items-center justify-center gap-1 rounded-full text-[10px] transition-colors ${
                    isActive ? 'fd-tab-active font-medium text-accent-ink' : 'text-ink-3'
                  }`
                }
              >
                <Icon name={item.icon} size={20} />
                <span>{item.label}</span>
              </NavLink>
            ))}
          </div>
        </nav>

        <TaskEditorModal
          open={editor.open}
          initial={editor.initial}
          onClose={() => setEditor({ open: false })}
        />
      </div>
    </TaskEditorContext.Provider>
  );
}
