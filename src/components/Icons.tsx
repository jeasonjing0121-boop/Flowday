import type { ReactNode, SVGProps } from 'react';

export type IconName =
  | 'today'
  | 'tasks'
  | 'calendar'
  | 'habit'
  | 'sparkles'
  | 'settings'
  | 'plus'
  | 'close'
  | 'left'
  | 'right'
  | 'down'
  | 'trash'
  | 'pencil'
  | 'check'
  | 'flag'
  | 'clock'
  | 'arrow-right'
  | 'download'
  | 'refresh'
  | 'moon'
  | 'sun'
  | 'send'
  | 'flame'
  | 'folder'
  | 'archive'
  | 'search';

const paths: Record<IconName, ReactNode> = {
  today: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  tasks: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="m8 11.5 2 2 4-4" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M8 3v4M16 3v4M3 10h18" />
    </>
  ),
  habit: (
    <>
      <path d="M12 21V9" />
      <path d="M12 9c0-3 2-5 5-5 0 3-2 5-5 5Z" />
      <path d="M12 12.5c0-2.5-2-4-4.5-4 0 2.5 2 4 4.5 4Z" />
    </>
  ),
  sparkles: (
    <>
      <path d="m12 3 1.7 4.4 4.4 1.7-4.4 1.7L12 15.2l-1.7-4.4L5.9 9.1l4.4-1.7L12 3Z" />
      <path d="m18.5 15.5.9 2.2 2.2.9-2.2.9-.9 2.2-.9-2.2-2.2-.9 2.2-.9.9-2.2Z" />
    </>
  ),
  settings: (
    <>
      <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" />
      <circle cx="15" cy="6" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="17" cy="18" r="2" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  left: <path d="m15 18-6-6 6-6" />,
  right: <path d="m9 18 6-6-6-6" />,
  down: <path d="m6 9 6 6 6-6" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
  pencil: (
    <>
      <path d="M4 20h4L19 9l-4-4L4 16v4Z" />
      <path d="m13.5 6.5 4 4" />
    </>
  ),
  check: <path d="m5 13 4 4L19 7" />,
  flag: (
    <>
      <path d="M5 21V4" />
      <path d="M5 4h11l-2 4 2 4H5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  'arrow-right': <path d="M5 12h14M13 6l6 6-6 6" />,
  download: <path d="M12 3v12M7 11l5 5 5-5M5 21h14" />,
  refresh: (
    <>
      <path d="M20 12a8 8 0 1 1-2.3-5.7" />
      <path d="M20 4v5h-5" />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
    </>
  ),
  send: <path d="M21 3 10.5 13.5M21 3l-6.6 18-3.9-7.5L3 9.6 21 3Z" />,
  flame: (
    <>
      <path d="M12 3c2.6 3.1 4.2 5.2 4.2 7.6a4.2 4.2 0 0 1-8.4 0C7.8 8.2 9.4 6.1 12 3Z" />
      <path d="M12 21a6 6 0 0 0 6-6c0-1.2-.3-2.3-.9-3.4" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-3.6-3.6" />
    </>
  ),
  folder: (
    <>
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.2l2 2.2h7.8A2.5 2.5 0 0 1 21 9.7v7.8A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z" />
    </>
  ),
  archive: (
    <>
      <rect x="3" y="4" width="18" height="4" rx="1.2" />
      <path d="M5 8v10.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V8" />
      <path d="M10 12h4" />
    </>
  ),
};

export function Icon({ name, size = 18, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {paths[name]}
    </svg>
  );
}

/** 品牌标记：晨光渐变圆角方块。 */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <span
      className="fd-gradient-bg inline-block shrink-0 rounded-[9px]"
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.3) }}
      aria-hidden="true"
    />
  );
}
