import { useEffect, useState } from 'react';
import type { ThemeMode } from '../../types';
import { useApp } from '../../store/AppStore';
import { demoData, emptyData } from '../../lib/data';
import { downloadBackup, validateBackupDetailed } from '../../lib/storage/backup';
import { clearLegacyCopies } from '../../lib/storage/legacy';
import { readLastExport, recordExportSuccess } from '../../lib/storage/exportLog';
import { readSyncInfo } from '../../lib/storage';
import {
  PERSIST_REQUEST_TEXT,
  PERSIST_STATE_TEXT,
  queryPersistState,
  requestPersist,
  type PersistState,
} from '../../lib/storage/persist';
import { ImportPreviewModal, type ImportPreviewInfo } from '../../components/ImportPreviewModal';
import { isPreviewStale } from '../../lib/storage/importGuard';
import { formatFull, todayKey } from '../../lib/date';
import { DemoBanner, Segmented, useConfirm, useToast } from '../../components/UI';
import { Icon } from '../../components/Icons';
import {
  canPromptInstall,
  checkPwaUpdate,
  isNativeContainer,
  isPwaSupported,
  isStandaloneDisplay,
  promptInstall,
  subscribeInstallPrompt,
} from '../../lib/pwa/register';
import { BUILD_INFO } from '../../lib/buildInfo';
import { openOnboardingReview } from '../onboarding/OnboardingWizard';

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-sunken-2'}`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`}
      />
    </button>
  );
}

export function SettingsPage() {
  const { data, dispatch, storage, hasUnsavedChanges } = useApp();
  const update = (patch: Partial<typeof data.settings>) => dispatch({ type: 'settings/update', patch });
  const { confirm } = useConfirm();
  const { toast } = useToast();
  const [canInstall, setCanInstall] = useState(() => canPromptInstall());
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  // PWA 安装提示：浏览器触发 beforeinstallprompt 后才展示「安装应用」
  useEffect(() => {
    return subscribeInstallPrompt(() => setCanInstall(canPromptInstall()));
  }, []);

  const installApp = async () => {
    const ok = await promptInstall();
    toast(ok ? '已打开安装提示，按浏览器指引完成安装' : '当前浏览器未提供安装入口，可用浏览器菜单「安装应用 / 添加到主屏幕」', 'info');
    setCanInstall(canPromptInstall());
  };

  const checkUpdate = async () => {
    setCheckingUpdate(true);
    try {
      const result = await checkPwaUpdate();
      const message =
        result === 'updated'
          ? '发现新版本，请使用页面顶部的「立即更新」'
          : result === 'up-to-date'
            ? '已是最新版本'
            : result === 'unsupported'
              ? '当前环境不支持自动检查（开发模式或浏览器不支持）'
              : '检查更新失败，请稍后重试';
      toast(message, result === 'error' ? 'error' : 'info');
    } finally {
      setCheckingUpdate(false);
    }
  };

  const clearAll = async () => {
    const ok = await confirm({
      title: '清空所有本地数据？',
      description: '任务、习惯与打卡记录都会被删除，且无法恢复。',
      confirmText: '清空',
      danger: true,
    });
    if (!ok) return;
    dispatch({
      type: 'data/replace',
      data: { ...emptyData(), settings: { ...data.settings, demoData: false } },
    });
    clearLegacyCopies();
    toast('已清空本地数据（含旧版数据副本）', 'info');
  };

  const loadDemo = async () => {
    const ok = await confirm({
      title: '载入示例数据？',
      description: '当前内容会被示例数据替换，建议先导出备份。',
      confirmText: '载入',
    });
    if (!ok) return;
    dispatch({ type: 'data/replace', data: demoData() });
    toast('已载入示例数据', 'info');
  };

  const [preview, setPreview] = useState<ImportPreviewInfo | null>(null);
  const [previewRevision, setPreviewRevision] = useState(0);
  const [previewWriter, setPreviewWriter] = useState<string | null>(null);
  const [lastExport, setLastExport] = useState<string | null>(() => readLastExport());
  const [persistState, setPersistState] = useState<PersistState | 'unknown'>('unknown');

  useEffect(() => {
    queryPersistState().then(setPersistState);
  }, []);

  // 预览打开期间轮询库版本：数据变化 → 冲突提示 + 禁用确认
  useEffect(() => {
    if (!preview) return;
    let alive = true;
    const tick = () => {
      readSyncInfo()
        .then((info) => {
          if (!alive) return;
          setPreviewRevision(info.revision);
          setPreviewWriter(info.writerId ?? null);
        })
        .catch(() => undefined);
    };
    tick();
    const timer = window.setInterval(tick, 800);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [preview]);

  const openPreview = async (file: File) => {
    const text = await file.text();
    const validation = await validateBackupDetailed(text);
    let baseRevision = storage.revision;
    try {
      const info = await readSyncInfo();
      baseRevision = info.revision;
    } catch {
      /* 使用上下文中的 revision */
    }
    setPreviewRevision(baseRevision);
    setPreview({
      fileName: file.name,
      fileSize: new TextEncoder().encode(text).length,
      validation,
      baseRevision,
      dirtyAtOpen: hasUnsavedChanges(),
    });
    if (!validation.ok) toast(`导入校验失败：${validation.error}`, 'error');
  };

  const [importing, setImporting] = useState(false);

  const confirmImport = async () => {
    if (!preview || !preview.validation.ok) return;
    if (importing) return;
    setImporting(true);
    let current = previewRevision;
    let currentWriter: string | null = previewWriter;
    try {
      const info = await readSyncInfo();
      current = info.revision;
      currentWriter = info.writerId ?? null;
    } catch {
      /* 使用轮询值 */
    }
    if (isPreviewStale(preview.baseRevision, current, currentWriter, storage.writerId)) {
      setPreviewRevision(current);
      setPreviewWriter(currentWriter);
      toast('预览之后数据已被其他标签页修改，请重新选择备份文件', 'error');
      setImporting(false);
      return;
    }
    if (preview.dirtyAtOpen || hasUnsavedChanges()) {
      const ok = await confirm({
        title: '存在未保存的修改',
        description: '本页有尚未写入数据库的修改，继续导入将丢弃这些修改，并以备份内容整体覆盖当前数据。',
        confirmText: '丢弃修改并导入',
        danger: true,
      });
      if (!ok) {
        setImporting(false);
        return;
      }
    }
    try {
      dispatch({ type: 'data/replace', data: preview.validation.data });
      setPreview(null);
      toast('已导入备份数据');
    } finally {
      setImporting(false);
    }
  };

  const requestPersisted = async () => {
    const result = await requestPersist();
    setPersistState(await queryPersistState());
    toast(PERSIST_REQUEST_TEXT[result], result === 'granted' ? 'success' : 'info');
  };

  return (
    <div className="mx-auto max-w-[760px] space-y-4">
      {data.settings.demoData ? (
        <DemoBanner
          onClear={async () => {
            const ok = await confirm({
              title: '清空示例数据？',
              description: '示例任务、习惯与打卡记录都会被删除。',
              confirmText: '清空',
              danger: true,
            });
            if (!ok) return;
            dispatch({
              type: 'data/replace',
              data: { ...emptyData(), settings: { ...data.settings, demoData: false } },
            });
            toast('已清空示例数据', 'info');
          }}
        />
      ) : null}

      <section className="fd-card">
        <h2 className="mb-3 text-sm font-semibold text-ink">个人资料</h2>
        <label className="fd-label" htmlFor="settings-name">
          昵称（用于首页问候）
        </label>
        <input
          id="settings-name"
          className="fd-input"
          placeholder="例如：小林"
          value={data.settings.name}
          onChange={(e) => update({ name: e.target.value })}
        />
        <p className="mt-2 text-[11px] text-ink-3">本阶段为本地账户，尚未接入登录注册；昵称只保存在这台设备。</p>
      </section>

      <section className="fd-card space-y-4">
        <h2 className="text-sm font-semibold text-ink">外观与偏好</h2>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm text-ink">主题</p>
            <p className="text-[11px] text-ink-3">晨光纸感（浅色）/ 夜航（深色）</p>
          </div>
          <Segmented<ThemeMode>
            label="主题"
            value={data.settings.theme}
            onChange={(theme) => update({ theme })}
            options={[
              { value: 'light', label: '浅色' },
              { value: 'dark', label: '深色' },
              { value: 'system', label: '跟随系统' },
            ]}
          />
        </div>
        <div className="fd-divider" />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm text-ink">每周开始于</p>
            <p className="text-[11px] text-ink-3">影响日历与统计的周视图</p>
          </div>
          <Segmented<0 | 1>
            label="每周起始日"
            value={data.settings.weekStart}
            onChange={(weekStart) => update({ weekStart })}
            options={[
              { value: 1, label: '周一' },
              { value: 0, label: '周日' },
            ]}
          />
        </div>
      </section>

      <section className="fd-card space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">AI 助手「Jing」</h2>
            <p className="text-[11px] text-ink-3">当前为演示模式：本地规则生成建议，不调用真实模型、不产生费用</p>
          </div>
          <Switch checked={data.settings.aiEnabled} onChange={(aiEnabled) => update({ aiEnabled })} label="启用 AI 助手" />
        </div>
        <div className="rounded-xl border border-line bg-paper px-3 py-2 text-[11px] leading-5 text-ink-3">
          已实现：对话界面、规划与拆解提案、确认后才写入任务、忽略不写入。
          <br />
          未实现（后续阶段）：真实模型调用、周报、逐条选择、AI 额度与计费。
        </div>
      </section>

      <section className="fd-card space-y-3">
        <h2 className="text-sm font-semibold text-ink">数据</h2>
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="fd-btn-soft px-3 py-1.5 text-xs"
            onClick={() => {
              downloadBackup(data)
                .then((status) => {
                  const saved = recordExportSuccess();
                  if (saved) setLastExport(readLastExport());
                  toast(
                    status === 'verified'
                      ? '已导出备份文件（含 SHA-256 校验和）'
                      : '已导出备份文件（当前环境不支持 SHA-256，未附加校验和）',
                    status === 'verified' ? 'success' : 'info'
                  );
                })
                .catch(() => {
                  toast('导出失败：无法生成文件，未更新导出时间', 'error');
                });
            }}
          >
            <Icon name="download" size={14} />
            导出 JSON 备份
          </button>
          <label className="fd-btn-soft cursor-pointer px-3 py-1.5 text-xs">
            <Icon name="refresh" size={14} />
            导入 JSON 备份
            <input
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void openPreview(file);
                e.target.value = '';
              }}
            />
          </label>
          <button className="fd-btn-soft px-3 py-1.5 text-xs" onClick={loadDemo}>
            <Icon name="refresh" size={14} />
            载入示例数据
          </button>
          <button className="fd-btn-danger px-3 py-1.5 text-xs" onClick={clearAll}>
            <Icon name="trash" size={14} />
            清空本地数据
          </button>
        </div>
        <p className="text-[11px] leading-5 text-ink-3">
          数据保存在浏览器 IndexedDB（schema v{storage.schemaVersion}），刷新/关闭浏览器不会丢失；
          旧版 localStorage 数据已在首次启动时自动迁移，并保留副本用于回滚。
          后续接入云端同步时，仍由同一数据访问层接管（当前为纯本地模式）。
        </p>
        <p className="text-[11px] text-ink-3">
          当前统计：{data.tasks.length} 个任务 · {data.habits.length} 个习惯 ·{' '}
          {data.habitLogs.length} 条打卡记录
        </p>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-3">
          <span data-fd-persist-state={persistState}>
            持久化存储：{persistState === 'unknown' ? '查询中…' : PERSIST_STATE_TEXT[persistState]}
          </span>
          {persistState === 'not-granted' ? (
            <button className="fd-btn-ghost rounded-full px-2 py-0.5 text-[11px]" data-fd-persist-request="1" onClick={() => void requestPersisted()}>
              申请持久化
            </button>
          ) : null}
        </div>
        <p className="text-[11px] text-ink-3" data-fd-last-export={lastExport ?? ''}>
          {lastExport
            ? `上次成功导出：${new Date(lastExport).toLocaleString()}`
            : '尚无导出记录：建议在重要修改后手动导出备份（仅保存在本机文件）'}
        </p>
      </section>

      <section className="fd-card space-y-3" data-fd-app-section="1">
        <div>
          <h2 className="text-sm font-semibold text-ink">应用</h2>
          <p className="text-[11px] text-ink-3">
            安装到桌面或主屏后可像本地应用一样打开；离线也能进入应用界面（数据仍只保存在本机）。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canInstall ? (
            <button className="fd-btn-soft px-3 py-1.5 text-xs" onClick={() => void installApp()} data-fd-install-app="1">
              <Icon name="download" size={14} />
              安装应用
            </button>
          ) : null}
          <button
            className="fd-btn-soft px-3 py-1.5 text-xs"
            onClick={() => void checkUpdate()}
            disabled={checkingUpdate}
            data-fd-check-update="1"
          >
            <Icon name="refresh" size={14} />
            {checkingUpdate ? '检查中…' : '检查更新'}
          </button>
          <button className="fd-btn-soft px-3 py-1.5 text-xs" onClick={() => openOnboardingReview()} data-fd-replay-onboarding="1">
            <Icon name="sparkles" size={14} />
            重新查看上手引导
          </button>
        </div>
        <p className="text-[11px] leading-5 text-ink-3">
          运行模式：{isNativeContainer() ? '原生应用容器（资源随安装包分发）' : isStandaloneDisplay() ? '独立应用窗口' : '浏览器标签页'} · 离线缓存：
          {isNativeContainer()
            ? '由安装包提供，未启用 Service Worker'
            : isPwaSupported()
              ? '可用（仅缓存界面与静态资源，永不缓存备份与数据）'
              : '当前环境不支持'}
        </p>
      </section>

      <section className="fd-card space-y-1.5">
        <h2 className="text-sm font-semibold text-ink">关于</h2>
        <p className="text-[11px] leading-5 text-ink-2">
          FlowDay v0.3.0 · Phase 2 数据架构升级（IndexedDB + 备份） · {formatFull(todayKey())}
        </p>
        <p className="text-[11px] leading-5 text-ink-3" data-fd-build-info={BUILD_INFO.versionName}>
          {BUILD_INFO.isBeta ? '测试版本：' : '版本：'}
          {BUILD_INFO.versionName}（versionCode {BUILD_INFO.versionCode}） · 构建 {new Date(BUILD_INFO.builtAt).toLocaleString()} · commit{' '}
          <code className="rounded bg-sunken px-1">{BUILD_INFO.commit.slice(0, 7)}</code>
        </p>
        <p className="text-[11px] leading-5 text-ink-3">
          技术栈：React 19 + TypeScript + Vite + Tailwind CSS 4。本阶段不包含登录、云数据库、支付与原生 App；
          已为后续接入真实 AI（服务端代理）与云端数据留好接口位置。
        </p>
        <p className="text-[11px] leading-5 text-ink-3">方案文档：flowday/docs/plan/（PRD、设计系统、技术架构、开发计划、商业模式）</p>
      </section>

      {preview ? (
        <ImportPreviewModal
          preview={preview}
          currentRevision={previewRevision}
          stale={isPreviewStale(preview.baseRevision, previewRevision, previewWriter, storage.writerId)}
          busy={importing}
          exportedAt={preview.validation.ok ? preview.validation.exportedAt : undefined}
          onClose={() => setPreview(null)}
          onConfirm={() => void confirmImport()}
        />
      ) : null}
    </div>
  );
}
