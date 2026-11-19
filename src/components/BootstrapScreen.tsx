import { BrandMark } from './Icons';

/** 启动/初始化加载屏（纯 UI，不含任何初始化逻辑）。 */
export function BootstrapScreen() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-paper px-6">
      <div className="fd-glass fd-pop flex items-center gap-3 rounded-[24px] px-5 py-4">
        <BrandMark size={30} />
        <div>
          <p className="text-sm font-semibold text-ink">FlowDay</p>
          <p className="mt-0.5 animate-pulse text-[11px] text-ink-3">正在读取本地数据…</p>
        </div>
      </div>
    </div>
  );
}
