import type { SVGProps } from 'react'
import { LAYOUT_GRID, type LayoutCount } from '../types'

type P = SVGProps<SVGSVGElement>

const base = (p: P) => ({
  width: 15,
  height: 15,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  ...p,
})

export const IconPlus = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
)

export const IconSettings = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1 1.56V21a2 2 0 1 1-4 0v-.11a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.88 1.7 1.7 0 0 0-1.56-1H3a2 2 0 1 1 0-4h.11a1.7 1.7 0 0 0 1.56-1.11 1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.88.34H9a1.7 1.7 0 0 0 1-1.56V3a2 2 0 1 1 4 0v.11a1.7 1.7 0 0 0 1 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.88V9a1.7 1.7 0 0 0 1.56 1H21a2 2 0 1 1 0 4h-.11a1.7 1.7 0 0 0-1.56 1z" />
  </svg>
)

export const IconTrash = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
  </svg>
)

export const IconCopy = (p: P) => (
  <svg {...base(p)}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
  </svg>
)

export const IconStop = (p: P) => (
  <svg {...base(p)}>
    <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />
  </svg>
)

export const IconSend = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 19V5M5 12l7-7 7 7" />
  </svg>
)

export const IconSparkle = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3l1.9 5.3L19 10l-5.1 1.7L12 17l-1.9-5.3L5 10l5.1-1.7z" />
  </svg>
)

export const IconBook = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v16H6.5A2.5 2.5 0 0 0 4 20.5z" />
    <path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v4H6.5A2.5 2.5 0 0 1 4 19.5" />
  </svg>
)

export const IconSun = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="4.5" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
)

export const IconMoon = (p: P) => (
  <svg {...base(p)}>
    <path d="M21 13a8.5 8.5 0 1 1-10-10 6.5 6.5 0 0 0 10 10z" />
  </svg>
)

export const IconX = (p: P) => (
  <svg {...base(p)}>
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
)

export const IconPower = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3v9" />
    <path d="M18.4 6.6a9 9 0 1 1-12.8 0" />
  </svg>
)

export const IconRefresh = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 12a9 9 0 0 1 15.3-6.4L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-15.3 6.4L3 16" />
    <path d="M3 21v-5h5" />
  </svg>
)

export const IconEdit = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
  </svg>
)

export const IconBroadcast = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="2" />
    <path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 15.5a5 5 0 0 0 0-7" />
    <path d="M5.6 5.6a9 9 0 0 0 0 12.8M18.4 18.4a9 9 0 0 0 0-12.8" />
  </svg>
)

export const IconExpand = (p: P) => (
  <svg {...base(p)}>
    <path d="M15 3h6v6M21 3l-7 7M9 21H3v-6M3 21l7-7" />
  </svg>
)

export const IconCollapse = (p: P) => (
  <svg {...base(p)}>
    <path d="M21 3l-7 7M14 4v6h6M3 21l7-7M10 20v-6H4" />
  </svg>
)

/** 按布局画一个小网格示意图 */
export function LayoutIcon({ count }: { count: LayoutCount }) {
  const { cols, rows } = LAYOUT_GRID[count]
  const W = 20
  const H = 16
  const g = 2
  const cw = (W - g * (cols + 1)) / cols
  const ch = (H - g * (rows + 1)) / rows
  const rects = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      rects.push(
        <rect
          key={`${r}-${c}`}
          x={g + c * (cw + g)}
          y={g + r * (ch + g)}
          width={cw}
          height={ch}
          rx={1.2}
          fill="currentColor"
        />,
      )
    }
  }
  return (
    <svg width={20} height={16} viewBox={`0 0 ${W} ${H}`} aria-hidden>
      {rects}
    </svg>
  )
}

export const IconChevronDown = (p: P) => (
  <svg {...base(p)}>
    <path d="m6 9 6 6 6-6" />
  </svg>
)

export const IconCheck = (p: P) => (
  <svg {...base(p)}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
)

export const IconType = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 7V5h16v2M9 5v14M15 5v14M7 19h4M13 19h4" />
  </svg>
)

export const IconImage = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="8.5" cy="9.5" r="1.5" />
    <path d="m21 15-5-5L5 20" />
  </svg>
)

export const IconVideo = (p: P) => (
  <svg {...base(p)}>
    <rect x="2" y="6" width="14" height="12" rx="2" />
    <path d="m22 8-6 4 6 4V8Z" />
  </svg>
)

export const IconSliders = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h8M16 18h4" />
    <circle cx="16" cy="6" r="2" />
    <circle cx="10" cy="12" r="2" />
    <circle cx="14" cy="18" r="2" />
  </svg>
)

export const IconClock = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
)

export const IconFrame = (p: P) => (
  <svg {...base(p)}>
    <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
  </svg>
)

export const IconLayers = (p: P) => (
  <svg {...base(p)}>
    <path d="m12 3 8.5 4.5L12 12 3.5 7.5 12 3Z" />
    <path d="m3.5 12.5 8.5 4.5 8.5-4.5" />
  </svg>
)

/* ---- 生成模式的图标 ---- */
export const IconModeText = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 6h16M4 12h12M4 18h8" />
  </svg>
)

export const IconModeImage = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
    <path d="m3 16 5-4 4 3 3-2.5 6 4.5" />
    <circle cx="8.5" cy="9" r="1.3" />
  </svg>
)

/** 首尾帧：左右两半 */
export const IconModeFrames = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <path d="M12 5v14" />
    <path d="M7 12h2" />
  </svg>
)

/** 全能参考：多素材汇聚 */
export const IconModeRef = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 5.5 9 12l-5 6.5" />
    <path d="M20 5.5 15 12l5 6.5" />
    <path d="M11 12h2" />
  </svg>
)

export const IconSwap = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 8h13l-3-3M20 16H7l3 3" />
  </svg>
)
